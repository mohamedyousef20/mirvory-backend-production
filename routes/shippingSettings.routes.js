import express from 'express';
import {
  getShippingSettings,
  updateShippingSettings,
  calculateShippingFee
} from '../controllers/shippingSettings.controller.js';
import { isAdmin, protect } from '../middlewares/auth.js';

const router = express.Router();

// Public routes
router.get('/', getShippingSettings);
router.post('/calculate', calculateShippingFee);

// Admin routes
router.use(protect);
router.use(isAdmin);
router.put('/', updateShippingSettings);

export default router;