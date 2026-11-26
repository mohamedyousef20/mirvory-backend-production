import mongoose from 'mongoose';

// Anonymous behaviour event. No IP, no name/phone/email. `sid` is a random id kept in the browser session only.
const eventSchema = new mongoose.Schema({
  sid: { type: String, required: true, maxlength: 40, index: true },
  type: { type: String, required: true, enum: ['pageview', 'product_view', 'add_to_cart', 'checkout_start', 'purchase', 'search'], index: true },
  path: { type: String, maxlength: 200, default: '' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
  term: { type: String, maxlength: 80, default: '' },
  results: { type: Number, default: null },
  device: { type: String, enum: ['mobile', 'tablet', 'desktop'], default: 'desktop' },
  ref: { type: String, maxlength: 80, default: '' },      // referrer HOST only (e.g. instagram.com)
  utm: { type: String, maxlength: 60, default: '' },       // utm_source only
  isAuth: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
// auto-delete after 180 days
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export default mongoose.model('Event', eventSchema);
