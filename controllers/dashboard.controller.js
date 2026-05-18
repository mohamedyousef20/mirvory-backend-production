import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';

// Seller Dashboard Controllers
export const getSellerCounters = async (req, res) => {
  try {
    console.log('getSellerCounters called, user:', req.user);
    const sellerId = req.user._id;
    
    // Get counts for seller's data
    const [
      totalOrders,
      pendingOrders,
      completedOrders,
      totalProducts,
      activeProducts,
      totalRevenue
    ] = await Promise.all([
      Order.countDocuments({ 'items.seller': sellerId }),
      Order.countDocuments({ 'items.seller': sellerId, deliveryStatus: 'pending' }),
      Order.countDocuments({ 'items.seller': sellerId, deliveryStatus: 'delivered' }),
      Product.countDocuments({ seller: sellerId }),
      Product.countDocuments({ seller: sellerId, status: 'active' }),
      Order.aggregate([
        { $match: { 'items.seller': sellerId, paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        completedOrders,
        totalProducts,
        activeProducts,
        totalRevenue: totalRevenue[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get seller counters error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getSellerAnalytics = async (req, res) => {
  try {
    const sellerId = req.user._id;
    
    // Get monthly sales data for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlySales = await Order.aggregate([
      {
        $match: {
          'items.seller': sellerId,
          paymentStatus: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get top selling products
    const topProducts = await Order.aggregate([
      { $match: { 'items.seller': sellerId, paymentStatus: 'completed' } },
      { $unwind: '$items' },
      { $match: { 'items.seller': sellerId } },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' }
    ]);

    res.json({
      success: true,
      data: {
        monthlySales,
        topProducts
      }
    });
  } catch (error) {
    console.error('Get seller analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getSellerTransactions = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { page = 1, limit = 10 } = req.query;
    
    const orders = await Order.find({ 'items.seller': sellerId })
      .populate('items.product', 'title images')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments({ 'items.seller': sellerId });

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get seller transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Admin Dashboard Controllers
export const getAdminCounters = async (req, res) => {
  try {
    const [
      totalUsers,
      totalSellers,
      totalOrders,
      pendingOrders,
      totalProducts,
      pendingProducts,
      totalRevenue,
      totalDiscounts,
      totalCommissions
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'seller' }),
      Order.countDocuments(),
      Order.countDocuments({ deliveryStatus: 'pending' }),
      Product.countDocuments(),
      Product.countDocuments({ status: 'pending' }),
      Order.aggregate([
        { $match: { paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Order.aggregate([
        { $match: { paymentStatus: 'completed', discount: { $exists: true, $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$discount' } } }
      ]),
      Order.aggregate([
        { $match: { paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$total', 0.10] } } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalSellers,
        totalOrders,
        pendingOrders,
        totalProducts,
        pendingProducts,
        totalRevenue: totalRevenue[0]?.total || 0,
        totalDiscounts: totalDiscounts[0]?.total || 0,
        totalCommissions: totalCommissions[0]?.total || 0,
        totalProfits: totalCommissions[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get admin counters error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminAnalytics = async (req, res) => {
  try {
    // Get monthly revenue for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          paymentStatus: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Get user growth
    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          users: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        monthlyRevenue,
        userGrowth
      }
    });
  } catch (error) {
    console.error('Get admin analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const orders = await Order.find({})
      .populate('buyer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments();

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
