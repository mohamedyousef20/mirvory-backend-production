// models/order.model.js
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    index: true,
  },

  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      quantity: Number,
      price: Number,
      color: String,
      size: String,
      isPrepared: { type: Boolean, default: false },
    },
  ],

  deliveryInfo: {
    fullName: String,
    phoneNumber: String,
    address: String,
    pickupPoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PickupPoint",
    },
  },

  paymentMethod: {
    type: String,
    enum: ["cash", "card"],
    default: "cash",
  },

  paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending",
  },

  payoutDate: Date,
  paymentData: mongoose.Schema.Types.Mixed,

  subtotal: Number,
  discount: Number,
  shippingFee: Number,
  total: Number,

  deliveryMethod: {
    type: String,
    enum: ["home", "pickup"],
    default: "home",
  },

  deliveryStatus: {
    type: String,
    enum: ["pending", "shipped", "delivered", "cancelled"],
    default: "pending",
  },

  deliveredAt: {
    type: Date,
  },

  payoutProcessed: {
    type: Boolean,
    default: false,
  },

  isPrepared: {
    type: Boolean,
    default: false,
  },

  secretCode: {
    type: String,
    unique: true,
    required: true,
  },
}, {
  timestamps: true,
});


// =====================================
// ORDER NUMBER MIDDLEWARE
// Format:
// MMDD + Last3Buyer + Random3
// مثال:
// 0503501234
// =====================================
orderSchema.pre("save", async function (next) {
  if (!this.isNew || this.orderNumber) return next();

  try {
    const now = new Date();

    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    // آخر 4 أرقام من buyer id
    const buyerPart = this.buyer.toString().slice(-3).toUpperCase();

    let isUnique = false;
    let generatedOrderNumber = "";

    while (!isUnique) {
      // رقم عشوائي 3 digits
      const randomPart = Math.floor(100 + Math.random() * 900);

      generatedOrderNumber = `${mm}${dd}${buyerPart}${randomPart}`;

      const existingOrder = await mongoose.models.Order.findOne({
        orderNumber: generatedOrderNumber,
      });

      if (!existingOrder) {
        isUnique = true;
      }
    }

    this.orderNumber = generatedOrderNumber;

    next();
  } catch (error) {
    next(error);
  }
});


// =====================================
// AUTO POPULATE
// =====================================
orderSchema.pre(/^find/, function (next) {
  this.populate({
    path: "items.seller",
    select: "name email phone wallet",
  })
    .populate({
      path: "items.product",
      select: "title price images colors sizes",
    })
    .populate({
      path: "deliveryInfo.pickupPoint",
      select: "stationName address phone",
    });

  next();
});

export default mongoose.model("Order", orderSchema);