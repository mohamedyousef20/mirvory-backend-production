import expressAsyncHandler from 'express-async-handler';
import Notification from '../models/notification.model.js';
import User from '../models/user.model.js';


// Get all notifications for the logged-in user
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const notifications = await Notification.find({
      $or: [
        { userId },
        { role },
        { type: 'ALL_USERS' },
      ],
    }).sort({ createdAt: -1 });

    res.json({ success: true, notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'فشل في جلب الإشعارات' });
  }
};

// Mark a specific notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { seen: true, deleteAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
      { new: true }
    );

    if (!notification) return res.status(404).json({ message: 'الإشعار غير موجود' });

    res.json({ success: true, notification });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'فشل في تحديث حالة الإشعار' });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { userId, seen: false },
      {
        $set: {
          seen: true,
          deleteAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      }
    );

    res.json({
      success: true,
      message: 'تم تعليم جميع الإشعارات كمقروءة',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'فشل في تحديث الإشعارات' });
  }
};

// Get unread notifications count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const count = await Notification.countDocuments({
      $or: [
        { userId, seen: false },
        { role, seen: false },
        { type: 'ALL_USERS', seen: false },
      ],
    });

    res.json({ success: true, count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ message: 'فشل في جلب عدد الإشعارات غير المقروءة' });
  }
};


export const searchUsers = async (req, res) => {
  try {
    const { q, role } = req.query;

    if (!q || q.trim() === "") {
      return res.status(400).json({ message: 'كلمة البحث مطلوبة' });
    }

    const searchFilter = {
      $or: [
        { firstName: { $regex: q, $options: 'i' } },
        { lastName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } }
      ]
    };

    // Add role filter if specified
    if (role && ['user', 'seller'].includes(role)) {
      searchFilter.role = role;
    }

    const users = await User.find(searchFilter)
      .select('_id firstName lastName email phone role')
      .limit(20); // Limit results for performance

    res.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({
      message: 'حدث خطأ أثناء البحث',
      error: error.message,
    });
  }
};

// Send a new notification (updated to handle selected users)
export const sendNotification = async (req, res) => {
  try {
    const { title, message, type, userIds = [], role, orderId } = req.body;

    if (!title || !message || !type) {
      return res.status(400).json({ message: 'العنوان والرسالة ونوع الإشعار مطلوبة' });
    }

    let targetUsers = [];

    if (userIds.length > 0) {
      // Specific users/sellers from search
      targetUsers = await User.find({ _id: { $in: userIds } });

      if (targetUsers.length !== userIds.length) {
        return res.status(400).json({ message: 'بعض المستخدمين غير موجودين' });
      }
    } else if (role) {
      // All users by role (seller / user)
      targetUsers = await User.find({ role });
    }

    const notifications = [];

    if (targetUsers.length > 0) {
      // Create notifications for each user
      for (const user of targetUsers) {
        notifications.push({
          userId: user._id,
          title,
          message,
          type,
          role: user.role,
          orderId,
          seen: false,
        });
      }
    } else {
      // Broadcast notification
      notifications.push({
        title,
        message,
        type: 'ALL_USERS',
        seen: false,
      });
    }

    await Notification.insertMany(notifications);

    res.status(201).json({
      success: true,
      message: 'تم إرسال الإشعارات بنجاح',
      count: notifications.length,
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      message: 'حدث خطأ أثناء إرسال الإشعار',
      error: error.message,
    });
  }
};
export const getNotificationCount = expressAsyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ userId: req.user._id });
  console.log(count)

  res.json({
    success: true,
    count
  });
});
