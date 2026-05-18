import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  sizes: [{
    type: String,
    required: true
  }],
  colors: [{
    type: String,
    required: true
  }]
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  appliedCoupon: {
    code: String,
    discountAmount: Number,
    discountedTotal: Number,
    originalTotal: Number,
    appliedAt: Date
  },
  items: [cartItemSchema],
  total: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// ✅ Method لتحديث الإجمالي
cartSchema.methods.updateTotal = function () {
  // حساب الإجمالي الأساسي
  let subtotal = this.items.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);

  // إذا كان هناك كوبون مطبق
  if (this.appliedCoupon && this.appliedCoupon.discountAmount) {
    this.total = Math.max(0, subtotal - this.appliedCoupon.discountAmount);
    this.appliedCoupon.originalTotal = subtotal;
    this.appliedCoupon.discountedTotal = this.total;
  } else {
    this.total = subtotal;
  }

  return this.save();
};

// ✅ Auto-calculate total when items change
cartSchema.pre('save', function (next) {
  // فقط احسب الإجمالي إذا لم يكن هناك كوبون مطبق أو تم تعديل الكوبون
  if (this.isModified('items') && (!this.appliedCoupon || this.isModified('appliedCoupon'))) {
    let subtotal = this.items.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);

    // إذا كان هناك كوبون مطبق
    if (this.appliedCoupon && this.appliedCoupon.discountAmount) {
      this.total = Math.max(0, subtotal - this.appliedCoupon.discountAmount);
      this.appliedCoupon.originalTotal = subtotal;
      this.appliedCoupon.discountedTotal = this.total;
    } else {
      this.total = subtotal;
    }
  }

  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('Cart', cartSchema);