import Wishlist from '../models/wishlist.model.js';
import Product from '../models/product.model.js';
import asyncHandler from 'express-async-handler';

// @desc    Get user wishlist
// @route   GET /api/wishlist
// @access  Private
export const getWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    // Create empty wishlist if it doesn't exist
    wishlist = await Wishlist.create({
      user: req.user._id,
      products: []
    });
  }

  res.json({
    success: true,
    data: wishlist
  });
});

// @desc    Add product to wishlist
// @route   POST /api/wishlist
// @access  Private
// export const addToWishlist = asyncHandler(async (req, res) => {
//   const { productId } = req.body;

//   if (!productId) {
//     return res.status(400).json({ 
//       success: false,
//       message: 'Product ID is required' 
//     });
//   }

//   // Check if product exists
//   const product = await Product.findById(productId);
//   if (!product) {
//     return res.status(404).json({ 
//       success: false,
//       message: 'Product not found' 
//     });
//   }

//   // Find or create wishlist
//   let wishlist = await Wishlist.findOne({ user: req.user._id });

//   if (!wishlist) {
//     wishlist = await Wishlist.create({
//       user: req.user._id,
//       products: [{ product: productId }]
//     });
//   } else {
//     // Check if product already in wishlist
//     const exists = wishlist.products.some(
//       item => item.product.toString() === productId
//     );

//     if (exists) {
//       return res.status(400).json({ 
//         success: false,
//         message: 'Product already in wishlist' 
//       });
//     }

//     wishlist.products.push({ product: productId });
//     await wishlist.save();
//   }

//   // Populate the wishlist before sending response
//   wishlist = await Wishlist.findById(wishlist._id);

//   res.status(201).json({
//     success: true,
//     message: 'Product added to wishlist',
//     data: wishlist
//   });
// });

// @desc    Remove product from wishlist
// @route   DELETE /api/wishlist/:productId
// // @access  Private
// export const removeFromWishlist = asyncHandler(async (req, res) => {
//   const { productId } = req.params;

//   const wishlist = await Wishlist.findOne({ user: req.user._id });

//   if (!wishlist) {
//     return res.status(404).json({ 
//       success: false,
//       message: 'Wishlist not found' 
//     });
//   }

//   // Remove product from wishlist
//   wishlist.products = wishlist.products.filter(
//     item => item.product._id.toString() !== productId
//   );

//   await wishlist.save();

//   res.json({
//     success: true,
//     message: 'Product removed from wishlist',
//     data: wishlist
//   });
// });

// @desc    Toggle product in wishlist (add if not exists, remove if exists)
// @route   POST /api/wishlist/toggle
// @access  Private
export const toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  console.log(productId, 'productId')
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: 'Product ID is required'
    });
  }

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  // Find or create wishlist
  let wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    wishlist = await Wishlist.create({
      user: req.user._id,
      products: [{ product: productId }]
    });
    console.log(wishlist,'wishlist')
    wishlist = await Wishlist.findById(wishlist._id);

    return res.json({
      success: true,
      message: 'Product added to wishlist',
      isFavorite: true,
      data: wishlist
    });
  }

  // Check if product is in wishlist
  const productIndex = wishlist.products.findIndex(
    item => item.product._id.toString() === productId
  );

  if (productIndex !== -1) {
    // Remove from wishlist
    wishlist.products.splice(productIndex, 1);
    await wishlist.save();

    return res.json({
      success: true,
      message: 'Product removed from wishlist',
      isFavorite: false,
      data: wishlist
    });
  } else {
    // Add to wishlist
    wishlist.products.push({ product: productId });
    await wishlist.save();

    wishlist = await Wishlist.findById(wishlist._id);

    return res.json({
      success: true,
      message: 'Product added to wishlist',
      isFavorite: true,
      data: wishlist
    });
  }
});

// @desc    Check if product is in wishlist
// @route   GET /api/wishlist/check/:productId
// @access  Private
export const checkFavorite = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    return res.json({
      success: true,
      isFavorite: false
    });
  }

  const isFavorite = wishlist.products.some(
    item => item.product._id.toString() === productId
  );

  res.json({
    success: true,
    isFavorite
  });
});

// @desc    Clear wishlist
// @route   DELETE /api/wishlist
// @access  Private
export const clearWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  wishlist.products = [];
  await wishlist.save();

  res.json({
    success: true,
    message: 'Wishlist cleared',
    data: wishlist
  });
});

// @desc    Get wishlist count
// @route   GET /api/wishlist/count
// @access  Private
export const getWishlistCount = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id }).select("products");

  const count = wishlist ? wishlist.products.length : 0;

  res.json({
    success: true,
    count
  });
});




