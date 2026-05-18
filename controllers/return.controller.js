import ReturnRequest from '../models/returnRequest.model.js';
import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import { createNotifications } from '../utils/notification.js';
import User from '../models/user.model.js';

export const createReturnRequest = async (req, res) => {
  try {
    const { orderId, reason, itemId, customerInfo, images } = req.body;
    // 1. جلب الطلب والتأكد من وجوده
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    // 2. التحقق من ملكية الطلب (تصحيح: buyer هو ID مباشرة بدون ._id)
    if (order.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'غير مصرح لك، هذا الطلب لا ينتمي لحسابك' });
    }

    // Check 14-day return window
    if (order.deliveryStatus === 'delivered' && order.deliveredAt) {
      const daysSinceDelivery = Math.floor((new Date() - new Date(order.deliveredAt)) / (1000 * 60 * 60 * 24));
      if (daysSinceDelivery > 14) {
        return res.status(400).json({
          message: `انتهت فترة الإرجاع (14 يوم). مضت ${daysSinceDelivery} يومًا منذ التسليم`
        });
      }
    }

    // 3. التحقق من حالة الطلب (منطقياً: يجب أن يكون تم الاستلام للإرجاع)
    if (order.deliveryStatus !== 'delivered') {
      return res.status(400).json({
        message: 'لا يمكن تقديم طلب إرجاع لطلب لم يتم توصيله بعد'
      });
    }

    // 4. البحث عن العنصر داخل مصفوفة items باستخدام _id الخاص بالسطر
    // هذا هو الإصلاح الرئيسي للمشكلة التي واجهتها
    const orderItem = order.items.find(item => item._id.toString() === itemId);

    if (!orderItem) {
      return res.status(404).json({ message: 'العنصر المحدد غير موجود في بيانات هذا الطلب' });
    }

    //  منع تكرار طلب الإرجاع لنفس العنصر
    const existingReturnRequest = await ReturnRequest.findOne({
      user: req.user._id,
      order: orderId,
      item: itemId,
      status: { $in: ['pending', 'approved', 'processing'] }
    });

    if (existingReturnRequest) {
      return res.status(400).json({
        message: 'لديك بالفعل طلب إرجاع نشط لهذا العنصر',
        status: existingReturnRequest.status
      });
    }

    // 6. التحقق من الرفض الحديث (Anti-spam)
    const recentlyRejected = await ReturnRequest.findOne({
      user: req.user._id,
      order: orderId,
      item: itemId,
      status: 'rejected',
      createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) }
    });

    if (recentlyRejected) {
      return res.status(400).json({
        message: 'تم رفض طلب سابق لهذا العنصر مؤخراً. يرجى المحاولة مرة أخرى بعد 48 ساعة'
      });
    }

    // 7. إنشاء طلب الإرجاع الجديد
    const returnRequest = new ReturnRequest({
      user: req.user._id,
      order: orderId,
      product: orderItem.product,
      seller: orderItem.seller,
      reason,
      item: itemId,
      images: images || [],   
      status: 'pending'
    });

    await returnRequest.save();

    // 8. إرسال التنبيهات (Socket.io)
    try {
      const io = req.app.get("io");
      const adminUsers = await User.find({ role: 'admin' });

      // تنبيه البائع
      await createNotifications({
        io,
        title: '🔙 طلب استرجاع جديد',
        message: `تم تقديم طلب استرجاع للمنتج في الطلب #${order.orderNumber || order._id.toString().slice(-6)}`,
        type: 'RETURN_REQUESTED',
        actor: req.user._id,
        userIds: [orderItem.seller.toString()],
        data: { returnId: returnRequest._id, orderId: order._id },
        link: `/seller/returns/${returnRequest._id}`,
      });

      // تنبيه المشتري
      await createNotifications({
        io,
        title: '✅ تم تقديم طلب الاسترجاع',
        message: `تم استلام طلب استرجاعك للطلب #${order.orderNumber || order._id.toString().slice(-6)} وجاري مراجعته`,
        type: 'RETURN_REQUESTED',
        actor: req.user._id,
        userIds: [order.buyer.toString()],
        data: { returnId: returnRequest._id, orderId: order._id },
        link: `/returns/${returnRequest._id}`,
      });

      // تنبيه المسؤولين (Admins)
      if (adminUsers.length > 0) {
        await createNotifications({
          io,
          title: '📦 طلب استرجاع جديد للإدارة',
          message: `طلب استرجاع من ${req.user.firstName} للطلب #${order.orderNumber || order._id.toString().slice(-6)}`,
          type: 'RETURN_REQUESTED',
          actor: req.user._id,
          userIds: adminUsers.map(a => a._id.toString()),
          data: { returnId: returnRequest._id, orderId: order._id },
          link: `/admin/returns/${returnRequest._id}`,
        });
      }
    } catch (notificationError) {
      console.error('Notification Error:', notificationError.message);
      // لا نعيد خطأ للمستخدم لأن الطلب تم حفظه بنجاح بالفعل
    }

    // 9. الاستجابة الناجحة
    res.status(201).json({
      message: 'تم تقديم طلب الإرجاع بنجاح',
      returnRequest
    });

  } catch (error) {
    console.error('Full Error:', error);
    res.status(500).json({ message: 'حدث خطأ داخلي في الخادم' });
  }
};

export const getReturnRequests = async (req, res) => {
  try {
    console.log('getReturnRequests')
    // جلب طلبات الاسترجاع الخاصة بالبائع أو المستخدم
    const returnRequests = await ReturnRequest.find({
      $or: [
        { user: req.user._id },
        { seller: req.user._id }
      ]
    })
      .populate('order')
      .populate('product')
      .sort({ createdAt: -1 });

    res.json(returnRequests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


export const getReturnRequestsForAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // جلب طلبات الاسترجاع الخاصة بالبائع أو المستخدم
    const returnRequests = await ReturnRequest.find({})
      .populate('user', 'name email phone')
      .populate('seller', 'firstName lastName email phone')
      .populate('order', 'orderNumber buyer')
      .populate('product', 'title price images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ReturnRequest.countDocuments();

    res.json({
      data: returnRequests,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Additional function to check if user can create return request
export const canCreateReturnRequest = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;

    const existingReturnRequest = await ReturnRequest.findOne({
      user: req.user._id,
      order: orderId,
      item: itemId,
      status: { $in: ['pending', 'approved', 'processing'] }
    });

    const canCreate = !existingReturnRequest;

    res.json({
      canCreate,
      existingRequest: canCreate ? null : {
        id: existingReturnRequest._id,
        status: existingReturnRequest.status,
        createdAt: existingReturnRequest.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateReturnStatus = async (req, res) => {
  try {
    const { status, returnId } = req.body;

    console.log(req.body, 'req.body')
    console.log(status, 'status')
    console.log(returnId, 'returnId')
    const validStatuses = ['pending', 'approved', 'rejected', 'processed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'حالة الإرجاع غير صحيحة' });
    }

    // ابحث عن الطلب
    const returnRequest = await ReturnRequest.findById(returnId);
    console.log(returnRequest, 'returnRequest')
    if (!returnRequest) {
      return res.status(404).json({ message: 'طلب الإرجاع غير موجود' });
    }

    // حدّث الحالة والملاحظات إن وُجدت
    returnRequest.status = status;
    // if (adminNote) returnRequest.adminNote = adminNote;

    await returnRequest.save();

    // Send notifications via socket based on status
    try {
      const io = req.app.get("io");

      // Status messages for buyer
      const buyerMessages = {
        approved: '✅ تم الموافقة على طلب الإرجاع الخاص بك، وسيتم التنسيق معك قريباً.',
        rejected: '❌ تم رفض طلب الإرجاع الخاص بك.',
        processed: '💸 تم استرجاع المبلغ بنجاح وإغلاق الطلب.',
      };

      // Status messages for seller
      const sellerMessages = {
        approved: '🔔 تمت الموافقة على طلب إرجاع منتج من طلباتك.',
        rejected: '🚫 تم رفض طلب الإرجاع الخاص بمنتج من متجرك.',
        processed: '💸 تم إكمال عملية الإرجاع لهذا الطلب.',
      };

      // Notify buyer
      await createNotifications({
        io,
        title: '📢 تحديث حالة طلب الإرجاع',
        message: buyerMessages[status] || 'تم تحديث حالة طلب الإرجاع الخاص بك.',
        type: 'RETURN_STATUS_UPDATED',
        actor: req.user._id,
        userIds: [returnRequest.user._id.toString()],
        data: { returnId: returnRequest._id, status },
        link: `/returns/${returnRequest._id}`,
      });

      // Notify seller
      await createNotifications({
        io,
        title: '📢 تحديث حالة طلب الإرجاع',
        message: sellerMessages[status] || 'تم تحديث حالة طلب الإرجاع الخاص بمنتج من متجرك.',
        type: 'RETURN_STATUS_UPDATED',
        actor: req.user._id,
        userIds: [returnRequest.seller._id.toString()],
        data: { returnId: returnRequest._id, status },
        link: `/seller/returns/${returnRequest._id}`,
      });
    } catch (notificationError) {
      console.error('Failed to create status update notifications:', notificationError);
    }

    res.json({
      message: 'تم تحديث حالة طلب الإرجاع بنجاح',
      returnRequest,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};


// delete 
export const deleteReturnRequest = async (req, res) => {
  try {
    const { id } = req.body;
    console.log(req.body, 'ddddddddddddddddddddddddddddd')
    console.log(id, 'im in delete return request >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    await ReturnRequest.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'تم حذف طلب الارجاع بنجاح'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
};