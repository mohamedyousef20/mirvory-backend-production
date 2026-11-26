// Manual payment (no payment provider): the customer transfers by InstaPay or Vodafone Cash,
// uploads a receipt image, and an admin confirms the payment from the dashboard.
import Order from '../models/order.model.js';
import GuestOrder from '../models/guestOrder.model.js';
import { MAX_RECEIPT_BYTES, detectImageType, uploadReceipt, fetchReceiptBytes, deleteReceipt } from '../utils/receiptStorage.js';
import createError from '../utils/error.js';
import { createNotifications } from '../utils/notification.js';
import { sendPushToAdmins } from '../utils/webPush.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';

// Payee details live here only. Override them with env vars on the server, no code change needed.
export const getPaymentInfoData = () => ({
  instapay: {
    link: process.env.INSTAPAY_LINK || 'https://ipn.eg/S/mohamed_yousef_leba/instapay/3xzUQZ',
    address: process.env.INSTAPAY_ADDRESS || 'mohamed_yousef_leba@instapay',
  },
  wallet: {
    provider: process.env.WALLET_PROVIDER || 'Vodafone Cash',
    number: process.env.WALLET_NUMBER || '01060167568',
  },
});

export const getPaymentInfo = (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: getPaymentInfoData() });
};

async function attachProof(order, file) {
  if (!file?.buffer) throw new createError('ارفع صورة الإيصال', 400);
  if (file.buffer.length > MAX_RECEIPT_BYTES) throw new createError('الصورة أكبر من 8 ميجا', 400);
  if (!detectImageType(file.buffer)) throw new createError('الملف لازم يكون صورة (JPG أو PNG أو WEBP)', 400);
  if (!['instapay', 'wallet'].includes(order.paymentMethod)) throw new createError('الطلب ده مش دفع بتحويل', 400);
  if (order.paymentStatus === 'paid') throw new createError('تم تأكيد الدفع بالفعل', 400);
  if (order.deliveryStatus === 'cancelled') throw new createError('الطلب ملغي', 400);

  // Keep the previous receipt id so the old private file can be removed after the new one is saved.
  const previous = await Order.findById(order._id).select('+paymentProof.publicId').lean();
  const result = await uploadReceipt(file.buffer);
  order.paymentProof = { publicId: result.public_id, uploadedAt: new Date() };
  order.paymentStatus = 'under_review';
  await order.save();
  if (previous?.paymentProof?.publicId) deleteReceipt(previous.paymentProof.publicId).catch(() => {});

  // Tell the admins there is a receipt to check. Never fail the upload because of a notification problem.
  try {
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id').lean();
    await createNotifications({
      title: '🧾 إيصال تحويل جديد',
      message: `إيصال جديد للطلب ${order.orderNumber || String(order._id).slice(-6)}، راجعه وأكد الدفع`,
      type: 'ORDER_PLACED',
      userId: admins.map((a) => String(a._id)),
      data: { orderId: order._id },
      link: '/admin',
    });
    await sendPushToAdmins({ title: '🧾 إيصال تحويل جديد', body: `الطلب ${order.orderNumber || ''}`, url: '/admin', tag: `receipt-${order._id}` });
  } catch (e) {
    console.error('payment proof notify failed', e?.message);
  }
  return order;
}

// POST /api/orders/:id/payment-proof (logged-in buyer)
export const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new createError('ID غير صالح', 400);
    const order = await Order.findById(req.params.id);
    if (!order || String(order.buyer) !== String(req.user._id)) throw new createError('الطلب غير موجود', 404);
    await attachProof(order, req.file);
    res.json({ success: true, paymentStatus: order.paymentStatus, uploadedAt: order.paymentProof.uploadedAt });
  } catch (err) { next(err); }
};

// POST /api/guest-orders/payment-proof (guest: order number + phone, same check as the order lookup)
export const uploadGuestPaymentProof = async (req, res, next) => {
  try {
    const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
    const orderNumber = String(req.body?.orderNumber || '').trim().replace(/^#/, '');
    if (phone.length < 10 || !orderNumber) throw new createError('رقم الموبايل ورقم الطلب مطلوبين', 400);
    const order = await Order.findOne({ orderNumber });
    const guest = order ? await GuestOrder.findOne({ order: order._id }).select('guestPhone').lean() : null;
    const stored = String(guest?.guestPhone || '').replace(/\D/g, '').slice(-10);
    if (!guest || stored !== phone) throw new createError('مفيش طلب بالبيانات دي', 404);
    await attachProof(order, req.file);
    res.json({ success: true, paymentStatus: order.paymentStatus });
  } catch (err) { next(err); }
};

// GET /api/orders/:id/payment-proof (admin only). Streams the receipt; the image is never exposed by URL.
export const viewPaymentProof = async (req, res, next) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) throw new createError('صلاحيات غير كافية', 403);
    if (!mongoose.isValidObjectId(req.params.id)) throw new createError('ID غير صالح', 400);
    const order = await Order.findById(req.params.id).select('+paymentProof.publicId').lean();
    const publicId = order?.paymentProof?.publicId;
    if (!publicId) throw new createError('مفيش إيصال للطلب ده', 404);
    const { buffer, contentType } = await fetchReceiptBytes(publicId);
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': 'inline; filename="receipt"',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  } catch (err) { next(err); }
};
