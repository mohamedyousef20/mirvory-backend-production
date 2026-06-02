import express from 'express';
import {
    getNotifications,
    markAsRead,
    sendNotification,
    getUnreadCount,
    markAllAsRead,
} from '../controllers/notification.controller.js';
import { isAdmin, protect } from '../middlewares/auth.js';

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// User routes
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/read', markAsRead);
router.put('/read-all', markAllAsRead);
router.get("/count", getUnreadCount );

// Admin-only routes
router.post('/', isAdmin, sendNotification);

export default router;
