import mongoose from 'mongoose';

// Extended user profile for admin-specific information
const adminProfileSchema = new mongoose.Schema({
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Permission'
  }],
  department: {
    type: String,
    enum: ['management', 'support', 'finance', 'technical', 'content'],
    default: 'management'
  },
  accessLevel: {
    type: String,
    enum: ['full', 'limited', 'readonly'],
    default: 'limited'
  },
  lastLoginIP: String,
  sessionTimeout: {
    type: Number,
    default: 3600000 // 1 hour in milliseconds
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  backupCodes: [String]
});

// Financial control extensions for wallet
const financialControlSchema = new mongoose.Schema({
  isFrozen: {
    type: Boolean,
    default: false
  },
  freezeReason: String,
  frozenBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  frozenAt: Date,
  adjustmentHistory: [{
    amount: Number,
    type: {
      type: String,
      enum: ['credit', 'debit']
    },
    reason: String,
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    previousBalance: Number,
    newBalance: Number,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  withdrawalLimits: {
    daily: { type: Number, default: 10000 },
    monthly: { type: Number, default: 100000 }
  },
  requiresApproval: {
    type: Boolean,
    default: false
  }
});

// Schema to extend existing User model without breaking it
const userExtensionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Extended role system (backward compatible)
  extendedRole: {
    type: String,
    enum: ['super_admin', 'admin', 'seller', 'user'],
    default: function() {
      // Default to user role if not specified
      return 'user';
    }
  },
  // Admin-specific profile
  adminProfile: adminProfileSchema,
  // Financial control extensions
  financialControl: financialControlSchema,
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for performance
userExtensionSchema.index({ userId: 1 });
userExtensionSchema.index({ extendedRole: 1 });
userExtensionSchema.index({ 'adminProfile.permissions': 1 });

// Static method to get user with extensions
userExtensionSchema.statics.getUserWithExtensions = function(userId) {
  return this.findOne({ userId })
    .populate('adminProfile.permissions')
    .populate('financialControl.adjustmentHistory.adjustedBy');
};

// Virtual to check if user has specific permission
userExtensionSchema.virtual('hasPermission').get(function() {
  return (permissionName) => {
    if (!this.adminProfile || !this.adminProfile.permissions) {
      return false;
    }
    return this.adminProfile.permissions.some(
      permission => permission.name === permissionName
    );
  };
});

export default mongoose.model('UserExtension', userExtensionSchema);
