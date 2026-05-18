import mongoose from 'mongoose';

const secretCodeSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  code: { type: String, required: true },
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
});

secretCodeSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('SecretCode', secretCodeSchema);
