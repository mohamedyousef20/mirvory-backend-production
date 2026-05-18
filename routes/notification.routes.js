import express from 'express';
import {
    getNotifications,
    markAsRead,
    sendNotification,
    getUnreadCount,
    markAllAsRead,
    searchUsers,
    getNotificationCount
} from '../controllers/notification.controller.js';
import { isAdmin, protect } from '../middlewares/auth.js';

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// User routes
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read/:id', markAsRead);
router.put('/read-all', markAllAsRead);
router.get("/search", searchUsers);
router.get("/count", getNotificationCount );

// Admin-only routes
router.post('/', isAdmin, sendNotification);

export default router;
