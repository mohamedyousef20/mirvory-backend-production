// controllers/guestOrder.controller.js
import crypto from 'crypto';
import mongoose from 'mongoose';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import GuestOrder from '../models/guestOrder.model.js';
import ShippingSettings from '../models/shippingSettings.model.js';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';
import { resolveSelection, reserveStock, returnStock } from '../utils/inventory.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const hashIp = (ip = '') =>
  crypto.createHash('sha256').update(ip + (process.env.IP_HASH_SALT || 'mirvory_salt')).digest('hex');

const getEffectivePrice = (product) =>
  product.discountedPrice ?? product.price;

const generateSecretCode = async (prefix = 'G', retries = 3) => {
  if (retries === 0) throw new Error('فشل في توليد كود سري فريد');
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(100 + Math.random() * 900);
  const code = `${prefix}-${ts}-${rand}`;
  const exists = await Order.findOne({ secretCode: code }).lean().select('_id');
  if (exists) return generateSecretCode(prefix, retries - 1);
  return code;
};

// ─────────────────────────────────────────────
// POST /api/guest-orders
// ─────────────────────────────────────────────
export const createGuestOrder = async (req, res, next) => {
  try {
    const {
      guestName,
      guestEmail,
      guestPhone,
      items, // [{ productId, quantity, size?, color? }]
      deliveryMethod,
      paymentMethod,
      deliveryInfo, // { address?, pickupPoint? }
    } = req.body;

    // ── 1. Basic validation ──────────────────────────────────────────
    if (!guestName?.trim()) {
      throw new createError("الاسم مطلوب", 400);
    }

    if (!guestEmail?.trim()) {
      throw new createError("البريد الإلكتروني مطلوب", 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      throw new createError("البريد الإلكتروني غير صالح", 400);
    }

    if (!guestPhone?.trim()) {
      throw new createError("رقم الهاتف مطلوب", 400);
    }

    if (!/^01[0125][0-9]{8}$/.test(guestPhone)) {
      throw new createError(
        "رقم الهاتف غير صالح (يجب أن يكون رقم مصري)",
        400
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new createError("يجب اختيار منتج واحد على الأقل", 400);
    }

    if (items.length > 20) {
      throw new createError("لا يمكن طلب أكثر من 20 منتجًا", 400);
    }

    if (
      deliveryMethod === "home" &&
      !deliveryInfo?.address?.trim()
    ) {
      throw new createError("عنوان التوصيل مطلوب", 400);
    }

    if (
      deliveryMethod === "pickup" &&
      !deliveryInfo?.pickupPoint
    ) {
      throw new createError("نقطة الاستلام مطلوبة", 400);
    }

    // ── 2. Rate limiting per IP ─────────────────────────────────────
    const clientIp =
      req.ip ||
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      "0.0.0.0";

    const ipHash = hashIp(clientIp);

    const oneHourAgo = new Date(
      Date.now() - 60 * 60 * 1000
    );

    const recentCount = await GuestOrder.countDocuments({
      ipHash,
      createdAt: { $gte: oneHourAgo },
    });

    // if (recentCount >= 3) {
    //   throw new createError(
    //     "تجاوزت الحد المسموح به من الطلبات. حاول مرة أخرى بعد ساعة.",
    //     429
    //   );
    // }

    // ── 3. Duplicate order guard ────────────────────────────────────
    const tenMinAgo = new Date(
      Date.now() - 10 * 60 * 1000
    );

    const recentDuplicate = await GuestOrder.findOne({
      guestEmail: guestEmail.toLowerCase().trim(),
      createdAt: { $gte: tenMinAgo },
    })
      .lean()
      .select("_id");

    if (recentDuplicate) {
      throw new createError(
        "لديك طلب مسجل بالفعل خلال آخر 10 دقائق. يرجى الانتظار قبل إنشاء طلب جديد.",
        429
      );
    }

    // ── 4. Validate product IDs ─────────────────────────────────────
    const productIds = items.map((item) => {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        throw new createError(
          `معرّف المنتج غير صالح: ${item.productId}`,
          400
        );
      }

      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new createError(
          "الكمية يجب أن تكون رقمًا صحيحًا موجبًا",
          400
        );
      }

      return new mongoose.Types.ObjectId(item.productId);
    });

    // ── 5. Fetch products including colors (images/sizes/stock live inside each color) ──
    // The same product can appear on several lines (different color or size), so use unique ids.
    const uniqueProductIds = [...new Set(productIds.map((id) => id.toString()))];
    const products = await Product.find({
      _id: { $in: uniqueProductIds },
      status: "available",
      isApproved: true,
    })
      .select(
        "_id title price discountedPrice seller quantity colors status"
      )
      .lean();

    if (products.length !== uniqueProductIds.length) {
      throw new createError(
        "بعض المنتجات غير متوفرة أو تم حذفها",
        404
      );
    }

    const productMap = Object.fromEntries(
      products.map((product) => [
        product._id.toString(),
        product,
      ])
    );

    // ── 6. Verify color + size + stock for every line ───────────────
    // The same variant may appear on several lines, so check the SUM per variant.
    const variantTotals = new Map();
    const lines = items.map((item) => {
      const product = productMap[item.productId.toString()];
      if (!product) {
        throw new createError(`المنتج غير موجود: ${item.productId}`, 404);
      }
      const k = `${product._id}|${String(item.color).toLowerCase()}|${String(item.size).toUpperCase()}`;
      const total = (variantTotals.get(k) || 0) + item.quantity;
      variantTotals.set(k, total);
      const { color, sizeEntry } = resolveSelection(product, item.color, item.size, total);
      return { item, product, color, size: sizeEntry.size };
    });

    // ── 7. Reserve stock atomically (Product + Color + Size, all-or-nothing) ──
    const stockLines = lines.map(({ item, product, color, size }) => ({
      productId: product._id,
      colorValue: color.value,
      size,
      quantity: item.quantity,
    }));
    await reserveStock(stockLines);

    // If anything fails before the order exists, the reserved stock is given back.
    let order;
    let guestRecord;
    let orderItems;
    let subtotal = 0;
    let total;
    let shippingFee;
    try {

    // ── 8. Calculate totals + build order items ──────────────────────
    orderItems = lines.map(({ item, product, color, size }) => {
      const price = getEffectivePrice(product);

      subtotal += price * item.quantity;

      return {
        product: product._id,
        seller: product.seller,
        title: product.title,
        quantity: item.quantity,
        price,
        size,
        // Snapshot of the exact selected color (id + name + hex)
        color: {
          id: color._id || null,
          name: color.name,
          value: color.value,
        },
        // IMPORTANT: the image of the SELECTED color, taken from the product (not from the client)
        image: color.image,
      };
    });

    // Get shipping settings and calculate shipping fee
    const shippingSettings = await ShippingSettings.getSettings();
    shippingFee = shippingSettings.shippingFee;

    // Free shipping based on minimum order
    if (shippingSettings.freeShippingEnabled && subtotal >= shippingSettings.freeShippingMinimum) {
      shippingFee = 0;
    }

    // Free pickup shipping
    if (shippingSettings.freePickupShipping && deliveryMethod === 'pickup') {
      shippingFee = 0;
    }

    // Free metro shipping (if address is provided)
    if (shippingSettings.freeMetroShipping && deliveryInfo.address) {
      const isMetro = shippingSettings.metroAreas?.some(area => 
        deliveryInfo.address.toLowerCase().includes(area.toLowerCase())
      );
      if (isMetro) {
        shippingFee = 0;
      }
    }

    total = Math.max(
      0,
      subtotal + shippingFee
    );

    // ── 9. Create guest sentinel buyer ───────────────────────────────
    let guestSentinelId;

    if (
      process.env.GUEST_SENTINEL_USER_ID &&
      mongoose.Types.ObjectId.isValid(
        process.env.GUEST_SENTINEL_USER_ID
      )
    ) {
      guestSentinelId = new mongoose.Types.ObjectId(
        process.env.GUEST_SENTINEL_USER_ID
      );
    } else {
      guestSentinelId = new mongoose.Types.ObjectId(
        "000000000000000000000001"
      );
    }

    const secretCode = await generateSecretCode("G");

    // ── 10. Create Order ─────────────────────────────────────────────
    order = await Order.create({
      buyer: guestSentinelId,

      isGuest: true,

      items: orderItems,

      paymentMethod: paymentMethod || "cash",
      paymentStatus: "pending",
      deliveryStatus: "pending",

      deliveryMethod: deliveryMethod || "home",

      deliveryInfo: {
        fullName: guestName.trim(),
        phone: guestPhone.trim(),

        address:
          deliveryMethod === "home"
            ? deliveryInfo?.address?.trim()
            : undefined,

        pickupPoint:
          deliveryMethod === "pickup"
            ? deliveryInfo?.pickupPoint
            : undefined,
      },

      subtotal,
      discount: 0,
      shippingFee,
      total,

      secretCode,
    });

    // ── 11. Create GuestOrder record ─────────────────────────────────
    guestRecord = await GuestOrder.create({
      guestEmail: guestEmail.toLowerCase().trim(),
      guestPhone: guestPhone.trim(),
      guestName: guestName.trim(),
      order: order._id,
      ipHash,
    });
    } catch (orderErr) {
      // The order could not be completed: return the reserved stock (and drop a half-created order).
      if (order?._id && !guestRecord) { try { await Order.findByIdAndDelete(order._id); } catch (_) { /* ignore */ } }
      for (const line of stockLines) {
        try { await returnStock(line); } catch (e) { console.error('[CRITICAL] Guest stock return failed:', line, e); }
      }
      throw orderErr;
    }

    // ── 12. Notify sellers ──────────────────────────────────────────
    setImmediate(async () => {
      try {
        const io = req.app.get("io");

        const sellerIds = [
          ...new Set(
            orderItems.map((item) =>
              item.seller.toString()
            )
          ),
        ];

        const notifPromises = sellerIds.map(
          (sellerId) =>
            createNotifications({
              io,
              title: "🔔 طلب ضيف جديد",
              message: `طلب جديد من ضيف: ${guestName}. رقم الطلب: ${order._id
                .toString()
                .slice(-6)}`,
              type: "ORDER_PLACED",
              actor: null,
              userId: sellerId,
              data: {
                orderId: order._id,
              },
              link: `/vendor/orders/${order._id}`,
            })
        );

        await Promise.all(notifPromises);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            "Guest order notification error:",
            err
          );
        }
      }
    });

    // ── 13. Response ─────────────────────────────────────────────────
    return res.status(201).json({
      success: true,
      message: "تم إنشاء طلبك بنجاح",
      trackingToken: guestRecord.trackingToken,
      orderId: order._id,
      orderNumber: order.orderNumber,
      total: order.total,
    });
  } catch (err) {
    next(err);
  }
};
// ─────────────────────────────────────────────
// GET /api/guest-orders/track/:token
// ─────────────────────────────────────────────
export const trackGuestOrder = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 10) throw new createError('رمز التتبع غير صالح', 400);

    const guestRecord = await GuestOrder.findOne({ trackingToken: token })
      .select('guestName order createdAt')
      .populate({
        path: 'order',
        select: 'orderNumber deliveryStatus paymentStatus total deliveryMethod deliveryInfo.fullName deliveryInfo.address items createdAt',
        populate: {
          path: 'items.product',
          select: 'title',
        },
      })
      .lean();

    if (!guestRecord) throw new createError('لم يتم العثور على طلب بهذا الرمز', 404);

    return res.status(200).json({
      success: true,
      guestName: guestRecord.guestName,
      order: guestRecord.order,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/guest-orders/link-account
// Link a guest order to a registered user account
// ─────────────────────────────────────────────
export const linkGuestOrderToAccount = async (req, res, next) => {
  try {
    const { trackingToken } = req.body;
    if (!trackingToken) throw new createError('رمز التتبع مطلوب', 400);

    const guestRecord = await GuestOrder.findOne({ trackingToken });
    if (!guestRecord) throw new createError('لم يتم العثور على الطلب', 404);
    if (guestRecord.linkedUser) throw new createError('هذا الطلب مرتبط بحساب بالفعل', 400);

    // req.user is set by protect middleware
    guestRecord.linkedUser = req.user._id;
    await guestRecord.save();

    // Update the Order to point to the real buyer
    await Order.findByIdAndUpdate(guestRecord.order, { buyer: req.user._id });

    return res.status(200).json({
      success: true,
      message: 'تم ربط الطلب بحسابك بنجاح',
    });
  } catch (err) {
    next(err);
  }
};
