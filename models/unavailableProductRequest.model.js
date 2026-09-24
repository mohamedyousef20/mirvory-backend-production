import mongoose from 'mongoose';

const unavailableProductRequestSchema = new mongoose.Schema({
  // Customer reference (optional - for authenticated users)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Guest information (for non-authenticated users)
  guestName: {
    type: String,
    default: null
  },
  guestEmail: {
    type: String,
    default: null
  },

  // Requested product: kept as a loose reference plus a snapshot of the name so
  // the request survives the product being deleted.
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  productName: {
    type: String,
    default: null,
    trim: true
  },

  // Phone number (required for both authenticated and guest)
  phone: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^01[0125][0-9]{8}$/.test(v);
      },
      message: 'Phone number must be a valid Egyptian number'
    }
  },

  // Request details
  size: {
    type: String,
    default: null,
    trim: true
  },

  color: {
    type: String,
    default: null,
    trim: true
  },

  quantity: {
    type: Number,
    default: 1,
    min: 1
  },

  notes: {
    type: String,
    default: null,
    trim: true
  },

  // Product image (optional — a request may instead reference a product)
  image: {
    type: String,
    default: null
  },

  // Cloudinary public_id for image deletion
  imagePublicId: {
    type: String,
    default: null
  },

  // Request status
  status: {
    type: String,
    enum: ['pending', 'contacted', 'sourcing', 'available', 'completed', 'rejected'],
    default: 'pending'
  },

  // Admin notes
  adminNotes: {
    type: String,
    default: null
  },

  // Created by admin (if admin created on behalf of customer)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better query performance
unavailableProductRequestSchema.index({ user: 1, createdAt: -1 });
unavailableProductRequestSchema.index({ status: 1, createdAt: -1 });
unavailableProductRequestSchema.index({ phone: 1 });
unavailableProductRequestSchema.index({ productName: 1 });
unavailableProductRequestSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model('UnavailableProductRequest', unavailableProductRequestSchema);
