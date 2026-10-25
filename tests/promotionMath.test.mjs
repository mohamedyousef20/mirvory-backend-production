// Minimal dependency-free test suite (the backend has no test runner configured).
// Run: node --test tests/   (Node >= 18 built-in test runner)
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePromotions, isPromotionLive, toPiasters, fromPiasters } from '../utils/promotionMath.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const live = (over = {}) => ({
  _id: 'p1', name: 'P', kind: 'limited_time', status: 'active',
  startsAt: new Date('2026-05-01T00:00:00Z'), endsAt: new Date('2026-07-01T00:00:00Z'),
  scope: { all: true }, config: { discountType: 'percentage', discountValue: 10, stackableWithCoupons: true },
  usageCount: 0, usageLimit: null, ...over,
});
const line = (productId, unitPrice, quantity = 1, categoryId = null) => ({ productId, categoryId, unitPrice, quantity });

test('money helpers keep integer piasters', () => {
  assert.equal(toPiasters(1999.99), 199999);
  assert.equal(fromPiasters(199999), 1999.99);
  assert.equal(fromPiasters(toPiasters(0.1) + toPiasters(0.2)), 0.3);
});

test('liveness: draft / paused / expired / future / usage-limit are not live', () => {
  assert.equal(isPromotionLive(live(), NOW), true);
  for (const bad of [
    { status: 'draft' }, { status: 'paused' },
    { startsAt: new Date('2026-08-01'), endsAt: new Date('2026-09-01') },
    { startsAt: new Date('2026-01-01'), endsAt: new Date('2026-02-01') },
    { usageCount: 5, usageLimit: 5 },
  ]) assert.equal(isPromotionLive(live(bad), NOW), false);
});

test('percentage discount is exact and never negative', () => {
  const r = evaluatePromotions({ promotions: [live()], lines: [line('a', 1000)], now: NOW });
  assert.equal(r.totalDiscount, 100);
  assert.equal(r.subtotalAfterPromotions, 900);
});

test('maxDiscountAmount caps a percentage discount', () => {
  const p = live({ config: { discountType: 'percentage', discountValue: 50, maxDiscountAmount: 100 } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 2000)], now: NOW });
  assert.equal(r.totalDiscount, 100);
});

test('fixed discount cannot exceed the basket', () => {
  const p = live({ config: { discountType: 'fixed', discountValue: 500 } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 200)], now: NOW });
  assert.equal(r.totalDiscount, 200);
  assert.equal(r.subtotalAfterPromotions, 0);
});

test('two promotions never discount the same money twice', () => {
  const p1 = live({ _id: 'p1', kind: 'limited_time', config: { discountType: 'percentage', discountValue: 50 } });
  const p2 = live({ _id: 'p2', kind: 'quantity', config: { discountType: 'percentage', discountValue: 50, minQuantity: 1 } });
  const r = evaluatePromotions({ promotions: [p1, p2], lines: [line('a', 100)], now: NOW });
  assert.equal(r.totalDiscount, 100);
});

test('non-stackable promotion is skipped when a coupon is applied', () => {
  const p = live({ config: { discountType: 'percentage', discountValue: 10, stackableWithCoupons: false } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 100)], couponApplied: true, now: NOW });
  assert.equal(r.totalDiscount, 0);
  assert.equal(r.skipped[0].reason, 'non_stackable_with_coupon');
});

test('free shipping: below / at / above the threshold', () => {
  const p = live({ _id: 'fs', kind: 'free_shipping', config: { minOrderAmount: 2000, freeShippingBasis: 'before_discounts' } });
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 1999)], now: NOW }).freeShipping, false);
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 2000)], now: NOW }).freeShipping, true);
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 2600)], now: NOW }).freeShipping, true);
});

test('free shipping respects the covered areas', () => {
  const p = live({ _id: 'fs', kind: 'free_shipping', config: { minOrderAmount: 0, freeShippingAreas: ['القاهرة'] } });
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 100)], address: 'الجيزة', now: NOW }).freeShipping, false);
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 100)], address: 'القاهرة - مدينة نصر', now: NOW }).freeShipping, true);
});

test('free shipping is not applied on pickup', () => {
  const p = live({ _id: 'fs', kind: 'free_shipping', config: { minOrderAmount: 0 } });
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 100)], deliveryMethod: 'pickup', now: NOW }).freeShipping, false);
});

test('quantity offer needs the required quantity', () => {
  const p = live({ _id: 'q', kind: 'quantity', config: { discountType: 'fixed', discountValue: 100, minQuantity: 3 } });
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 100, 2)], now: NOW }).totalDiscount, 0);
  assert.equal(evaluatePromotions({ promotions: [p], lines: [line('a', 100, 3)], now: NOW }).totalDiscount, 100);
});

test('gift is added once and never duplicated', () => {
  const p = live({ _id: 'g', kind: 'gift', config: { giftProduct: 'gift1', giftQuantity: 1, minQuantity: 1 } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 100, 5)], now: NOW });
  assert.equal(r.giftLines.length, 1);
  assert.equal(r.giftLines[0].unitPrice, 0);
  assert.equal(r.giftLines[0].productId, 'gift1');
});

test('bundle charges the bundle price for every complete bundle', () => {
  const p = live({ _id: 'b', kind: 'bundle', config: { minQuantity: 3, bundlePrice: 250 } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 100, 3)], now: NOW });
  assert.equal(r.totalDiscount, 50); // 300 - 250
});

test('scope: only matching products / categories are discounted', () => {
  const p = live({ _id: 's', kind: 'limited_time', scope: { products: [], categories: ['cat1'] }, config: { discountType: 'percentage', discountValue: 10 } });
  const r = evaluatePromotions({ promotions: [p], lines: [line('a', 1000, 1, 'cat2'), line('b', 1000, 1, 'cat1')], now: NOW });
  assert.equal(r.totalDiscount, 100);
});
