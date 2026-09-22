import express from 'express';
import {
  createRequest,
  getUserRequests,
  getAllRequests,
  getRequestById,
  updateRequestStatus,
  deleteRequest
} from '../controllers/unavailableProductRequest.controller.js';
import { protect, isAdmin } from '../middlewares/auth.js';
import { uploadSingleImage } from '../middlewares/upload.js';

const router = express.Router();

// Public route - create request (authenticated or guest)
router.post('/', uploadSingleImage, createRequest);

// Authenticated user routes
router.get('/my-requests', protect, getUserRequests);

// Admin routes
router.get('/admin', protect, isAdmin, getAllRequests);
router.get('/admin/:id', protect, isAdmin, getRequestById);
router.patch('/admin/:id/status', protect, isAdmin, updateRequestStatus);
router.delete('/admin/:id', protect, isAdmin, deleteRequest);

export default router;
