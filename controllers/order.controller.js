import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import SecretCode from '../models/secretCode.model.js';
import Cart from '../models/cart.model.js'
import mongoose from 'mongoose';
import { createNotifications } from '../utils/notification.js';

export const createOrderFilterObj = (req, res, next) => {
  let filterObj = {};

  const {
    buyer,
    seller,
    product,
    minTotal,
    maxTotal,
    paymentMethod,
    paymentStatus,
    deliveryMethod,
    deliveryStatus,
    payoutProcessed,
    isPrepared,
    secretCode,
    startDate,
    endDate,
    search
  } = req.query;

  // Buyer filter
  if (buyer) {
    filterObj.buyer = new mongoose.Types.ObjectId(buyer);
  }

  // Seller filter (through items array)
  if (seller) {
    filterObj['items.seller'] = new mongoose.Types.ObjectId(seller);
  }

  // Product filter (through items array)
  if (product) {
    filterObj['items.product'] = new mongoose.Types.ObjectId(product);
  }

  // Total price range filtering
  if (minTotal || maxTotal) {
    filterObj.total = {};
    if (minTotal) {
      filterObj.total.$gte = parseFloat(minTotal);
    }
    if (maxTotal) {
      filterObj.total.$lte = parseFloat(maxTotal);
    }
  }

  // Payment method filter
  if (paymentMethod) {
    filterObj.paymentMethod = paymentMethod;
  }

  // Payment status filter
  if (paymentStatus) {
    filterObj.paymentStatus = paymentStatus;
  }

  // Delivery method filter
  if (deliveryMethod) {
    filterObj.deliveryMethod = deliveryMethod;
  }

  // Delivery status filter
  if (deliveryStatus) {
    filterObj.deliveryStatus = deliveryStatus;
  }

  // Boolean filters
  if (payoutProcessed !== undefined) {
    filterObj.payoutProcessed = payoutProcessed === 'true';
  }

  if (isPrepared !== undefined) {
    filterObj.isPrepared = isPrepared === 'true';
  }

  // Secret code filter
  if (secretCode) {
    filterObj.secretCode = secretCode;
  }

  // Date range filtering
  if (startDate || endDate) {
    filterObj.createdAt = {};
    if (startDate) {
      filterObj.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      filterObj.createdAt.$lte = new Date(endDate);
    }
  }

  // Search functionality (if you want to search by delivery info)
  if (search) {
    filterObj.$or = [
      { 'deliveryInfo.fullName': { $regex: search, $options: 'i' } },
      { 'deliveryInfo.phoneNumber': { $regex: search, $options: 'i' } },
      { 'deliveryInfo.address': { $regex: search, $options: 'i' } },
      { secretCode: { $regex: search, $options: 'i' } }
    ];
  }

  req.filterObj = filterObj;
  next();
};

// Helper function to generate secret code
const generateUniqueSecretCode = async (buyerId) => {
  const timestamp = Date.now().toString().slice(-6); // Last 6 digits of current time
  const randomDigits = Math.floor(100 + Math.random() * 900); // 3 random digits (100-999)
  const buyerSuffix = buyerId.toString().slice(-3); // Last 3 digits of buyer ID

  const code = `${timestamp}${randomDigits}${buyerSuffix}`;
  console.log(code, 'code')
  // Double-check uniqueness (rarely needed, but ensures safety)
  const existingOrder = await Order.findOne({ secretCode: code });
  if (existingOrder) {
    // If by some miracle it's not unique, retry recursively
    return generateUniqueSecretCode(buyerId);
  }
  console.log(existingOrder, 'existingOrder')

  return code;
};



export const updatePayment = async (req, res) => {
  try {
    const { orderId, paymentMethod, totalAmount } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Update payment details
    order.paymentMethod = paymentMethod;
    order.total = totalAmount;
    order.paymentStatus = 'completed';

    await order.save();

    res.status(200).json({ message: 'Payment updated successfully' });
  } catch (error) {
    console.error('Payment update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};



export const createOrder = async (req, res, next) => {
  try {
    // Get cart
    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: "items.product",
      populate: {
        path: "seller",
        select: "_id firstName lastName",
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(404).json({
        message: "No cart found or cart is empty",
      });
    }

    // Calculate totals
    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );

    // const discount = Math.min(50, subtotal * 0.1);خصم 10% بحد أقصى 50 جنيه
    const discount = 0;
    const shippingFee = subtotal > 500 ? 0 : 70;
    const total = subtotal - discount + shippingFee;

    // Create order
    const order = await Order.create({
      buyer: req.user._id,
      items: cart.items.map((item) => ({
        product: item.product._id,
        seller: item.product.seller._id,
        quantity: item.quantity,
        price: item.product.price,
        color: item.color,
        size: item.size,
      })),
      paymentMethod: req.body.paymentMethod,
      subtotal,
      discount,
      shippingFee,
      total,
      paymentStatus: "pending",
      deliveryStatus: "pending",
      deliveryMethod: req.body.deliveryMethod,
      pickupPoint: req.body.pickupPoint,
      secretCode: await generateUniqueSecretCode(req.user._id),
    });

    // ==============================
    // SEND SELLER NOTIFICATIONS
    // ==============================
    try {
      const io = req.app.get("io");

      // Group items by seller
      const sellerItemsMap = {};

      cart.items.forEach((item) => {
        const sellerId = item.product.seller._id.toString();

        if (!sellerItemsMap[sellerId]) {
          sellerItemsMap[sellerId] = {
            sellerId,
            items: [],
          };
        }

        sellerItemsMap[sellerId].items.push(item);
      });

      // Send notification per seller
      for (const sellerId of Object.keys(sellerItemsMap)) {
        const sellerData = sellerItemsMap[sellerId];

        await createNotifications({
          io,
          title: "طلب جديد 🔔",
          message: `لديك طلب جديد يحتوي على ${sellerData.items.length} منتج. رقم الطلب: ${order._id
            .toString()
            .slice(-6)}`,
          type: "order_placed",
          actor: req.user._id, // buyer
          userIds: [sellerId],
          data: {
            orderId: order._id,
            itemsCount: sellerData.items.length,
            buyerId: req.user._id,
          },
          link: `/seller/orders/${order._id}`,
        });
      }
    } catch (notificationError) {
      console.error(
        "Failed to create seller notifications:",
        notificationError
      );
    }

    // ==============================
    // UPDATE PRODUCTS
    // ==============================
    const bulkOps = cart.items.map((item) => ({
      updateOne: {
        filter: {
          _id: item.product._id,
          quantity: { $gte: item.quantity }, // Prevent overselling
        },
        update: {
          $inc: {
            quantity: -item.quantity,
            sold: item.quantity,
          },
        },
      },
    }));

    try {
      const result = await Product.bulkWrite(bulkOps, {
        ordered: false,
      });

      if (result.modifiedCount !== cart.items.length) {
        throw new Error(
          `Expected ${cart.items.length} updates, got ${result.modifiedCount}`
        );
      }
    } catch (error) {
      console.error("Product quantity update failed:", error);
      throw new Error(
        "Failed to update product quantities. Please try again."
      );
    }

    // Clear cart
    await Cart.findOneAndDelete({
      user: req.user._id,
    });

    // Success response
    res.status(201).json({
      status: "success",
      message: "Order created successfully",
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

// get all orders (admin)
export const getAdminOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await Order.countDocuments();

    // Get paginated orders with populated fields
    const orders = await Order.find()
      .populate('buyer', 'firstName lastName email phone')
      .populate({
        path: 'items.product',
        select: 'title titleEn images'
      })
      .populate({
        path: 'items.seller',
        select: 'firstName lastName email phone wallet'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalOrders: total,
        limit
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getSellerOrders = async (req, res) => {
  try {
    const orders = await Order.find({ "items.seller": req.user._id })
      .select('-secretCode -discount -payoutProcessed')
      .populate('items.product', 'title titleEn images')
      .lean();
    console.log(req.user,'ord')
        const filteredOrders = orders.map(order => {
      // فلترة المنتجات الخاصة بالبائع الحالي فقط
      const sellerItems = order.items.filter(
        item => item.seller?._id.toString() === req.user._id.toString()
      );

      // حساب subtotal للبائع فقط
      const sellerSubtotal = sellerItems.reduce(
        (acc, item) => acc + item.price * item.quantity,
        0
      );
      return {
        ...order,
        items: sellerItems,
        sellerSubtotal
      };
    });

    res.json(filteredOrders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



export const getVendorEarnings = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const orders = await Order.find({ seller: vendorId });

    const earnings = orders.reduce((sum, order) => {
      const vendorAmount = order.productPrice * ((100 - order.sitePercentage - order.discountPercentage) / 100);
      return sum + vendorAmount;
    }, 0);

    res.json({ earnings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// get user orders 
export const getUserOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id.toString();

    // Find order
    const order = await Order.findById(id)
      .populate('buyer', 'firstName lastName email phone')
      .populate({
        path: 'items.product',
        select: 'title titleEn images'
      });

    if (!order) {
      return res.status(404).json({
        message: 'Order not found'
      });
    }

    // Check if user is authorized (buyer or seller in order)
    const isBuyer = order.buyer?._id?.toString() === userId;
    const isSeller = order.items.some(item =>
      (item.seller?._id || item.seller)?.toString() === userId
    );
    const isAdmin = req.user.role === 'admin';

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({
        message: 'You do not have permission to view this order'
      });
    }

    // For sellers, filter items to only show their items
    let responseOrder = order.toObject();
    if (isSeller && !isBuyer) {
      const sellerItems = order.items.filter(item =>
        (item.seller?._id || item.seller)?.toString() === userId
      );
      responseOrder.items = sellerItems;
      responseOrder.isSellerView = true;
    }

    res.json(responseOrder);
  } catch (err) {
    console.error('Get user order by ID error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Generate invoice for order
export const printInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    // Find order and populate necessary fields
    const order = await Order.findById(id)
      .populate('buyer', 'firstName lastName email phone')
      .populate({
        path: 'items.product',
        select: 'title titleEn images'
      });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized (buyer or seller in order)
    const userId = req.user._id.toString();
    const isBuyer = order.buyer?._id?.toString() === userId;
    const isSeller = order.items.some(item =>
      (item.seller?._id || item.seller)?.toString() === userId
    );

    if (!isBuyer && !isSeller && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this invoice' });
    }

    // Filter items for seller only (if user is seller)
    let invoiceItems = order.items;
    if (isSeller && !isBuyer) {
      invoiceItems = order.items.filter(item =>
        (item.seller?._id || item.seller)?.toString() === userId
      );
    }

    // Calculate seller-specific subtotal
    const sellerSubtotal = invoiceItems.reduce((acc, item) =>
      acc + (item.price * item.quantity), 0
    );

    // Generate invoice data
    const invoiceData = {
      invoiceNumber: `INV-${order._id.toString().slice(-8).toUpperCase()}`,
      orderNumber: order.orderNumber || order._id.toString().slice(-6).toUpperCase(),
      date: order.createdAt,
      buyer: {
        name: `${order.buyer?.firstName || ''} ${order.buyer?.lastName || ''}`.trim(),
        email: order.buyer?.email,
        phone: order.buyer?.phone
      },
      items: invoiceItems.map(item => ({
        product: item.product?.title || item.product?.titleEn,
        quantity: item.quantity,
        price: item.price,
        total: item.quantity * item.price,
        color: item.color,
        size: item.size
      })),
      subtotal: isSeller && !isBuyer ? sellerSubtotal : order.subtotal,
      discount: isSeller && !isBuyer ? 0 : order.discount,
      shippingFee: isSeller && !isBuyer ? 0 : order.shippingFee,
      total: isSeller && !isBuyer ? sellerSubtotal : order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      isSellerInvoice: isSeller && !isBuyer
    };

    res.json(invoiceData);
  } catch (err) {
    console.error('Print invoice error:', err);
    res.status(500).json({ message: err.message });
  }
};

// update seller balance
export const orderComplete = async (req, res) => {
  try {
    console.log('im in complete order function >>>>>>>>>>')
    const { id, code } = req.body;

    // Find the order by id + secret code and populate sellers
    const order = await Order.findOne({ _id: id, secretCode: code });
    console.log(JSON.stringify(order, null, 2));
    if (!order) {
      return res.status(404).json({ message: 'Order not found or code invalid' });
    }

    // Update order status
    order.deliveryStatus = 'delivered';
    order.paymentStatus = 'paid';
    order.deliveredAt = new Date();
    await order.save();

    // Process payouts (only if not already processed)
    if (!order.payoutProcessed) {

      const getPlatformFeePercentage = (price) => {
        if (!price || price <= 0) return 0.10;

        if (price < 300) return 0.18;
        if (price <= 799) return 0.15;
        if (price <= 1999) return 0.12;

        return 0.10;
      };

      const sellerEarningsMap = {};
      const sellerIds = [];

      order.items.forEach((item) => {
        const sellerId = item.seller._id.toString();
        const itemTotal = item.price * item.quantity;

        const platformFeePercentage = getPlatformFeePercentage(itemTotal);
        const sellerEarnings = itemTotal * (1 - platformFeePercentage);

        if (!sellerEarningsMap[sellerId]) {
          sellerEarningsMap[sellerId] = {
            seller: item.seller,
            earnings: 0,
          };
        }

        sellerEarningsMap[sellerId].earnings += sellerEarnings;
      });

      for (const sellerId in sellerEarningsMap) {
        const { seller, earnings } = sellerEarningsMap[sellerId];

        if (!seller.wallet) {
          seller.wallet = {
            balance: 0,
            pendingBalance: 0,
            lastTransaction: null,
          };
        }

        seller.wallet.pendingBalance += earnings;
        seller.wallet.lastTransaction = {
          amount: earnings,
          date: new Date(),
          orderId: order._id,
        };

        await seller.save();

        sellerIds.push(sellerId);
      }

      order.payoutProcessed = true;
      order.payoutDate = new Date();
      await order.save();
    }

    // Send notifications via socket
    try {
      const io = req.app.get("io");
      const adminUsers = await User.find({ role: 'admin' });

      // Notify sellers about payout
      for (const sellerId of sellerIds) {
        const { earnings } = sellerEarningsMap[sellerId];
        await createNotifications({
          io,
          title: '💵 تم تحويل الأرباح',
          message: `تم تحويل مبلغ ${earnings.toFixed(2)} جنيه كأرباح من الطلب #${order._id.toString().slice(-6)} إلى محفظتك`,
          type: 'PAYOUT_COMPLETED',
          actor: req.user._id,
          userIds: [sellerId],
          data: { orderId: order._id, earnings },
          link: `/seller/orders/${order._id}`,
        });
      }

      // Notify buyer
      await createNotifications({
        io,
        title: '✅ تم تسليم الطلب',
        message: `تم تسليم طلبك #${order._id.toString().slice(-6)} بنجاح! نتمنى أن تكون تجربة تسوق سعيدة 🎉`,
        type: 'ORDER_COMPLETED',
        actor: req.user._id,
        userIds: [order.buyer._id.toString()],
        data: { orderId: order._id },
        link: `/orders/${order._id}`,
      });

      // Notify admins
      if (adminUsers.length > 0) {
        await createNotifications({
          io,
          title: '✅ طلب تم تسليمه',
          message: `تم تسليم الطلب #${order._id.toString().slice(-6)} بنجاح`,
          type: 'ORDER_COMPLETED',
          actor: req.user._id,
          userIds: adminUsers.map(a => a._id.toString()),
          data: { orderId: order._id, buyerId: order.buyer._id },
          link: `/admin/orders/${order._id}`,
        });
      }
    } catch (notificationError) {
      console.error('Failed to create order completion notifications:', notificationError);
    }

    res.json({
      message: 'Order done successfully',
      payoutProcessed: order.payoutProcessed,
    });

  } catch (err) {
    console.error('Order confirmation error:', err);
    res.status(500).json({ message: err.message });
  }
};

export const confirmPreparation = async (req, res) => {
  try {
    const sellerId = req.user._id.toString();

    const order = await Order.findOne({
      _id: req.params.id,
      "items.seller": req.user._id
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const sellerItems = order.items.filter(
      (it) => (it.seller?._id || it.seller).toString() === sellerId
    );

    if (sellerItems.length === 0) {
      return res.status(403).json({ message: "Not your order" });
    }

    let anyUpdated = false;

    sellerItems.forEach((it) => {
      if (!it.isPrepared) {
        it.isPrepared = true;
        anyUpdated = true;
      }
    });

    // check full order
    order.isPrepared = order.items.every((it) => it.isPrepared);

    await order.save();

    // FIX notification
    const productNames = sellerItems.map(
      (it) => it.product?.title || "Product"
    );

    try {
      const io = req.app.get("io");

      await createNotifications({
        io,
        title: "📦 تم تجهيز الطلب",

        message: `قام البائع بتجهيز ${productNames.length} منتج${productNames.length > 1 ? "ات" : ""
          } (${productNames[0]})`,

        type: "order_prepared",
        actor: req.user._id,
        role: "admin",

        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          products: productNames,
          itemsCount: productNames.length,
        },

        link: `/admin/orders/${order._id}`,
      });

    } catch (error) {
      console.error("Notification error:", error);
    }
    res.json({
      message: anyUpdated ? 'success' : 'fail',
      orderPrepared: order.isPrepared,
      updatedItems: sellerItems.map(it => ({
        _id: it._id,
        isPrepared: it.isPrepared
      }))
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Confirm preparation for a specific item
export const confirmItemPreparation = async (req, res) => {
  try {
    const sellerId = req.user._id.toString();
    const { orderId, itemId } = req.params;

    const order = await Order.findOne({
      _id: orderId,
      "items.seller": req.user._id
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Find the specific item
    const item = order.items.find(
      (it) => it._id.toString() === itemId &&
        (it.seller?._id || it.seller).toString() === sellerId
    );

    if (!item) {
      return res.status(403).json({ message: "Item not found or not yours" });
    }

    if (item.isPrepared) {
      return res.status(400).json({ message: "Item already prepared" });
    }

    // Mark item as prepared
    item.isPrepared = true;

    // Check if all items are prepared
    order.isPrepared = order.items.every((it) => it.isPrepared);

    await order.save();

    // Send notification
    try {
      const io = req.app.get("io");
      await createNotifications({
        io,
        title: "📦 تم تجهيز منتج",
        message: `قام البائع بتجهيز المنتج: ${item.product?.title || "Product"}`,
        type: "order_prepared",
        actor: req.user._id,
        role: "admin",
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          itemId: item._id,
          productName: item.product?.title,
        },
        link: `/admin/orders/${order._id}`,
      });
    } catch (error) {
      console.error("Notification error:", error);
    }

    res.json({
      message: "success",
      item: {
        _id: item._id,
        isPrepared: item.isPrepared
      },
      orderPrepared: order.isPrepared
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateDeliveryStatus = async (req, res) => {
  try {
    console.log('im in the updateDeliveryStatus');
    // Find the order by id
    const { id, deliveryStatus } = req.body;
    const order = await Order.findById(id)

    if (!order) {
      return res.status(404).json({ message: 'Order not found   ' });
    }

    order.deliveryStatus = deliveryStatus;
    await order.save();
    //create notification for buyer
    const buyerNotification = new Notification({
      userId: req.user._id,
      role: 'user',
      type: 'ORDER_PLACED',
      title: 'تم تحديث حالة طلبك بنجاح ✅',
      message: `📦 تم ${deliveryStatus} الطلب`,
      orderId: order._id,
      link: `/orders/${order._id}`
    });
    await buyerNotification.save();

    res.json({
      message: 'success',
    });

  } catch (err) {
    console.error(' error:', err);
    res.status(500).json({ message: err.message });
  }
};




// payments
export const cashingOrder = async (req, res, next) => {
  // maintenance later and make it set by admin
  const textPrice = 0;
  const shippingPrice = 0;
  // get cart by cart id
  const cart = await Cart.findById(req.params.cartId);
  if (!cart) {
    return next(new createError(`No cart founded`, 404));
  }
  // get order price by cart price ' check if there is coupon'
  let OrderPrice = 0;
  if (cart.priceAfterDiscount) {
    OrderPrice = cart.priceAfterDiscount;
  } else {
    OrderPrice = cart.totalPrice;
  }
  const totalOrderPrice = OrderPrice + textPrice + shippingPrice;
  // create order with default payment method 'cashing method'
  const order = await Order.create({
    user: req.user._id,
    cartItem: cart.cartItem,
    shippingAddress: req.body.shippingAddress,
    totalOrderPrice: totalOrderPrice,
  });
  if (order) {
    // decrement product quantity and increment product sold in product schema
    const bulkOptions = cart.cartItem.map((item) => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { quantity: -item.quantity, sold: +item.quantity } },
      },
    }));
    const product = await Product.bulkWrite(bulkOptions, {});

    // clear the cart of user as is done

    await Cart.findByIdAndDelete(req.params.cartId);
    console.log(req.user._id, 'iddddddddddddddddddddddddddddddddd')
    //create notification for buyer
    const buyerNotification = new Notification({
      userId: req.user._id,
      role: 'user',
      type: 'ORDER_PLACED',
      title: 'تم تأكيد طلبك بنجاح ✅',
      message: `تم استلام طلبك رقم #${order._id.toString().slice(-6)} وسيتم تجهيزه قريباً`,
      orderId: order._id,
      link: `/orders/${order._id}`
    });
    console.log(buyerNotification, 'buyerNotification')
    await buyerNotification.save();

  }
  res.status(201).json({ msg: "success", data: order });
};
// cancel order
// export const cancelOrder = asyncHandler(async (req, res, next) => {
//   console.log(req.body.id, "ddddddddddddddd")
//   const { id } = req.body;
//   console.log(id)
//   const order = await Order.findById(id);
//   if (!order) {
//     next(new createError('No order found '))
//   }
//   // get date now
//   const currentDate = Date.now();
//   // get createAt order to milliseconds
//   const orderCreatedAt = order.createdAt.getTime();
//   const toDayInMilliseconds = 2 * 24 * 60 * 60 * 1000;



//   if (currentDate - orderCreatedAt >= toDayInMilliseconds) {

//     order.canCancel = false;

//     next(createError('to days left '))

//   }

//   order.OrderStatus = "canceled";
//   order.canCancel = false;
//   order.cancelDate = currentDate;

//   // delete order after one day
//   const orderCancelDate = order.cancelDate.getTime();
//   const OneDayInMilliseconds = 1 * 24 * 60 * 60 * 1000;

//   if (currentDate - orderCancelDate >= OneDayInMilliseconds) {
//     deleteOne(order)
//   }

//   await order.save();

//   res.status(200).json({ msg: "Order canceled successfully" });


// })


// // active order
// export const activeOrder = asyncHandler(async (req, res, next) => {
//   console.log('update succ')
//   const { id } = req.body;
//   console.log(id)
//   const order = await Order.findById(id);
//   if (!order) {
//     next(new createError('No order found '))
//   }
//   // get date now
//   // get createAt order to milliseconds
//   const cancelDate = order.cancelDate.getTime();
//   const oneDayInMilliseconds = 1 * 24 * 60 * 60 * 1000;



//   if (cancelDate - oneDayInMilliseconds >= oneDayInMilliseconds) {


//     next(new createError('One days left '))

//   }

//   order.OrderStatus = "active";
//   order.canCancel = true;
//   await order.save();

//   res.status(200).json({ msg: "Order active successfully" });


// })


// // get all orders 'admin , logged user'
// export const getAllOrders = getAllDocuments(Order);

// // get specific orders 'admin , logged user'
// export const getOrder = getOne(Order);


// export const updatedOrderPaymentMethod = asyncHandler(async (req, res, next) => {
//   console.log('req of body is', req.body)
//   const { id, method } = req.body
//   const order = await Order.findOne({ _id: id });
//   console.log(order)
//   order.paymentMethod = method;
//   await order.save();
//   res.status(201).json({ msg: "success", data: order });
// });


// // updated status by admin

// export const updatedOrderPaidByAdmin = asyncHandler(async (req, res, next) => {
//   const order = await Order.findOne({ _id: req.params.id });
//   order.isPaid = true;
//   order.isPaidAt = Date.now();
//   await order.save();
//   res.status(201).json({ msg: "success", data: order });
// });

// export const updatedOrderDeliveredByAdmin = asyncHandler(
//   async (req, res, next) => {
//     const order = await Order.findOne({ _id: req.params.id });
//     order.isDelivered = true;
//     order.deliveredAt = Date.now();
//     await order.save();
//     res.status(201).json({ msg: "success", data: order });
//   }
// );




// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);  

// export const checkOutSession = asyncHandler(async (req, res, next) => {
//   const shippingPrice = 70;
//   const cart = await Cart.findById(req.params.cartId);
//   if (!cart) {
//     return next(new createError(`No cart found`, 404));
//   }

//   let orderPrice = cart.priceAfterDiscount || cart.totalPrice;
//   const totalOrderPrice = orderPrice + shippingPrice;

//   try {
//     const session = await stripe.checkout.sessions.create({
//       line_items: [
//         {
//           price_data: {
//             currency: "egp",
//             product_data: {
//               name: req.user.name,
//             },
//             unit_amount: totalOrderPrice * 100, // Convert to cents
//           },
//           quantity: 1,
//         },
//       ],
//       mode: "payment",
//       success_url: `${req.protocol}://${req.get("host")}/order`,
//       cancel_url: `${req.protocol}://${req.get("host")}/cart`,
//       customer_email: req.user.email,
//       client_reference_id: cart._id.toString(),
//       metadata: req.body.shippingAddress,
//     });

//     res.status(200).json({ msg: "success", session });
//   } catch (error) {
//     console.error("Stripe Error:", error);
//     next(new createError(`Stripe error: ${error.message}`, 500));
//   }
// });
