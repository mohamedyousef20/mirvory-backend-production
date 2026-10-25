import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// Promotion — one document per admin-configured promotion.
// Additive model: nothing existing is replaced. Coupons stay in their own
// collection and are still handled by the existing coupon controller.
// ─────────────────────────────────────────────────────────────────────────────

const scopeSchema = new mongoose.Schema(
  {
    all: { type: Boolean, default: false },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  },
  { _id: false }
);

const configSchema = new mongoose.Schema(
  {
    // limited_time / quantity
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    discountValue: { type: Number, default: 0, min: 0 },
    maxDiscountAmount: { type: Number, default: null, min: 0 },

    // free_shipping
    minOrderAmount: { type: Number, default: 0, min: 0 },
    freeShippingBasis: {
      type: String,
      enum: ['before_discounts', 'after_discounts'],
      default: 'after_discounts',
    },
    freeShippingAreas: [{ type: String, trim: true }], // empty = all governorates

    // quantity / gift / bundle
    minQuantity: { type: Number, default: 1, min: 1 },
    bundlePrice: { type: Number, default: null, min: 0 },
    giftProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    giftQuantity: { type: Number, default: 1, min: 1 },

    // stacking rules
    stackableWithCoupons: { type: Boolean, default: true },
    stackableWithShipping: { type: Boolean, default: true },
  },
  { _id: false }
);

const promotionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 1000 },
    kind: {
      type: String,
      required: true,
      enum: ['free_shipping', 'limited_time', 'quantity', 'gift', 'bundle'],
    },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'scheduled', 'active', 'paused', 'expired'],
      default: 'draft',
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    scope: { type: scopeSchema, default: () => ({}) },
    config: { type: configSchema, default: () => ({}) },

    usageLimit: { type: Number, default: null, min: 0 }, // total redemptions allowed
    usageCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: null, min: 0 },

    priority: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

promotionSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
promotionSchema.index({ kind: 1, status: 1 });
promotionSchema.index({ 'scope.products': 1 });
promotionSchema.index({ 'scope.categories': 1 });

promotionSchema.pre('validate', function (next) {
  if (this.startsAt && this.endsAt && new Date(this.startsAt) >= new Date(this.endsAt)) {
    return next(new Error('تاريخ بداية العرض يجب أن يكون قبل تاريخ نهايته'));
  }
  if (this.kind === 'bundle' && (this.config?.bundlePrice === null || this.config?.bundlePrice === undefined)) {
    return next(new Error('عرض الباقة يحتاج سعر باقة محدد'));
  }
  if (this.kind === 'gift' && !this.config?.giftProduct) {
    return next(new Error('عرض الهدية يحتاج منتج هدية محدد'));
  }
  next();
});

/** Live means: active + inside the window + inside the usage limit. */
promotionSchema.methods.isLive = function (now = new Date()) {
  if (this.deletedAt) return false;
  if (this.status !== 'active') return false;
  const t = new Date(now).getTime();
  if (new Date(this.startsAt).getTime() > t) return false;
  if (new Date(this.endsAt).getTime() < t) return false;
  if (this.usageLimit !== null && this.usageLimit !== undefined && this.usageCount >= this.usageLimit) {
    return false;
  }
  return true;
};

promotionSchema.methods.matchesProduct = function (product) {
  if (!product) return false;
  const scope = this.scope || {};
  const hasProducts = Array.isArray(scope.products) && scope.products.length > 0;
  const hasCategories = Array.isArray(scope.categories) && scope.categories.length > 0;
  if (scope.all || (!hasProducts && !hasCategories)) return true;

  const pid = String(product._id || product);
  if (hasProducts && scope.products.some((p) => String(p._id || p) === pid)) return true;

  if (hasCategories) {
    const catId = String(product.category?._id || product.category || '');
    if (catId && scope.categories.some((c) => String(c._id || c) === catId)) return true;
  }
  return false;
};

export default mongoose.model('Promotion', promotionSchema);
