import mongoose from 'mongoose';

const returnRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    item: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },

    reason: {
      type: String,
      required: true,
      trim: true
    },

    images: {
      type: [String],
      default: []
    },

    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'rejected',
        'processing',
        'processed'
      ],
      default: 'pending',
      index: true
    },

    rejectionReason: String,

    // 'return' = refund request, 'exchange' = swap size/color
    type: {
      type: String,
      enum: ['return', 'exchange'],
      default: 'return'
    },

    exchangeSize: { type: String, trim: true, default: null },
    exchangeColor: { type: String, trim: true, default: null },

    refundMethod: {
      type: String,
      enum: ['instapay', 'e_wallet', 'cash', null],
      default: null
    },
    refundAccount: { type: String, trim: true, default: null },

    pickupAddress: { type: String, trim: true, default: null },
    preferredSlot: {
      type: String,
      enum: ['morning', 'evening', null],
      default: null
    },
    notes: { type: String, trim: true, default: '' },

    refundAmount: {
      type: Number,
      default: 0
    },

    refundStatus: {
      type: String,
      enum: ['pending', 'approved', 'refunded', 'rejected'],
      default: 'pending'
    },

    deleteAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// TTL auto delete
// returnRequestSchema.index(
//   { deleteAt: 1 },
//   { expireAfterSeconds: 0 }
// );

export default mongoose.model('ReturnRequest', returnRequestSchema);