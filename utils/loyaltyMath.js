// Loyalty points rules (single source of truth, all math in integer piasters).
// Earn is counted on the product amount actually paid: order total minus shipping (after all discounts, incl. points).
//   100 points = 5 EGP   -> 1 point = 5 piasters
//   earn 1 point per 5 EGP paid (floor)
//   redeem: minimum 200 points, at most 10% of the order's merchandise value
//           (subtotal after promotions and coupon, before shipping)
export const POINT_VALUE_PIASTERS = 5;
export const EGP_PER_EARNED_POINT = 5;
export const MIN_REDEEM_POINTS = 200;
export const MAX_REDEEM_PERCENT = 10;

export const loyaltyRules = () => ({
  pointValueEgp: POINT_VALUE_PIASTERS / 100,
  pointsPerHundredEgpValue: 100,
  egpPerEarnedPoint: EGP_PER_EARNED_POINT,
  minRedeemPoints: MIN_REDEEM_POINTS,
  maxRedeemPercent: MAX_REDEEM_PERCENT,
});

/** Points earned for an amount paid, in EGP (floor). */
export const pointsForAmount = (amountEgp) => {
  const n = Math.floor(Number(amountEgp) / EGP_PER_EARNED_POINT);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Highest number of points that may be redeemed on a base amount (piasters). */
export const maxRedeemablePoints = (basePiasters, balance = Infinity) => {
  const byCap = Math.floor((Math.max(0, basePiasters) * MAX_REDEEM_PERCENT) / 100 / POINT_VALUE_PIASTERS);
  return Math.max(0, Math.min(byCap, Math.floor(balance)));
};

/**
 * Validate a redemption request. Returns { points, discountPiasters }.
 * Throws an Error with .status = 400 and an Arabic message when invalid.
 */
export const computeRedemption = ({ requestedPoints, balance, basePiasters }) => {
  const points = Number(requestedPoints);
  const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!Number.isInteger(points) || points <= 0) fail('عدد النقاط غير صالح');
  if (points < MIN_REDEEM_POINTS) fail(`الحد الأدنى للاستبدال ${MIN_REDEEM_POINTS} نقطة`);
  if (points > Math.floor(balance || 0)) fail('رصيد النقاط غير كافٍ');
  const cap = maxRedeemablePoints(basePiasters);
  if (points > cap) fail(`الحد الأقصى للاستبدال في هذا الطلب ${cap} نقطة (${MAX_REDEEM_PERCENT}% من قيمة الطلب)`);
  return { points, discountPiasters: points * POINT_VALUE_PIASTERS };
};
