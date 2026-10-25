import express from 'express';
import {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  togglePromotionStatus,
  deletePromotion,
  previewPromotion,
  getActivePromotions,
  getFreeShippingStatus,
} from '../controllers/promotion.controller.js';
import { isAdmin, protect } from '../middlewares/auth.js';
import { paginate } from '../middlewares/pagination.js';

const router = express.Router();

// ── Public storefront routes ────────────────────────────────────────────────
router.get('/active', getActivePromotions);
router.get('/free-shipping-status', getFreeShippingStatus);

// ── Admin routes ────────────────────────────────────────────────────────────
router.use(protect);
router.use(isAdmin);

router.post('/preview', previewPromotion);
router.post('/', createPromotion);
router.get('/', paginate(20), getPromotions);
router.get('/:id', getPromotionById);
router.patch('/:id/toggle', togglePromotionStatus);
router.patch('/:id', updatePromotion);
router.delete('/:id', deletePromotion);

export default router;
