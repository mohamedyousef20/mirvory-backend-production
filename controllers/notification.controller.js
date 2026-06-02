import Notification from '../models/notification.model.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const notifications = await Notification.find({
      $or: [
        { userId },
        { role, userId: { $exists: false } },
        { type: 'ALL_USERS', userId: { $exists: false } }
      ]
    }).sort({ createdAt: -1 }).lean();

    res.json({ success: true, notifications });
  } catch (error) { next(error); }
};

export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.body;
    if (!isValidObjectId(id)) throw createError("المعرف غير صالح", 400);
console.log(id,'ids147')
    const notification = await Notification.findByIdAndUpdate(
      id,
      {
        seen: true,
        deleteAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      },
      { new: true }
    );
    console.log(notification,'ids148')
    if (!notification) throw createError('الإشعار غير موجود', 404);
    res.json({ success: true, notification });
  } catch (error) { next(error); }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, seen: false },
      { $set: { seen: true, deleteAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } }
    );
    res.json({ success: true, message: 'تم تعليم الجميع كمقروء', modifiedCount: result.modifiedCount });
  } catch (error) { next(error); }
};

export const getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      $or: [{ userId: req.user._id, seen: false }, { role: req.user.role, seen: false }, { type: 'ALL_USERS', seen: false }],
    });
    res.json({ success: true, count });
  } catch (error) { next(error); }
};

export const sendNotification = async (req, res, next) => {
  try {
    // 🚨 أمان: الإدارة فقط ترسل إشعارات يدوية
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("مرفوض", 403);

    const { title, message, type, userId = [], role, orderId } = req.body;
    if (!title || !message || !type) throw createError('العنوان والرسالة ونوع الإشعار مطلوبة', 400);

    const io = req.app.get("io");

    // ✅ الاعتماد على المساعد (Helper) لضمان تشغيل الـ Sockets في الوقت الفعلي
    if (userId && userId.length > 0) {
      await createNotifications({
        io, title, message, type, actor: req.user._id, userId: userId, data: { orderId }, link: orderId ? `/orders/${orderId}` : '/'
      });
    } else if (role) {
      const targetUsers = await User.find({ role }).select('_id').lean();
      if (targetUsers.length > 0) {
        await createNotifications({
          io, title, message, type, actor: req.user._id, userId: targetUsers.map(u => u._id.toString()), data: { orderId }
        });
      }
    } else {
      // إشعار عام للجميع
      await createNotifications({
        io, title, message, type: 'ALL_USERS', actor: req.user._id, userId: [], data: {}
      });
    }
    res.status(201).json({ success: true, message: 'تم بث الإشعار بنجاح' });
  } catch (error) { next(error); }
};