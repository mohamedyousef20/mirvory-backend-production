import express from 'express';
import {
  createProduct,
  getProducts,
  getProductById,
  approveProduct,
  rejectProduct,
  getProductsForAdmin,
  getFeaturedProducts,
  getNewArrivals,
  getSellerProducts,
  deleteProduct,
  updateProduct,
  searchProducts
} from '../controllers/product.controller.js';
import {
  createRating,
  getProductRatings,
  getUserRating,
  updateRating,
  deleteRating
} from '../controllers/rating.controller.js';
import { isAdmin, isSeller, protect } from '../middlewares/auth.js';
import { paginate } from '../middlewares/pagination.js';
import { sort } from '../middlewares/sort.js';
import { search, buildFilter, commonFilters } from '../middlewares/search.js';


const router = express.Router({ mergeParams: true });

// مسارات المسؤول
router.get('/admin-products', protect, isAdmin, paginate(12), sort(), buildFilter(commonFilters.product),  getProductsForAdmin);
router.patch('/approve', protect, isAdmin, approveProduct);
router.patch('/reject', protect, isAdmin, rejectProduct);

// مسارات البائع
router.get('/seller/products', protect, isSeller, paginate(12), sort(), buildFilter(commonFilters.product), getSellerProducts);
router.delete('/:id', protect, isSeller, deleteProduct);
router.patch('/:id', protect, isSeller, updateProduct);

// مسارات عامة
// Search products
router.get('/search', paginate(12), sort(), search(['title', 'description']), searchProducts);
// Get all products in category
router.get('/', paginate(12), sort(), buildFilter(commonFilters.product), search(['title', 'description']), getProducts);
// Get Featured products in category
router.get('/featured/product', getFeaturedProducts);
// Get New Arrivals products in category
router.get('/new/product', getNewArrivals);

// Get specific product in category
router.get('/:productId', getProductById);
// Create product in category
router.post('/', protect, isSeller, createProduct);

// Rating routes
router.post('/:productId/ratings', protect, createRating);
router.get('/:productId/ratings', paginate(12), sort({ createdAt: -1 }), getProductRatings);
router.get('/:productId/ratings/user', protect, getUserRating);
router.patch('/:productId/ratings/:ratingId', protect, updateRating);
router.delete('/:productId/ratings/:ratingId', protect, deleteRating);

export default router;
