import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRedemption, maxRedeemablePoints, pointsForAmount, POINT_VALUE_PIASTERS } from '../utils/loyaltyMath.js';

test('earn: 1 point per 5 EGP, floored', () => {
  assert.equal(pointsForAmount(0), 0);
  assert.equal(pointsForAmount(4.99), 0);
  assert.equal(pointsForAmount(5), 1);
  assert.equal(pointsForAmount(1199), 239);
  assert.equal(pointsForAmount(NaN), 0);
});
test('value: 100 points = 5 EGP', () => {
  assert.equal(100 * POINT_VALUE_PIASTERS, 500);
  assert.equal(computeRedemption({ requestedPoints: 200, balance: 500, basePiasters: 400000 }).discountPiasters, 1000);
});
test('cap is 10% of merchandise value', () => {
  // 1200 EGP -> 120 EGP max -> 2400 points
  assert.equal(maxRedeemablePoints(120000), 2400);
  assert.equal(computeRedemption({ requestedPoints: 2400, balance: 5000, basePiasters: 120000 }).points, 2400);
  assert.throws(() => computeRedemption({ requestedPoints: 2401, balance: 5000, basePiasters: 120000 }), /الحد الأقصى/);
});
test('minimum 200, balance and integer checks', () => {
  const base = 500000;
  assert.throws(() => computeRedemption({ requestedPoints: 199, balance: 1000, basePiasters: base }), /الحد الأدنى/);
  assert.throws(() => computeRedemption({ requestedPoints: 300, balance: 250, basePiasters: base }), /غير كافٍ/);
  assert.throws(() => computeRedemption({ requestedPoints: 250.5, balance: 1000, basePiasters: base }), /غير صالح/);
  assert.throws(() => computeRedemption({ requestedPoints: -5, balance: 1000, basePiasters: base }));
});
test('small order: cap below minimum means no redemption possible', () => {
  // 100 EGP order -> 10 EGP cap -> 200 points exactly
  assert.equal(computeRedemption({ requestedPoints: 200, balance: 200, basePiasters: 10000 }).points, 200);
  assert.throws(() => computeRedemption({ requestedPoints: 200, balance: 200, basePiasters: 9999 }), /الحد الأقصى/);
});

test('earn base excludes shipping: 1000 EGP product + 550 shipping/margin -> points on product only', () => {
  const total = 1550, shipping = 550;
  assert.equal(pointsForAmount(total - shipping), 200);
});
