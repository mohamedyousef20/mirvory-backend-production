import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: [
      'manage_users',
      'manage_sellers', 
      'manage_wallets',
      'manage_orders',
      'manage_products',
      'manage_settings',
      'manage_analytics',
      'manage_support',
      'manage_content',
      'manage_system'
    ]
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['user_management', 'financial', 'content', 'system', 'analytics'],
    required: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Permission', permissionSchema);
