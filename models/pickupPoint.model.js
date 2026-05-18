import mongoose from 'mongoose';

const pickupPointSchema = new mongoose.Schema({
  stationName: { type: String, required: true },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  address: { type: String, required: true },
  phone: { type: String },
  workingHours: { type: String },
  status: {
    type: String,
    default: 'active'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

pickupPointSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('PickupPoint', pickupPointSchema);
