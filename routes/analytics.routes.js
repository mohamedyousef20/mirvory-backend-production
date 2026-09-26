import express from 'express';
import { protect, isSeller, isAdmin } from '../middlewares/auth.js';
import {
  getSellerAnalytics,
  getAdminAnalytics
} from '../controllers/dashboard.controller.js';
import { getFullAdminAnalytics } from '../controllers/analytics.controller.js';

const router = express.Router();

// Analytics Routes
router.get('/seller', protect, isSeller, getSellerAnalytics);
router.get('/admin', protect, isAdmin, getAdminAnalytics);

// Full analytics (with filters, KPIs, charts, tables)
router.get('/admin/full', protect, isAdmin, getFullAdminAnalytics);

export default router;
