import Cart from '../models/cart.model.js';
import { priceOrder } from '../services/promotion.service.js';
import Product from '../models/product.model.js';
import asyncHandler from 'express-async-handler';
import createError from '../utils/error.js';
import { resolveSelection, findColor, findSizeEntry } from '../utils/inventory.js';

// Attach, to every cart item, the stock that is available for ITS color + size
// (so the UI can cap the quantity and show "sold out" correctly).
const withItemStock = (cart) => {
  const obj = typeof cart.toObject === 'function' ? cart.toObject() : cart;
  obj.items = (obj.items || []).map((item) => {
    const product = item.product && typeof item.product === 'object' ? item.product : null;
    let availableStock = null;
    if (product?.colors) {
      const color = findColor(product, item.colors?.[0]);
      const sizeEntry = color && color.available !== false ? findSizeEntry(color, item.sizes?.[0]) : null;
      availableStock = sizeEntry ? sizeEntry.quantity : 0;
    }
    return { ...item, availableStock };
  });
  return obj;
};

export const getCart = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user._id })
    .populate({ path: 'items.product', select: 'title titleEn colors price discountedPrice seller quantity status category' });

  if (!cart) return res.status(404).json({ message: 'السلة غير موجودة' });

  // Display-only breakdown: the same service that prices the order, so the cart
  // shows exactly what checkout will charge (promotions + free shipping).
  try {
    const pricing = await priceOrder({
      items: cart.items.map((i) => ({ product: i.product, quantity: i.quantity })),
      deliveryMethod: req.query.deliveryMethod === 'pickup' ? 'pickup' : 'home',
      address: req.query.address || '',
      couponDiscount: cart.appliedCoupon?.discountAmount || 0,
      couponCode: cart.appliedCoupon?.code || null,
    });
    const payload = withItemStock(cart);
    return res.json({ ...payload, pricing });
  } catch (pricingError) {
    console.error('[cart] pricing preview failed:', pricingError.message);
  }

  res.json(withItemStock(cart));
});

export const addToCart = asyncHandler(async (req, res, next) => {
  const { productId } = req.body;
  let { quantity = 1, sizes, colors, size, color } = req.body;

  quantity = parseInt(quantity);
  if (!quantity || quantity <= 0) return next(new createError("الكمية يجب أن تكون أكبر من صفر", 400));

  // The client may send one color/size (preferred) or the legacy per-unit arrays.
  sizes = Array.isArray(sizes) ? sizes : (sizes ? [sizes] : (size ? [size] : []));
  colors = Array.isArray(colors) ? colors : (colors ? [colors] : (color ? [color] : []));

  if (!sizes.length || !colors.length) {
    return next(new createError("اختر اللون والمقاس أولاً", 400));
  }
  // Every unit of one add-to-cart call belongs to the same color + size selection
  const colorValue = colors[0];
  const sizeValue = sizes[0];
  if (colors.some(c => c !== colorValue) || sizes.some(s => s !== sizeValue)) {
    return next(new createError("أضف كل لون ومقاس كعنصر منفصل", 400));
  }

  const product = await Product.findById(productId).lean();
  if (!product) return next(new createError("المنتج غير موجود", 404));
  if (!product.isApproved || product.status !== "available") {
    return next(new createError("هذا المنتج غير متاح للشراء حالياً", 400));
  }

  // البائع لا يمكنه شراء منتجاته
  if (product.seller.toString() === req.user._id.toString()) {
    return next(new createError("لا يمكنك إضافة منتجاتك إلى سلة التسوق", 403));
  }

  const cart = await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id, items: [] } },
    { upsert: true, new: true }
  );

  // Same product + same color + same size = one cart line. A different color or size is a different line.
  const existingItem = cart.items.find(item =>
    item.product.toString() === productId &&
    (item.sizes[0] || null) === sizeValue &&
    (item.colors[0] || null) === colorValue
  );

  const wantedQty = (existingItem?.quantity || 0) + quantity;
  // Throws a clear message when the color/size does not exist, is inactive, or is short on stock
  const { color: selectedColor } = resolveSelection(product, colorValue, sizeValue, wantedQty);

  if (existingItem) {
    existingItem.quantity = wantedQty;
    existingItem.image = selectedColor.image;
    existingItem.colorName = selectedColor.name;
  } else {
    cart.items.push({
      product: productId,
      quantity,
      price: product.price,
      sizes: [sizeValue],
      colors: [colorValue],
      colorName: selectedColor.name,
      image: selectedColor.image,
    });
  }

  await cart.updateTotal();
  res.json(cart);
});

export const updateCartItem = asyncHandler(async (req, res, next) => {
  const { itemId, quantity } = req.body;
  const parsedQty = parseInt(quantity);

  if (!parsedQty || parsedQty <= 0) return next(new createError("الكمية يجب أن تكون أكبر من صفر", 400));

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(new createError("السلة غير موجودة", 404));

  const item = cart.items.find(i => i._id.toString() === itemId);
  if (!item) return next(new createError("المنتج غير موجود في السلة", 404));

  const product = await Product.findById(item.product).select('title colors status isApproved').lean();
  if (!product || product.status !== 'available') return next(new createError("هذا المنتج لم يعد متاحاً", 400));

  // Check the stock of THIS item's color + size only. Color/size are never changed here.
  resolveSelection(product, item.colors[0], item.sizes[0], parsedQty);

  item.quantity = parsedQty;
  await cart.updateTotal();

  res.json(cart);
});

export const removeFromCart = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(new createError("السلة غير موجودة", 404));

  cart.items = cart.items.filter(item => item._id.toString() !== req.params.itemId);
  if (typeof cart.updateTotal === 'function') await cart.updateTotal();
  else await cart.save();

  res.json(cart);
});

export const clearCart = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(new createError("السلة غير موجودة", 404));

  cart.items = [];
  cart.total = 0;
  cart.appliedCoupon = undefined;
  await cart.save();

  res.json(cart);
});

export const getCartCount = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).lean();
  let count = 0;
  if (cart && cart.items) count = cart.items.reduce((total, item) => total + item.quantity, 0);
  res.json({ success: true, count });
});