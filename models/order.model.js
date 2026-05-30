import mongoose from "mongoose";
import crypto from "crypto";

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    quantity: Number, price: Number, color: String, size: String,
    isPrepared: { type: Boolean, default: false },
  }],
  deliveryInfo: {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, match: /^01[0125][0-9]{8}$/ },
    address: { type: String, required: function () { return this.deliveryMethod === "home"; } },
    pickupPoint: { type: mongoose.Schema.Types.ObjectId, ref: "PickupPoint", required: function () { return this.deliveryMethod === "pickup"; } }
  },
  paymentMethod: { type: String, enum: ["cash", "card"], default: "cash" },
  paymentStatus: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
  payoutDate: Date, paymentData: mongoose.Schema.Types.Mixed,
  subtotal: Number, discount: Number, shippingFee: Number, total: Number,
  coupon: { code: String, discountAmount: Number, originalTotal: Number, discountedTotal: Number },
  deliveryMethod: { type: String, enum: ["home", "pickup"], default: "home" },
  deliveryStatus: { type: String, enum: ["pending", "shipped", "delivered", "cancelled"], default: "pending" },
  deliveredAt: Date, payoutProcessed: { type: Boolean, default: false },
  isPrepared: { type: Boolean, default: false },
  secretCode: { type: String, unique: true, required: true },
}, { timestamps: true });

// 🚀 Fast Order Number Generation (No Blocking Database Calls)
orderSchema.pre("save", function (next) {
  if (!this.isNew || this.orderNumber) return next();
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars
  const buyerTail = this.buyer.toString().slice(-3).toUpperCase();
  this.orderNumber = `${dateStr}-${buyerTail}-${randomHex}`;
  next();
});

export default mongoose.model("Order", orderSchema);