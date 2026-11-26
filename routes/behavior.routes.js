import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, isAdmin } from '../middlewares/auth.js';
import { trackEvent, getBehaviorAnalytics } from '../controllers/behavior.controller.js';

const router = express.Router();
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false } });

router.post('/track', trackLimiter, trackEvent);
router.get('/admin', protect, isAdmin, getBehaviorAnalytics);

export default router;
