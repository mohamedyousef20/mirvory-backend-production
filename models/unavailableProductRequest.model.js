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
    required: true,
    trim: true
  },

  // Product image
  image: {
    type: String,
    required: true
  },

  // Cloudinary public_id for image deletion
  imagePublicId: {
    type: String,
    required: true
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

export default mongoose.model('UnavailableProductRequest', unavailableProductRequestSchema);
