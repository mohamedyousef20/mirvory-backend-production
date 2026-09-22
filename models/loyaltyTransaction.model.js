import mongoose from 'mongoose';

const loyaltyTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Transaction type
  type: {
    type: String,
    enum: ['earned', 'redeemed', 'adjusted'],
    required: true
  },

  // Points amount (positive for earned, negative for redeemed)
  points: {
    type: Number,
    required: true
  },

  // Source of the transaction
  source: {
    type: String,
    enum: ['order_completion', 'referral', 'bonus', 'manual_adjustment', 'redemption'],
    required: true
  },

  // Reference to related entity (e.g., order ID)
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  // Reference model name (e.g., 'Order')
  referenceModel: {
    type: String,
    default: null
  },

  // Description of the transaction
  description: {
    type: String,
    required: true
  },

  // Balance after this transaction
  balanceAfter: {
    type: Number,
    required: true
  },

  // Tier before and after (if changed)
  tierBefore: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: null
  },

  tierAfter: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: null
  },

  // Admin who made manual adjustments
  adjustedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Adjustment notes (for manual adjustments)
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for better query performance
loyaltyTransactionSchema.index({ user: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ type: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ source: 1, createdAt: -1 });

export default mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);
