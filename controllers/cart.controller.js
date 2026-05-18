import Cart from '../models/cart.model.js'
import Product from '../models/product.model.js';
import asyncHandler from 'express-async-handler';

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
export const getCart = asyncHandler(async (req, res) => {
  console.log(req.user._id,'req.user.id')
  const cart = await Cart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      select: 'title titleEn images price seller'
    });

  if (!cart) {
    return res.status(404).json({ message: 'Cart not found' });
  }

  res.json(cart);
});

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
export const addToCart = asyncHandler(async (req, res) => {
  console.log(req.body, 'cart function>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<')

  const { productId } = req.body;
  let { quantity, sizes, colors } = req.body;

  quantity = parseInt(quantity) || 1;
  sizes = Array.isArray(sizes) ? sizes : (sizes ? [sizes] : []);
  colors = Array.isArray(colors) ? colors : (colors ? [colors] : []);

  // التحقق من وجود المنتج
  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  // فرض حدود المخزون
  let cart = await Cart.findOne({ user: req.user._id });
  const existingQty = cart ? cart.items
    .filter(i => i.product.toString() === productId)
    .reduce((sum, i) => sum + i.quantity, 0) : 0;
  if (existingQty + quantity > product.quantity) {
    return res.status(400).json({ message: 'Requested quantity exceeds stock' });
  }

  // تحقق من التوافق بين الكمية والاختيارات
  if (sizes.length && sizes.length !== quantity) {
    return res.status(400).json({ message: 'Sizes count must equal quantity' });
  }
  if (colors.length && colors.length !== quantity) {
    return res.status(400).json({ message: 'Colors count must equal quantity' });
  }

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  // إضافة عناصر منفصلة لكل قطعة لاجل صيانة المقاسات/الألوان
  for (let i = 0; i < quantity; i++) {
    cart.items.push({
      product: productId,
      quantity: 1,
      price: product.price,
      sizes: sizes.length ? [sizes[i]] : [],
      colors: colors.length ? [colors[i]] : []
    });
  }

  await cart.updateTotal();
  res.json(cart);
});

// @desc    Update cart item
// @route   PUT /api/cart/:itemId
// @access  Private
export const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    return res.status(404).json({ message: 'Cart not found' });
  }

  const itemIndex = cart.items.findIndex(item => item._id.toString() === req.params.itemId);

  if (itemIndex === -1) {
    return res.status(404).json({ message: 'Item not found in cart' });
  }

  cart.items[itemIndex].quantity = quantity;
  await cart.updateTotal();

  res.json(cart);
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
export const removeFromCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    return res.status(404).json({ message: 'Cart not found' });
  }

  cart.items = cart.items.filter(item => item._id.toString() !== req.params.itemId);
  await cart.updateTotal();

  res.json(cart);
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
export const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    return res.status(404).json({ message: 'Cart not found' });
  }

  cart.items = [];
  cart.total = 0;
  await cart.save();

  res.json(cart);
});


export const getCartCount = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });

  let count = 0;
  if (cart && cart.items) {
    count = cart.items.reduce((total, item) => total + item.quantity, 0);
  }

  res.json({
    success: true,
    count
  });
});