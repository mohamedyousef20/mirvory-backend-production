import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import Cart from '../models/cart.model.js';
import mongoose from 'mongoose';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const generateUniqueSecretCode = async (buyerId, retries = 3) => {
  if (retries === 0) throw new Error("فشل في توليد كود سري فريد");
  const timestamp = Date.now().toString().slice(-6);
  const randomDigits = Math.floor(100 + Math.random() * 900);
  const buyerSuffix = buyerId.toString().slice(-3);
  const code = `${timestamp}${randomDigits}${buyerSuffix}`;

  const existingOrder = await Order.findOne({ secretCode: code }).lean();
  if (existingOrder) return generateUniqueSecretCode(buyerId, retries - 1);
  return code;
};

export const createOrderFilterObj = (req, res, next) => {
  let filterObj = {};
  const { buyer, seller, product, minTotal, maxTotal, paymentMethod, paymentStatus, deliveryMethod, deliveryStatus, payoutProcessed, isPrepared, secretCode, startDate, endDate, search } = req.query;

  if (buyer) filterObj.buyer = new mongoose.Types.ObjectId(buyer);
  if (seller) filterObj['items.seller'] = new mongoose.Types.ObjectId(seller);
  if (product) filterObj['items.product'] = new mongoose.Types.ObjectId(product);

  if (minTotal || maxTotal) {
    filterObj.total = {};
    if (minTotal) filterObj.total.$gte = parseFloat(minTotal);
    if (maxTotal) filterObj.total.$lte = parseFloat(maxTotal);
  }

  if (paymentMethod) filterObj.paymentMethod = paymentMethod;
  if (paymentStatus) filterObj.paymentStatus = paymentStatus;
  if (deliveryMethod) filterObj.deliveryMethod = deliveryMethod;
  if (deliveryStatus) filterObj.deliveryStatus = deliveryStatus;
  if (payoutProcessed !== undefined) filterObj.payoutProcessed = payoutProcessed === 'true';
  if (isPrepared !== undefined) filterObj.isPrepared = isPrepared === 'true';
  if (secretCode) filterObj.secretCode = secretCode;

  if (startDate || endDate) {
    filterObj.createdAt = {};
    if (startDate) filterObj.createdAt.$gte = new Date(startDate);
    if (endDate) filterObj.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    filterObj.$or = [
      { 'deliveryInfo.fullName': { $regex: search, $options: 'i' } },
      { 'deliveryInfo.phoneNumber': { $regex: search, $options: 'i' } },
      { 'deliveryInfo.address': { $regex: search, $options: 'i' } },
      { secretCode: { $regex: search, $options: 'i' } }
    ];
  }

  req.filterObj = filterObj;
  next();
};

export const createOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { deliveryMethod, paymentMethod, deliveryInfo } = req.body;

    if (!deliveryInfo?.fullName || !deliveryInfo?.phone) {
      throw createError("بيانات التوصيل (الاسم والرقم) مطلوبة", 400);
    }

    const cart = await Cart.findOne({ user: req.user._id })
      .populate({ path: "items.product", select: "price seller quantity title" })
      .session(session);

    if (!cart || cart.items.length === 0) {
      throw createError("السلة فارغة", 404);
    }

    const bulkOps = cart.items.map((item) => ({
      updateOne: {
        filter: { _id: item.product._id, quantity: { $gte: item.quantity } },
        update: { $inc: { quantity: -item.quantity, sold: item.quantity } },
      },
    }));

    const result = await Product.bulkWrite(bulkOps, { session });
    if (result.modifiedCount !== cart.items.length) {
      throw createError("بعض المنتجات نفذت من المخزون", 400);
    }

    const subtotal = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const discount = cart.appliedCoupon?.discountAmount || 0;
    const shippingFee = (subtotal > 500 || deliveryMethod === "pickup") ? 0 : 70;
    const total = Math.max(0, subtotal - discount + shippingFee);
    const secretCode = await generateUniqueSecretCode(req.user._id);

    const [order] = await Order.create([{
      buyer: req.user._id,
      items: cart.items.map((item) => ({
        product: item.product._id,
        seller: item.product.seller,
        quantity: item.quantity,
        price: item.product.price,
        color: item.color,
        size: item.size,
      })),
      paymentMethod: paymentMethod || "cash",
      paymentStatus: "pending",
      deliveryStatus: "pending",
      deliveryMethod: deliveryMethod || "home",
      deliveryInfo: {
        fullName: deliveryInfo.fullName.trim(),
        phone: deliveryInfo.phone.trim(),
        address: deliveryMethod === "home" ? deliveryInfo.address : undefined,
        pickupPoint: deliveryMethod === "pickup" ? deliveryInfo.pickupPoint : undefined,
      },
      subtotal, discount, shippingFee, total,
      coupon: cart.appliedCoupon || null,
      secretCode,
    }], { session });

    await Cart.findByIdAndDelete(cart._id).session(session);
    await session.commitTransaction();

    (async () => {
      try {
        const io = req.app.get("io");
        const sellerIds = [...new Set(cart.items.map(i => i.product.seller.toString()))];

        for (const sellerId of sellerIds) {
          await createNotifications({
            io, title: "🔔 طلب جديد",
            message: `لديك طلب جديد. رقم الطلب: ${order._id.toString().slice(-6)}`,
            type: "ORDER_PLACED", actor: req.user._id, userId: [sellerId],
            data: { orderId: order._id }, link: `/seller/orders/${order._id}`,
          });
        }

        await createNotifications({
          io, title: "✅ تم استلام طلبك",
          message: `تم استلام طلبك رقم #${order._id.toString().slice(-6)} بنجاح وسيتم تجهيزه`,
          type: "ORDER_PLACED", actor: req.user._id, userId: [req.user._id.toString()],
          data: { orderId: order._id }, link: `/orders/${order._id}`,
        });
      } catch (err) { console.error("Notification Error:", err); }
    })();

    res.status(201).json({ status: "success", message: "تم إنشاء الطلب بنجاح", data: order });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

export const orderComplete = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id, code } = req.body;

    const order = await Order.findOneAndUpdate(
      { _id: id, secretCode: code, payoutProcessed: false },
      { $set: { deliveryStatus: 'delivered', paymentStatus: 'paid', deliveredAt: new Date(), payoutProcessed: true, payoutDate: new Date() } },
      { new: true, session }
    ).populate('items.seller');

    if (!order) throw createError("الطلب غير موجود أو تم تحصيل أرباحه مسبقاً", 400);

    const sellerEarningsMap = {};
    const getPlatformFeePercentage = (price) => {
      if (price < 300) return 0.18;
      if (price <= 799) return 0.15;
      if (price <= 1999) return 0.12;
      return 0.10;
    };

    order.items.forEach((item) => {
      const sellerId = item.seller._id.toString();
      const itemTotal = item.price * item.quantity;
      const earnings = itemTotal * (1 - getPlatformFeePercentage(itemTotal));
      if (!sellerEarningsMap[sellerId]) sellerEarningsMap[sellerId] = 0;
      sellerEarningsMap[sellerId] += earnings;
    });

    const sellerIds = Object.keys(sellerEarningsMap);
    for (const sellerId of sellerIds) {
      await User.findByIdAndUpdate(
        sellerId,
        {
          $inc: { 'wallet.pendingBalance': sellerEarningsMap[sellerId] },
          $set: { 'wallet.lastTransaction': { amount: sellerEarningsMap[sellerId], date: new Date(), orderId: order._id } }
        },
        { session }
      );
    }

    await session.commitTransaction();

    (async () => {
      try {
        const io = req.app.get("io");
        for (const sellerId of sellerIds) {
          await createNotifications({
            io, title: '💵 أرباح جديدة',
            message: `إضافة ${sellerEarningsMap[sellerId].toFixed(2)} جنيه لمحفظتك من الطلب #${order._id.toString().slice(-6)}`,
            type: 'PAYOUT_COMPLETED', actor: req.user._id, userId: [sellerId],
            data: { orderId: order._id }, link: `/seller/wallet`,
          });
        }
        await createNotifications({
          io, title: '📦 تم تسليم الطلب',
          message: `تم تسليم طلبك بنجاح!`,
          type: 'ORDER_COMPLETED', actor: req.user._id, userId: [order.buyer.toString()],
          data: { orderId: order._id }, link: `/orders/${order._id}`,
        });
      } catch (err) { console.error("Notification Error:", err); }
    })();

    res.status(200).json({ message: 'تم استكمال الطلب بنجاح' });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("صلاحيات غير كافية", 403);

    const { orderId, paymentStatus } = req.body;
    if (!isValidObjectId(orderId)) throw createError("ID غير صالح", 400);
    if (!['pending', 'paid', 'failed'].includes(paymentStatus)) throw createError("حالة دفع غير صالحة", 400);

    const order = await Order.findById(orderId);
    if (!order) throw createError("الطلب غير موجود", 404);

    const previousStatus = order.paymentStatus;
    order.paymentStatus = paymentStatus;
    await order.save();

    if (previousStatus !== 'paid' && paymentStatus === 'paid') {
      (async () => {
        try {
          const io = req.app.get("io");
          const sellerIds = [...new Set(order.items.map(item => item.seller.toString()))];
          await createNotifications({
            io, title: "💰 تم الدفع",
            message: `تم تأكيد دفع الطلب رقم ${order._id.toString().slice(-6)}`,
            type: "ORDER_PAID", actor: req.user._id, userId: sellerIds,
            data: { orderId: order._id }, link: `/seller/orders/${order._id}`,
          });
        } catch (err) { console.error(err); }
      })();
    }

    res.status(200).json({ message: 'تم تحديث حالة الدفع', order });
  } catch (error) { next(error); }
};

export const updateDeliveryStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("صلاحيات غير كافية", 403);
    const { id, deliveryStatus } = req.body;
    const order = await Order.findById(id);

    if (!order) throw createError("الطلب غير موجود", 404);

    order.deliveryStatus = deliveryStatus;
    await order.save();

    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io, title: "تحديث حالة الطلب ✅",
          message: `📦 تم تغيير حالة طلبك إلى: ${deliveryStatus}`,
          type: "ORDER_UPDATED", actor: req.user._id, userId: [order.buyer.toString()],
          data: { orderId: order._id }, link: `/orders/${order._id}`,
        });
      } catch (err) { console.error(err); }
    })();

    res.json({ message: 'تم التحديث' });
  } catch (err) { next(err); }
};

export const confirmItemPreparation = async (req, res, next) => {
  try {
    const sellerId = req.user._id.toString();
    const { orderId, itemId } = req.params;

    const order = await Order.findOne({ _id: orderId, "items.seller": req.user._id });
    if (!order) throw createError("الطلب غير موجود", 404);

    const item = order.items.find((it) => it._id.toString() === itemId && (it.seller?._id || it.seller).toString() === sellerId);
    if (!item) throw createError("المنتج غير موجود أو لا تملك صلاحية عليه", 403);
    if (item.isPrepared) throw createError("المنتج مجهز مسبقاً", 400);

    item.isPrepared = true;
    order.isPrepared = order.items.every((it) => it.isPrepared);
    await order.save();

    res.json({ message: "success", item: { _id: item._id, isPrepared: item.isPrepared }, orderPrepared: order.isPrepared });
  } catch (err) { next(err); }
};

export const confirmPreparation = async (req, res, next) => {
  try {
    const sellerId = req.user._id.toString();
    const order = await Order.findOne({ _id: req.params.id, "items.seller": req.user._id });

    if (!order) throw createError("الطلب غير موجود", 404);

    const sellerItems = order.items.filter((it) => (it.seller?._id || it.seller).toString() === sellerId);
    let anyUpdated = false;

    sellerItems.forEach((it) => {
      if (!it.isPrepared) { it.isPrepared = true; anyUpdated = true; }
    });

    order.isPrepared = order.items.every((it) => it.isPrepared);
    await order.save();

    // 🔔 NOTIFICATION: Order Prepared
    if (anyUpdated) {
      (async () => {
        try {
          const io = req.app.get("io");
          const adminUsers = await User.find({ role: 'admin' });

          if (adminUsers.length > 0) {
            const productNames = sellerItems.map(it => it.product?.title || "Product");
            await createNotifications({
              io,
              title: "📦 تم تجهيز الطلب",
              message: `قام البائع بتجهيز ${productNames.length} منتج${productNames.length > 1 ? "ات" : ""} (${productNames[0]})`,
              type: "ORDER_PREPARED",
              actor: req.user._id,
              userId: adminUsers.map(a => a._id.toString()),
              data: {
                orderId: order._id,
                orderNumber: order.orderNumber,
                products: productNames,
                itemsCount: productNames.length,
              },
              link: `/admin/orders/${order._id}`,
            });
          }
        } catch (err) {
          console.error("Notification error:", err);
        }
      })();
    }

    res.json({ message: anyUpdated ? 'success' : 'fail', orderPrepared: order.isPrepared, updatedItems: sellerItems.map(it => ({ _id: it._id, isPrepared: it.isPrepared })) });
  } catch (err) { next(err); }
};

export const getAdminOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const total = await Order.countDocuments();
    const orders = await Order.find(req.filterObj || {})
      .populate('buyer', 'firstName lastName email phone')
      .populate({ path: 'items.product', select: 'title titleEn images' })
      .populate({ path: 'items.seller', select: 'firstName lastName email phone wallet' })
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

    res.json({ orders, pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalOrders: total, limit } });
  } catch (err) { next(err); }
};

export const getUserOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ buyer: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (err) { next(err); }
};

export const getSellerOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ "items.seller": req.user._id })
      .select('-secretCode -discount -payoutProcessed')
      .populate('items.product', 'title titleEn images')
      .lean();

    const filteredOrders = orders.map(order => {
      const sellerItems = order.items.filter(item => item.seller?._id?.toString() === req.user._id.toString());
      const sellerSubtotal = sellerItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
      return { ...order, items: sellerItems, sellerSubtotal };
    });

    res.json(filteredOrders);
  } catch (error) { next(error); }
};

export const getVendorEarnings = async (req, res, next) => {
  try {
    const orders = await Order.find({ "items.seller": req.params.vendorId, payoutProcessed: true }).lean();
    let earnings = 0;
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.seller.toString() === req.params.vendorId) {
          const itemTotal = item.price * item.quantity;
          const fee = itemTotal < 300 ? 0.18 : itemTotal <= 799 ? 0.15 : itemTotal <= 1999 ? 0.12 : 0.10;
          earnings += itemTotal * (1 - fee);
        }
      });
    });
    res.json({ earnings });
  } catch (err) { next(err); }
};

export const getUserOrderById = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'firstName lastName email phone')
      .populate({ path: 'items.product', select: 'title titleEn images' }).lean();

    if (!order) throw createError('الطلب غير موجود', 404);

    const isBuyer = order.buyer?._id?.toString() === userId;
    const isSeller = order.items.some(item => (item.seller?._id || item.seller)?.toString() === userId);

    if (!isBuyer && !isSeller && req.user.role !== 'admin') throw createError('غير مصرح', 403);

    if (isSeller && !isBuyer && req.user.role !== 'admin') {
      order.items = order.items.filter(item => (item.seller?._id || item.seller)?.toString() === userId);
      order.isSellerView = true;
      delete order.secretCode;
    }

    res.json(order);
  } catch (err) { next(err); }
};

export const printInvoice = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'firstName lastName email phone')
      .populate({ path: 'items.product', select: 'title titleEn images' }).lean();

    if (!order) throw createError('الطلب غير موجود', 404);

    const isBuyer = order.buyer?._id?.toString() === userId;
    const isSeller = order.items.some(item => (item.seller?._id || item.seller)?.toString() === userId);

    if (!isBuyer && !isSeller && req.user.role !== 'admin') throw createError('غير مصرح', 403);

    let invoiceItems = order.items;
    if (isSeller && !isBuyer && req.user.role !== 'admin') {
      invoiceItems = order.items.filter(item => (item.seller?._id || item.seller)?.toString() === userId);
    }

    const sellerSubtotal = invoiceItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    const invoiceData = {
      invoiceNumber: `INV-${order._id.toString().slice(-8).toUpperCase()}`,
      orderNumber: order.orderNumber || order._id.toString().slice(-6).toUpperCase(),
      date: order.createdAt,
      buyer: {
        name: `${order.buyer?.firstName || ''} ${order.buyer?.lastName || ''}`.trim(),
        email: order.buyer?.email,
        phone: order.buyer?.phone
      },
      items: invoiceItems.map(item => ({
        product: item.product?.title || item.product?.titleEn,
        quantity: item.quantity, price: item.price, total: item.quantity * item.price,
        color: item.color, size: item.size
      })),
      subtotal: (isSeller && !isBuyer) ? sellerSubtotal : order.subtotal,
      discount: (isSeller && !isBuyer) ? 0 : order.discount,
      shippingFee: (isSeller && !isBuyer) ? 0 : order.shippingFee,
      total: (isSeller && !isBuyer) ? sellerSubtotal : order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      isSellerInvoice: isSeller && !isBuyer
    };

    res.json(invoiceData);
  } catch (err) { next(err); }
};

export const cashingOrder = async (req, res, next) => {
  // هذه الدالة تم تكرار غرضها في createOrder أعلاه، إذا كنت تحتاجها لتدفق مختلف استخدم نفس نموذج הـ Transactions.
  // تم تحجيمها هنا للحفاظ على التوافقية إن استدعت الحاجة.
  res.status(400).json({ message: "يرجى استخدام مسار إنشاء الطلب الأساسي (createOrder)" });
};