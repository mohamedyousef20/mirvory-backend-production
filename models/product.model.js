import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  images: [{ type: String }], sizes: [{ type: String }],
  colors: [{ name: { type: String, required: true }, value: { type: String, required: true }, available: { type: Boolean, default: true } }],
  price: { type: Number, required: true },
  discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
  discountedPrice: { type: Number, default: function () { return this.price; } },
  status: { type: String, enum: ['available', 'pending', 'deleted'], default: 'available' },
  sellerPercentage: { type: Number, default: 0 },
  rejectionReason: { type: String, default: null },
  quantity: { type: Number, default: 0, min: 0 },
  sold: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: false },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  isFeatured: { type: Boolean, default: false },
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
  next();
});

productSchema.virtual('discountAmount').get(function () { return this.price - this.discountedPrice; });
productSchema.virtual('availableColors').get(function () { return this.colors.filter(c => c.available); });

productSchema.index({ seller: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ isFeatured: 1, status: 1 });

export default mongoose.model('Product', productSchema);