// utils/promotionMath.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure pricing math for promotions. No mongoose, no DB, no Express.
// All money is converted to INTEGER piasters (1 EGP = 100 piasters) so that
// repeated percentage/fixed calculations never accumulate float error.
// The server is the only source of truth for the final amount a customer pays.
// ─────────────────────────────────────────────────────────────────────────────

export const toPiasters = (value) => Math.round((Number(value) || 0) * 100);
export const fromPiasters = (piasters) => Math.round(Number(piasters) || 0) / 100;
const clampNonNeg = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

const ids = (list) => (Array.isArray(list) ? list.map((x) => String(x?._id ?? x)) : []);

/** Is the promotion inside its window / usage limit / status? */
export const isPromotionLive = (promo, now = new Date()) => {
  if (!promo) return false;
  if (promo.deletedAt) return false;
  if (promo.status !== 'active') return false;
  const t = new Date(now).getTime();
  if (!promo.startsAt || !promo.endsAt) return false;
  if (new Date(promo.startsAt).getTime() > t) return false;
  if (new Date(promo.endsAt).getTime() < t) return false;
  if (promo.usageLimit !== null && promo.usageLimit !== undefined) {
    if ((promo.usageCount || 0) >= promo.usageLimit) return false;
  }
  return true;
};

/** Does a cart line fall inside the promotion scope (products / categories / all)? */
export const lineMatchesScope = (line, scope = {}) => {
  const products = ids(scope.products);
  const categories = ids(scope.categories);
  if (scope.all || (products.length === 0 && categories.length === 0)) return true;
  if (products.includes(String(line.productId))) return true;
  if (line.categoryId && categories.includes(String(line.categoryId))) return true;
  return false;
};

// limited_time wins over quantity, quantity over bundle, so each EGP of the
// order can only be discounted by one promotion of the same tier.
const KIND_WEIGHT = { limited_time: 30, quantity: 20, bundle: 10, gift: 5, free_shipping: 0 };

const withinArea = (areas, address) => {
  const list = (areas || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true; // no restriction = every governorate
  const hay = String(address || '').toLowerCase();
  if (!hay) return false;
  return list.some((a) => hay.includes(a));
};

/**
 * Evaluates every live promotion against the cart.
 *
 * @param {Object}   input
 * @param {Array}    input.promotions     live promotion docs (plain objects)
 * @param {Array}    input.lines          [{ lineId, productId, categoryId, unitPrice, quantity }]
 * @param {String}   input.deliveryMethod 'home' | 'pickup'
 * @param {String}   input.address        delivery address (for governorate rules)
 * @param {Boolean}  input.couponApplied  a coupon is already discounting this order
 * @returns {Object} { totalDiscount, discounts[], giftLines[], freeShipping, applied[], skipped[] }
 *                   every amount is in EGP (2 decimals)
 */
export const evaluatePromotions = ({
  promotions = [],
  lines = [],
  deliveryMethod = 'home',
  address = '',
  couponApplied = false,
  now = new Date(),
} = {}) => {
  const safeLines = (lines || []).map((l) => ({
    lineId: String(l.lineId ?? l.productId ?? ''),
    productId: String(l.productId ?? ''),
    categoryId: l.categoryId ? String(l.categoryId) : null,
    unitPrice: clampNonNeg(Number(l.unitPrice) || 0),
    quantity: Math.max(1, parseInt(l.quantity, 10) || 1),
  }));

  const orderSubtotal = safeLines.reduce((s, l) => s + toPiasters(l.unitPrice) * l.quantity, 0);

  const discounts = [];
  const giftLines = [];
  const applied = [];
  const skipped = [];
  let freeShipping = false;
  let consumed = 0; // piasters already discounted (prevents over-discounting)

  const ordered = [...(promotions || [])]
    .filter((p) => isPromotionLive(p, now))
    .sort((a, b) => {
      const byPriority = (b.priority || 0) - (a.priority || 0);
      if (byPriority !== 0) return byPriority;
      return (KIND_WEIGHT[b.kind] || 0) - (KIND_WEIGHT[a.kind] || 0);
    });

  for (const promo of ordered) {
    const cfg = promo.config || {};

    // A non-stackable promotion is ignored when a coupon is already applied.
    if (couponApplied && cfg.stackableWithCoupons === false) {
      skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'non_stackable_with_coupon' });
      continue;
    }

    const scoped = safeLines.filter((line) => lineMatchesScope(line, promo.scope));
    const scopedSubtotal = scoped.reduce((s, l) => s + toPiasters(l.unitPrice) * l.quantity, 0);
    const scopedQty = scoped.reduce((s, l) => s + l.quantity, 0);

    switch (promo.kind) {
      case 'free_shipping': {
        if (deliveryMethod === 'pickup') {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'pickup_already_free' });
          break;
        }
        const basis =
          cfg.freeShippingBasis === 'before_discounts'
            ? orderSubtotal
            : Math.max(0, orderSubtotal - consumed);
        const minAmount = toPiasters(cfg.minOrderAmount || 0);
        if (basis < minAmount) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'below_min_order_amount' });
          break;
        }
        if (!withinArea(cfg.freeShippingAreas, address)) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'area_not_covered' });
          break;
        }
        if (!freeShipping) {
          freeShipping = true;
          applied.push({ promotionId: String(promo._id), name: promo.name, kind: promo.kind });
        }
        break;
      }

      case 'limited_time':
      case 'quantity': {
        if (scoped.length === 0 || scopedSubtotal <= 0) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'no_matching_items' });
          break;
        }
        const minQty = Math.max(1, parseInt(cfg.minQuantity, 10) || 1);
        if (promo.kind === 'quantity' && scopedQty < minQty) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'min_quantity_not_reached' });
          break;
        }

        let amount =
          cfg.discountType === 'fixed'
            ? Math.min(toPiasters(cfg.discountValue || 0), scopedSubtotal)
            : Math.floor((scopedSubtotal * clampNonNeg(cfg.discountValue || 0)) / 100);

        if (cfg.maxDiscountAmount !== null && cfg.maxDiscountAmount !== undefined) {
          amount = Math.min(amount, toPiasters(cfg.maxDiscountAmount));
        }
        // never discount money that was already discounted by another promotion
        const available = Math.max(0, scopedSubtotal - consumed);
        amount = Math.min(amount, available);
        if (amount <= 0) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'nothing_left_to_discount' });
          break;
        }
        consumed += amount;
        discounts.push({
          promotionId: String(promo._id),
          name: promo.name,
          kind: promo.kind,
          amount: fromPiasters(amount),
        });
        applied.push({ promotionId: String(promo._id), name: promo.name, kind: promo.kind });
        break;
      }

      case 'bundle': {
        if (scoped.length === 0) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'no_matching_items' });
          break;
        }
        const minQty = Math.max(1, parseInt(cfg.minQuantity, 10) || 1);
        if (scopedQty < minQty) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'min_quantity_not_reached' });
          break;
        }
        const bundlePrice = toPiasters(cfg.bundlePrice || 0);
        if (bundlePrice <= 0) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'invalid_bundle_price' });
          break;
        }
        // Charge the cheapest bundle: bundlePrice for every `minQty` matching units.
        const bundles = Math.floor(scopedQty / minQty);
        const avgUnit = Math.round(scopedSubtotal / Math.max(1, scopedQty));
        const expected = Math.round(avgUnit * minQty * bundles);
        let amount = Math.max(0, expected - bundlePrice * bundles);
        amount = Math.min(amount, Math.max(0, scopedSubtotal - consumed));
        if (amount <= 0) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'bundle_not_cheaper' });
          break;
        }
        consumed += amount;
        discounts.push({
          promotionId: String(promo._id),
          name: promo.name,
          kind: promo.kind,
          amount: fromPiasters(amount),
        });
        applied.push({ promotionId: String(promo._id), name: promo.name, kind: promo.kind });
        break;
      }

      case 'gift': {
        const giftId = cfg.giftProduct ? String(cfg.giftProduct?._id ?? cfg.giftProduct) : null;
        if (!giftId) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'missing_gift_product' });
          break;
        }
        const minQty = Math.max(1, parseInt(cfg.minQuantity, 10) || 1);
        if (scoped.length === 0 || scopedQty < minQty) {
          skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'min_quantity_not_reached' });
          break;
        }
        // one gift line per promotion — never duplicated by repeated requests
        if (giftLines.some((g) => g.promotionId === String(promo._id))) break;
        giftLines.push({
          promotionId: String(promo._id),
          name: promo.name,
          productId: giftId,
          quantity: Math.max(1, parseInt(cfg.giftQuantity, 10) || 1),
          unitPrice: 0,
        });
        applied.push({ promotionId: String(promo._id), name: promo.name, kind: promo.kind });
        break;
      }

      default:
        skipped.push({ promotionId: String(promo._id), name: promo.name, reason: 'unsupported_kind' });
    }
  }

  const totalDiscount = Math.min(orderSubtotal, consumed);
  const subtotal = fromPiasters(orderSubtotal);

  return {
    subtotal,
    totalDiscount: fromPiasters(totalDiscount),
    subtotalAfterPromotions: fromPiasters(Math.max(0, orderSubtotal - totalDiscount)),
    discounts,
    giftLines,
    freeShipping,
    applied,
    skipped,
  };
};
