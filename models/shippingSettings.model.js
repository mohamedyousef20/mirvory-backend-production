import mongoose from 'mongoose';

const shippingSettingsSchema = new mongoose.Schema({
  freeShippingEnabled: {
    type: Boolean,
    default: true
  },
  freeShippingMinimum: {
    type: Number,
    default: 1500,
    min: 0
  },
  shippingFee: {
    type: Number,
    default: 70,
    min: 0
  },
  freePickupShipping: {
    type: Boolean,
    default: true
  },
  freeMetroShipping: {
    type: Boolean,
    default: true
  },
  metroAreas: [{
    type: String
  }]
}, { timestamps: true });

// Ensure only one document exists
shippingSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

export default mongoose.model('ShippingSettings', shippingSettingsSchema);