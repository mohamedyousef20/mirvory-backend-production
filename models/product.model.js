import mongoose from 'mongoose';

// v5: every size (and its stock) belongs to exactly one color.
// Stock key = Product + Color(value) + Size.
const colorSizeSchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true, maxlength: 20 },
  quantity: { type: Number, required: true, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'quantity must be an integer' } },
}, { _id: false });

const colorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },   // HEX, unique inside a product
  image: { type: String, required: true },               // this color's own image
  available: { type: Boolean, default: true },
  sizes: {
    type: [colorSizeSchema],
    default: [],
    validate: {
      validator: (sizes) => new Set(sizes.map((s) => String(s.size).trim().toUpperCase())).size === sizes.length,
      message: 'Duplicate size inside the same color',
    },
  },
});

const productSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  // v5: the global `images[]` and `sizes[]` fields were removed. Images and sizes live inside `colors[]`.
  videoUrl: { type: String, default: '', trim: true },
  colors: {
    type: [colorSchema],
    default: [],
    validate: {
      validator: (colors) => new Set(colors.map((c) => String(c.value).trim().toLowerCase())).size === colors.length,
      message: 'Duplicate color value inside the same product',
    },
  },
  price: { type: Number, required: true },
  discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
  discountedPrice: { type: Number, default: function () { return this.price; } },
  status: { type: String, enum: ['available', 'pending', 'deleted'], default: 'available' },
  sellerPercentage: { type: Number, default: 0 },
  rejectionReason: { type: String, default: null },
  // Derived total = sum of all sizes of all available colors. Never trusted from the client.
  quantity: { type: Number, default: 0, min: 0 },
  sold: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: false },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  isFeatured: { type: Boolean, default: false },
  isTrusted: { type: Boolean, default: false },
  // Set by the v5 migration when the per-color/size stock was estimated from the old single number
  needsStockReview: { type: Boolean, default: false },
  brand: { type: String, default: '' },
  tags: [{ type: String }],
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
    distribution: { 1: { type: Number, default: 0 }, 2: { type: Number, default: 0 }, 3: { type: Number, default: 0 }, 4: { type: Number, default: 0 }, 5: { type: Number, default: 0 } }
  }
}, { timestamps: true });

productSchema.pre('save', function (next) {
  if (this.isModified('price') || this.isModified('discountPercentage')) {
    this.discountedPrice = this.price - (this.price * (this.discountPercentage / 100));
  }
  // Keep the denormalized total in sync whenever the colors/sizes are edited
  if (this.isNew || this.isModified('colors')) {
    this.quantity = (this.colors || [])
      .filter((c) => c.available !== false)
      .reduce((sum, c) => sum + (c.sizes || []).reduce((s, x) => s + (x.quantity || 0), 0), 0);
  }
  next();
});

productSchema.virtual('discountAmount').get(function () { return this.price - this.discountedPrice; });
productSchema.virtual('availableColors').get(function () { return this.colors.filter(c => c.available); });

// Compound indexes for common queries
productSchema.index({ seller: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ status: 1, isApproved: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ sold: -1 });
productSchema.index({ 'ratings.average': -1 });

// Text index for full-text search
productSchema.index({
  title: 'text',
  description: 'text',
  brand: 'text',
  tags: 'text'
}, {
  weights: {
    title: 10,
    description: 5,
    brand: 3,
    tags: 2
  },
  name: 'product_text_search'
});

export default mongoose.model('Product', productSchema);