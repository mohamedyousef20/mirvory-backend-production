import express from 'express';
import {
  getUserLoyalty,
  getUserLoyaltyTransactions,
  redeemPoints,
  adjustPoints,
  getAllUsersLoyalty,
  getAllTransactionsAdmin,
  getLoyaltyStats,
  getUserTransactionsAdmin
} from '../controllers/loyalty.controller.js';
import { protect, isAdmin } from '../middlewares/auth.js';

const router = express.Router();

// User routes (authenticated)
router.get('/my-loyalty', protect, getUserLoyalty);
router.get('/my-loyalty/transactions', protect, getUserLoyaltyTransactions);
router.post('/redeem', protect, redeemPoints);

// Admin routes
router.get('/admin/stats', protect, isAdmin, getLoyaltyStats);
router.get('/admin/transactions', protect, isAdmin, getAllTransactionsAdmin);
router.get('/admin/users', protect, isAdmin, getAllUsersLoyalty);
router.get('/admin/users/:userId/transactions', protect, isAdmin, getUserTransactionsAdmin);
router.post('/admin/adjust', protect, isAdmin, adjustPoints);

export default router;
