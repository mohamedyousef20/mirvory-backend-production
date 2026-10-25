import mongoose from 'mongoose';
import Promotion from '../models/promotion.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import createError from '../utils/error.js';
import AuditLogService from '../services/auditLog.service.js';
import { priceOrder, freeShippingProgress } from '../services/promotion.service.js';
import { evaluatePromotions, isPromotionLive } from '../utils/promotionMath.js';
import { buildPaginationMeta, parsePageParams, withStableTiebreaker } from '../utils/pagination.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const KINDS = ['free_shipping', 'limited_time', 'quantity', 'gift', 'bundle'];
const STATUSES = ['draft', 'scheduled', 'active', 'paused', 'expired'];
const MAX_PCT = 100;

/** Rejects incomplete / unverifiable settings — never allows a broken promotion. */
export const validatePromotionPayload = async (payload, { forActivation = false } = {}) => {
  const errors = [];
  const now = new Date();

  if (!payload.name || !String(payload.name).trim()) errors.push('اسم العرض مطلوب');
  if (!KINDS.includes(payload.kind)) errors.push('نوع العرض غير صحيح');
  if (payload.status && !STATUSES.includes(payload.status)) errors.push('حالة العرض غير صحيحة');

  const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
  const endsAt = payload.endsAt ? new Date(payload.endsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) errors.push('تاريخ البداية غير صحيح');
  if (!endsAt || Number.isNaN(endsAt.getTime())) errors.push('تاريخ النهاية غير صحيح');
  if (startsAt && endsAt && startsAt >= endsAt) errors.push('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');

  const cfg = payload.config || {};

  if (payload.kind === 'free_shipping') {
    const min = Number(cfg.minOrderAmount ?? 0);
    if (!Number.isFinite(min) || min < 0) errors.push('الحد الأدنى للشحن المجاني غير صحيح');
    if (min > 1000000) errors.push('الحد الأدنى للشحن المجاني غير منطقي');
  }

  if (payload.kind === 'limited_time' || payload.kind === 'quantity') {
    const value = Number(cfg.discountValue ?? 0);
    if (!Number.isFinite(value) || value < 0) errors.push('قيمة الخصم غير صحيحة');
    if (cfg.discountType === 'percentage' && value > MAX_PCT) errors.push('النسبة المئوية يجب أن تكون بين 0 و 100');
    if (cfg.discountType === 'fixed' && value <= 0) errors.push('قيمة الخصم الثابت يجب أن تكون أكبر من صفر');
    if (cfg.maxDiscountAmount !== null && cfg.maxDiscountAmount !== undefined) {
      const max = Number(cfg.maxDiscountAmount);
      if (!Number.isFinite(max) || max < 0) errors.push('الحد الأقصى للخصم غير صحيح');
    }
  }

  if (payload.kind === 'quantity' || payload.kind === 'bundle' || payload.kind === 'gift') {
    const qty = Number(cfg.minQuantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1) errors.push('الكمية المطلوبة يجب أن تكون رقم صحيح أكبر من صفر');
  }

  if (payload.kind === 'bundle') {
    const price = Number(cfg.bundlePrice);
    if (!Number.isFinite(price) || price <= 0) errors.push('سعر الباقة مطلوب ويجب أن يكون أكبر من صفر');
  }

  if (payload.kind === 'gift') {
    if (!cfg.giftProduct || !isValidObjectId(cfg.giftProduct)) {
      errors.push('منتج الهدية مطلوب');
    } else {
      const gift = await Product.findOne({ _id: cfg.giftProduct, status: 'available' }).select('_id').lean();
      if (!gift) errors.push('منتج الهدية غير موجود أو غير متاح');
    }
    const gq = Number(cfg.giftQuantity ?? 1);
    if (!Number.isInteger(gq) || gq < 1) errors.push('كمية الهدية يجب أن تكون رقم صحيح أكبر من صفر');
  }

  // scope must reference real products/categories
  const scope = payload.scope || {};
  if (Array.isArray(scope.products) && scope.products.length) {
    const bad = scope.products.filter((id) => !isValidObjectId(id));
    if (bad.length) errors.push('معرف منتج غير صحيح داخل نطاق العرض');
    const found = await Product.countDocuments({ _id: { $in: scope.products.filter(isValidObjectId) } });
    if (found !== scope.products.filter(isValidObjectId).length) errors.push('بعض المنتجات المختارة غير موجودة');
  }
  if (Array.isArray(scope.categories) && scope.categories.length) {
    const bad = scope.categories.filter((id) => !isValidObjectId(id));
    if (bad.length) errors.push('معرف تصنيف غير صحيح داخل نطاق العرض');
  }

  if (payload.usageLimit !== null && payload.usageLimit !== undefined && payload.usageLimit !== '') {
    const limit = Number(payload.usageLimit);
    if (!Number.isInteger(limit) || limit < 0) errors.push('حد الاستخدام غير صحيح');
  }

  if (forActivation) {
    if (payload.kind !== 'free_shipping' && payload.kind !== 'gift') {
      const hasScope = scope.all === true
        || (Array.isArray(scope.products) && scope.products.length > 0)
        || (Array.isArray(scope.categories) && scope.categories.length > 0);
      if (!hasScope) errors.push('حدد منتجات أو تصنيفات العرض قبل التفعيل');
    }
  }

  return errors;
};

const shapePromotion = (p) => ({
  ...p,
  isLive: isPromotionLive(p),
});

export const createPromotion = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (!KINDS.includes(payload.kind)) throw new createError('نوع العرض غير صحيح', 400);

    const errors = await validatePromotionPayload(payload, { forActivation: payload.status === 'active' });
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'إعدادات العرض غير مكتملة أو غير صحيحة', errors });
    }

    const promotion = await Promotion.create({
      ...payload,
      status: payload.status || 'draft',
      createdBy: req.user._id,
      updatedBy: req.user._id,
      usageCount: 0,
    });

    try {
      await AuditLogService.logAction({
        adminId: req.user._id,
        actionType: 'system_setting_change',
        entityType: 'system',
        entityId: promotion._id,
        newValue: { promotion: promotion.name, kind: promotion.kind, status: promotion.status },
        reason: 'إنشاء عرض ترويجي',
        ipAddress: AuditLogService.getClientIP(req),
        userAgent: AuditLogService.getUserAgent(req),
        metadata: { promotionId: promotion._id },
      });
    } catch (e) { console.error('AUDIT_LOG_ERROR (promotion_create):', e.message); }

    res.status(201).json({ success: true, message: 'تم إنشاء العرض بنجاح', data: shapePromotion(promotion.toObject()) });
  } catch (error) { next(error); }
};

export const getPromotions = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePageParams(req.query, 20);
    const filter = { deletedAt: null };
    if (req.query.kind && KINDS.includes(req.query.kind)) filter.kind = req.query.kind;
    if (req.query.status && STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.search) {
      filter.name = { $regex: String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const [total, promotions] = await Promise.all([
      Promotion.countDocuments(filter),
      Promotion.find(filter)
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip).limit(limit)
        .populate('config.giftProduct', 'title price')
        .populate('scope.products', 'title price')
        .populate('scope.categories', 'name nameEn')
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: promotions.map(shapePromotion),
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) { next(error); }
};

export const getPromotionById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new createError('معرف العرض غير صحيح', 400);
    const promotion = await Promotion.findOne({ _id: req.params.id, deletedAt: null })
      .populate('config.giftProduct', 'title price colors')
      .populate('scope.products', 'title price colors')
      .populate('scope.categories', 'name nameEn')
      .lean();
    if (!promotion) throw new createError('العرض غير موجود', 404);
    res.status(200).json({ success: true, data: shapePromotion(promotion) });
  } catch (error) { next(error); }
};

export const updatePromotion = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new createError('معرف العرض غير صحيح', 400);
    const promotion = await Promotion.findOne({ _id: req.params.id, deletedAt: null });
    if (!promotion) throw new createError('العرض غير موجود', 404);

    const allowed = ['name', 'description', 'kind', 'status', 'startsAt', 'endsAt', 'scope', 'config', 'usageLimit', 'perUserLimit', 'priority'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) promotion[key] = req.body[key];
    });
    promotion.updatedBy = req.user._id;

    const merged = promotion.toObject();
    const errors = await validatePromotionPayload(merged, { forActivation: merged.status === 'active' });
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'إعدادات العرض غير مكتملة أو غير صحيحة', errors });
    }

    await promotion.save();
    res.status(200).json({ success: true, message: 'تم تحديث العرض بنجاح', data: shapePromotion(promotion.toObject()) });
  } catch (error) { next(error); }
};

export const togglePromotionStatus = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new createError('معرف العرض غير صحيح', 400);
    const promotion = await Promotion.findOne({ _id: req.params.id, deletedAt: null });
    if (!promotion) throw new createError('العرض غير موجود', 404);

    const nextStatus = req.body.status || (promotion.status === 'active' ? 'paused' : 'active');
    if (!STATUSES.includes(nextStatus)) throw new createError('حالة العرض غير صحيحة', 400);

    if (nextStatus === 'active') {
      const errors = await validatePromotionPayload({ ...promotion.toObject(), status: 'active' }, { forActivation: true });
      if (errors.length) {
        return res.status(400).json({ success: false, message: 'لا يمكن تفعيل عرض غير مكتمل الشروط', errors });
      }
    }

    promotion.status = nextStatus;
    promotion.updatedBy = req.user._id;
    await promotion.save();
    res.status(200).json({ success: true, message: 'تم تحديث حالة العرض', data: shapePromotion(promotion.toObject()) });
  } catch (error) { next(error); }
};

export const deletePromotion = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new createError('معرف العرض غير صحيح', 400);
    const promotion = await Promotion.findOne({ _id: req.params.id, deletedAt: null });
    if (!promotion) throw new createError('العرض غير موجود', 404);

    // soft delete: historical orders keep referencing the promotion
    promotion.deletedAt = new Date();
    promotion.status = 'paused';
    await promotion.save();
    res.status(200).json({ success: true, message: 'تم حذف العرض' });
  } catch (error) { next(error); }
};

/** Dry-run: shows what a promotion would do to a given basket, without saving. */
export const previewPromotion = async (req, res, next) => {
  try {
    const { promotionId, items = [], deliveryMethod = 'home', address = '', couponDiscount = 0 } = req.body;

    let promotions;
    if (promotionId) {
      if (!isValidObjectId(promotionId)) throw new createError('معرف العرض غير صحيح', 400);
      const promo = await Promotion.findOne({ _id: promotionId, deletedAt: null }).lean();
      if (!promo) throw new createError('العرض غير موجود', 404);
      promotions = [promo];
    } else {
      const { getLivePromotions } = await import('../services/promotion.service.js');
      promotions = await getLivePromotions();
    }

    const ids = items.map((i) => i.productId).filter(isValidObjectId);
    const products = await Product.find({ _id: { $in: ids } }).select('price discountedPrice category').lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const lines = items.map((i, idx) => {
      const p = byId.get(String(i.productId));
      if (!p) throw new createError('أحد المنتجات المختارة غير موجود', 400);
      return {
        lineId: String(idx),
        productId: String(p._id),
        categoryId: p.category ? String(p.category) : null,
        unitPrice: Number(p.discountedPrice ?? p.price),
        quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
      };
    });

    const evaluation = evaluatePromotions({
      promotions, lines, deliveryMethod, address, couponApplied: Number(couponDiscount) > 0,
    });

    const pricing = lines.length
      ? await priceOrder({
        items: lines.map((l) => ({ product: { _id: l.productId, category: l.categoryId, price: l.unitPrice }, quantity: l.quantity })),
        deliveryMethod, address, couponDiscount,
      })
      : null;

    res.status(200).json({ success: true, data: { evaluation, pricing } });
  } catch (error) { next(error); }
};

/** Public: live promotions for the storefront (no admin data exposed). */
export const getActivePromotions = async (req, res, next) => {
  try {
    const now = new Date();
    const promotions = await Promotion.find({
      status: 'active', deletedAt: null, startsAt: { $lte: now }, endsAt: { $gte: now },
    })
      .select('name description kind startsAt endsAt scope config priority usageLimit usageCount')
      .populate('config.giftProduct', 'title price colors')
      .populate('scope.categories', 'name nameEn')
      .sort({ priority: -1, endsAt: 1 })
      .lean();

    res.status(200).json({ success: true, count: promotions.length, data: promotions });
  } catch (error) { next(error); }
};

/** Public: "X EGP left for free shipping" indicator. */
export const getFreeShippingStatus = async (req, res, next) => {
  try {
    const subtotal = Number(req.query.subtotal || 0);
    if (!Number.isFinite(subtotal) || subtotal < 0) throw new createError('قيمة الطلب غير صحيحة', 400);
    const data = await freeShippingProgress({
      subtotal,
      deliveryMethod: req.query.deliveryMethod === 'pickup' ? 'pickup' : 'home',
      address: req.query.address || '',
    });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
};
