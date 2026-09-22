import express from 'express';
import {
  createOffer,
  getOffers,
  getActiveOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
  toggleOfferStatus
} from '../controllers/offer.controller.js';
import { isAdmin, protect } from '../middlewares/auth.js';
import { uploadSingleImage } from '../middlewares/upload.js';

const router = express.Router();

// Public route for active offers
router.get('/active', getActiveOffers);

// Admin routes - all protected
router.use(protect);
router.use(isAdmin);

// CRUD operations
router.post('/', uploadSingleImage, createOffer);
router.get('/', getOffers);
router.get('/:id', getOfferById);
router.patch('/:id', uploadSingleImage, updateOffer);
router.delete('/:id', deleteOffer);
router.patch('/:id/toggle', toggleOfferStatus);

export default router;