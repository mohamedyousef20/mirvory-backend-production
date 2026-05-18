import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({

  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: { type: String, required: true },

  description: { type: String, required: true },

  images: [{ type: String }],

  sizes: [{ type: String }],

  colors: [{
    name: { type: String, required: true },
    value: { type: String, required: true }, // hex code or color value
    available: { type: Boolean, default: true }
  }],

  price: { type: Number, required: true },

  // New discount fields
  discountPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  discountedPrice: {
    type: Number,
    default: function () {
      return this.price;
    }
  },

  status: {
    type: String,
    enum: ['available', 'pending'],
    default: 'available'
  },
  sellerPercentage: { type: Number, default: 0 },
  rejectionReason: { type: String, default: null },

  quantity: {
    type: Number,
    default: 0,
    min: 0,
  },
  sold: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: false },

  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },

  ratings: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Middleware to calculate discounted price before saving
productSchema.pre('save', function (next) {
  // Calculate discount only if price or discount percentage changes
  if (this.isModified('price') || this.isModified('discountPercentage')) {
    const discountAmount = this.price * (this.discountPercentage / 100);
    this.discountedPrice = this.price - discountAmount;
  }
  next();
});

// Middleware to populate category for find queries
productSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'category',
    select: 'name nameEn _id'
  });
  next();
});

// For aggregate queries
productSchema.pre('aggregate', function (next) {
  // Add $lookup to populate category in aggregate queries
  this.pipeline().unshift({
    $lookup: {
      from: 'categories',
      localField: 'category',
      foreignField: '_id',
      as: 'category'
    }
  }, {
    $unwind: {
      path: '$category',
      preserveNullAndEmptyArrays: true
    }
  });
  next();
});

// Virtual for discount amount (not stored in DB)
productSchema.virtual('discountAmount').get(function () {
  return this.price - this.discountedPrice;
});

// Virtual for available colors
productSchema.virtual('availableColors').get(function () {
  return this.colors.filter(color => color.available);
});

// Update rating method
productSchema.methods.updateRating = function (newRating) {
  this.ratings.count += 1;
  this.ratings.distribution[newRating] += 1;

  let total = 0;
  for (let i = 1; i <= 5; i++) {
    total += i * this.ratings.distribution[i];
  }

  this.ratings.average = total / this.ratings.count;
  return this.save();
};

// Method to add a color
productSchema.methods.addColor = function (name, value, available = true) {
  this.colors.push({ name, value, available });
  return this.save();
};

// Method to update color availability
productSchema.methods.updateColorAvailability = function (colorValue, available) {
  const color = this.colors.find(c => c.value === colorValue);
  if (color) {
    color.available = available;
    return this.save();
  }
  throw new Error('Color not found');
};

// Method to remove a color
productSchema.methods.removeColor = function (colorValue) {
  this.colors = this.colors.filter(c => c.value !== colorValue);
  return this.save();
};

// Update the updatedAt field before saving
productSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Index for better performance
productSchema.index({ seller: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ 'colors.value': 1 }); // Index for color searching

export default mongoose.model('Product', productSchema);