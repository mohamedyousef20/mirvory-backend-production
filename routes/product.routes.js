import express from 'express';
import {
  createProduct,
  getProducts,
  getProductById,
  // updateProduct,
  // deleteProduct,
  // reviewProduct,
  // getPendingProducts,
  approveProduct,
  rejectProduct,
  getProductsForAdmin,
  createFilterObj,
  getFeaturedProducts,
  getNewArrivals,
  getSellerProducts,
  deleteProduct,
  updateProduct,
  createSortObj,
  searchProducts
} from '../controllers/product.controller.js';
import { isAdmin, isSeller, protect } from '../middlewares/auth.js';


const router = express.Router({ mergeParams: true });

// مسارات المسؤول
router.get('/admin-products', protect, isAdmin, getProductsForAdmin); // مراجعة المنتج
router.patch('/approve', protect, isAdmin, approveProduct); // مراجعة المنتج
router.patch('/reject', protect, isAdmin, rejectProduct); // مراجعة المنتج

// مسارات البائع
router.get('/seller/products', protect, isSeller,createSortObj, getSellerProducts ); // مراجعة المنتج
router.delete('/:id', protect, isSeller, deleteProduct ); // مراجعة المنتج
router.patch('/:id', protect, isSeller, updateProduct ); // مراجعة المنتج

// مسارات عامة
// Search products
router.get('/search', createFilterObj, createSortObj, searchProducts);
// Get all products in category
router.get('/', createFilterObj,createSortObj, getProducts); 
// Get Featured products in category
router.get('/featured/product', getFeaturedProducts); 
// Get New Arrivals products in category
router.get('/new/product', getNewArrivals); 

// Get specific product in category
router.get('/:productId', createFilterObj, getProductById);
// Create product in category
router.post('/', protect, isSeller, createProduct);

export default router;
