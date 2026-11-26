import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { protect, isAdmin } from '../middlewares/auth.js';
import { trackEvent, getBehaviorAnalytics } from '../controllers/behavior.controller.js';

const router = express.Router();
// The browser calls this through the Next.js proxy, so every visitor shares the proxy IP.
// Limit per anonymous session id instead, otherwise the whole site shares one 120/min bucket and gets 429s.
const trackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120,
  keyGenerator: (req) => (req.body && typeof req.body.sid === 'string' && req.body.sid ? `sid:${req.body.sid.slice(0, 40)}` : ipKeyGenerator(req.ip)), standardHeaders: true, legacyHeaders: false, message: { success: false } });

router.post('/track', trackLimiter, trackEvent);
router.get('/admin', protect, isAdmin, getBehaviorAnalytics);

export default router;
