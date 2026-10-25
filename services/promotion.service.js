// services/promotion.service.js
// Server-side pricing for promotions. The storefront only *displays* what this
// service returns — the amount charged is always recalculated here.
import Promotion from '../models/promotion.model.js';
import ShippingSettings from '../models/shippingSettings.model.js';
import { evaluatePromotions, toPiasters, fromPiasters } from '../utils/promotionMath.js';

/** Promotions that are active AND inside their date window. */
export const getLivePromotions = async (now = new Date()) =>
  Promotion.find({
    status: 'active',
    deletedAt: null,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  }).lean();

/** Converts cart/order source items into the plain lines the math engine needs. */
export const toPricingLines = (items = []) =>
  items
    .filter((i) => i && i.product)
    .map((i, idx) => ({
      lineId: String(i.lineId || i._id || i.product._id || idx),
      productId: String(i.product._id || i.product),
      categoryId: i.product.category ? String(i.product.category._id || i.product.category) : null,
      unitPrice: Number(i.product.discountedPrice ?? i.product.price ?? i.unitPrice ?? 0),
      quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
    }));

/**
 * Shipping = existing ShippingSettings rules, plus a free-shipping promotion
 * when one is live. Never trusted from the client.
 */
export const computeShippingFee = (settings, { subtotal, deliveryMethod, address, freeShippingFromPromotion }) => {
  if (!settings
    && !settings === undefined) return 0;
  const fee = Number(settings?.shippingFee ?? 0);
  if (deliveryMethod === 'pickup' && settings?.freePickupShipping) return 0;
  if (settings?.freeShippingEnabled && Number(subtotal) >= Number(settings?.freeShippingMinimum || 0)) return 0;
  if (settings?.freeMetroShipping && address) {
    const isMetro = (settings?.metroAreas || []).some((area) =>
      area && String(address).toLowerCase().includes(String(area).toLowerCase()));
    if (isMetro) return 0;
  }
  if (freeShippingFromPromotion) return 0;
  return fee;
};

/**
 * Full server-side price breakdown for an order.
 * @returns {Promise<Object>} subtotal, promotionDiscount, couponDiscount,
 *          shippingFee, total, applied, skipped, giftLines, freeShipping
 */
export const priceOrder = async ({
  items = [],
  deliveryMethod = 'home',
  address = '',
  couponDiscount = 0,
  couponCode = null,
  now = new Date(),
} = {}) => {
  const lines = toPricingLines(items);
  const subtotal = fromPiasters(lines.reduce((s, l) => s + toPiasters(l.unitPrice) * l.quantity, 0));

  const promotions = await getLivePromotions(now);
  const evaluation = evaluatePromotions({
    promotions,
    lines,
    deliveryMethod,
    address,
    couponApplied: Number(couponDiscount) > 0,
  });

  // Promotion discount first, then the coupon — capped so the paid amount can
  // never go below zero and nothing is ever discounted twice.
  const promotionDiscount = fromPiasters(Math.min(toPiasters(evaluation.totalDiscount), toPiasters(subtotal)));
  const maxCoupon = Math.max(0, subtotal - promotionDiscount);
  const safeCoupon = Math.min(Math.max(0, Number(couponDiscount) || 0), maxCoupon);

  const settings = await ShippingSettings.getSettings();
  const shippingFee = computeShippingFee(settings, {
    subtotal: subtotal - promotionDiscount - safeCoupon,
    deliveryMethod,
    address,
    freeShippingFromPromotion: evaluation.freeShipping,
  });

  const total = fromPiasters(Math.max(
    0,
    toPiasters(subtotal) - toPiasters(promotionDiscount) - toPiasters(safeCoupon) + toPiasters(shippingFee),
  ));

  return {
    subtotal,
    promotionDiscount,
    couponDiscount: fromPiasters(toPiasters(safeCoupon)),
    couponCode: safeCoupon > 0 ? couponCode : null,
    shippingFee,
    total,
    baseShippingFee: settings?.shippingFee ?? 0,
    freeShipping: shippingFee === 0,
    freeShippingFromPromotion: evaluation.freeShipping,
    applied: evaluation.applied,
    skipped: evaluation.skipped,
    giftLines: evaluation.giftLines,
    discounts: evaluation.discounts,
  };
};

/** Amount still missing for the best live free-shipping promotion. */
export const freeShippingProgress = async ({ subtotal = 0, deliveryMethod = 'home', address = '' }) => {
  const promotions = (await getLivePromotions()).filter((p) => p.kind === 'free_shipping');
  const settings = await ShippingSettings.getSettings();

  if (promotions.length === 0) {
    if (!settings?.freeShippingEnabled) return null;
    const remaining = Math.max(0, Number(settings.freeShippingMinimum || 0) - Number(subtotal || 0));
    return {
      enabled: true,
      source: 'settings',
      threshold: Number(settings.freeShippingMinimum || 0),
      remaining,
      qualified: remaining === 0,
      description: 'شحن مجاني للطلبات التي تبلغ الحد الأدنى',
    };
  }

  const best = promotions
    .map((p) => ({ promo: p, threshold: Number(p.config?.minOrderAmount || 0) }))
    .sort((a, b) => a.threshold - b.threshold)[0];

  const remaining = Math.max(0, best.threshold - Number(subtotal || 0));
  return {
    enabled: true,
    source: 'promotion',
    promotionId: String(best.promo._id),
    name: best.promo.name,
    description: best.promo.description,
    endsAt: best.promo.endsAt,
    threshold: best.threshold,
    remaining,
    qualified: remaining === 0,
    deliveryMethod,
  };
};

export default { getLivePromotions, priceOrder, computeShippingFee, freeShippingProgress, toPricingLines };
