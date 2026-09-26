/**
 * analytics.controller.js
 * Comprehensive admin analytics for MIRVORY.
 * All calculations are based strictly on DB data — no invented values.
 */

import Order from '../models/order.model.js';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';

// ─── Date Helpers ────────────────────────────────────────────────────────────

function buildDateRange(period, from, to) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (period) {
    case 'today': {
      const s = startOfDay(now);
      const e = endOfDay(now);
      return { current: { $gte: s, $lte: e }, prev: { $gte: new Date(s - 86400000), $lte: new Date(e - 86400000) } };
    }
    case 'yesterday': {
      const y = new Date(now - 86400000);
      const s = startOfDay(y);
      const e = endOfDay(y);
      return { current: { $gte: s, $lte: e }, prev: { $gte: new Date(s - 86400000), $lte: new Date(e - 86400000) } };
    }
    case 'last7': {
      const s = new Date(now - 7 * 86400000);
      return { current: { $gte: s, $lte: now }, prev: { $gte: new Date(now - 14 * 86400000), $lte: new Date(now - 7 * 86400000) } };
    }
    case 'last30': {
      const s = new Date(now - 30 * 86400000);
      return { current: { $gte: s, $lte: now }, prev: { $gte: new Date(now - 60 * 86400000), $lte: new Date(now - 30 * 86400000) } };
    }
    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevS = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevE = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { current: { $gte: s, $lte: now }, prev: { $gte: prevS, $lte: prevE } };
    }
    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const prevS = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevE = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999);
      return { current: { $gte: s, $lte: e }, prev: { $gte: prevS, $lte: prevE } };
    }
    case 'custom': {
      if (from && to) {
        const s = new Date(from);
        const e = new Date(to);
        e.setHours(23, 59, 59, 999);
        const diffMs = e - s;
        return { current: { $gte: s, $lte: e }, prev: { $gte: new Date(s - diffMs), $lte: new Date(s - 1) } };
      }
      // fallback
    }
    default: {
      const s = new Date(now - 30 * 86400000);
      return { current: { $gte: s, $lte: now }, prev: { $gte: new Date(now - 60 * 86400000), $lte: new Date(now - 30 * 86400000) } };
    }
  }
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

// ─── Build base match from filters ───────────────────────────────────────────

function buildOrderMatch(filters, dateRange) {
  const match = { createdAt: dateRange };

  if (filters.governorate) {
    match['deliveryInfo.address'] = { $regex: filters.governorate, $options: 'i' };
  }
  if (filters.deliveryStatus) {
    match.deliveryStatus = filters.deliveryStatus;
  }
  if (filters.paymentMethod) {
    match.paymentMethod = filters.paymentMethod;
  }
  return match;
}

// ─── Main Analytics Endpoint ─────────────────────────────────────────────────

export const getFullAdminAnalytics = async (req, res) => {
  try {
    const {
      period = 'last30',
      from,
      to,
      governorate,
      deliveryStatus,
      paymentMethod,
      productId,
      size,
      color,
      groupBy = 'day', // day | week | month
    } = req.query;

    const ranges = buildDateRange(period, from, to);
    const currRange = ranges.current;
    const prevRange = ranges.prev;

    const filters = { governorate, deliveryStatus, paymentMethod };
    const currMatch = buildOrderMatch(filters, currRange);
    const prevMatch = buildOrderMatch(filters, prevRange);

    // Extra product-level filters applied after $unwind
    const itemFilters = {};
    if (productId) {
      try { itemFilters['items.product'] = new mongoose.Types.ObjectId(productId); } catch {}
    }
    if (size) itemFilters['items.size'] = size;
    if (color) itemFilters['items.color.name'] = { $regex: color, $options: 'i' };

    // ── 1. KPI aggregations (current + prev period) ──────────────────────────
    const kpiPipeline = (match) => [
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders:    { $sum: 1 },
          delivered:      { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'delivered'] }, 1, 0] } },
          pending:        { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'pending'] }, 1, 0] } },
          shipped:        { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'shipped'] }, 1, 0] } },
          cancelled:      { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] } },
          totalRevenue:   { $sum: '$total' },
          totalSubtotal:  { $sum: '$subtotal' },
          totalDiscount:  { $sum: { $ifNull: ['$discount', 0] } },
          totalShipping:  { $sum: { $ifNull: ['$shippingFee', 0] } },
          uniqueBuyers:   { $addToSet: '$buyer' },
        }
      },
      {
        $project: {
          _id: 0,
          totalOrders: 1,
          delivered: 1,
          pending: 1,
          shipped: 1,
          cancelled: 1,
          totalRevenue: 1,
          totalSubtotal: 1,
          totalDiscount: 1,
          totalShipping: 1,
          netRevenue: { $subtract: ['$totalRevenue', { $ifNull: ['$totalDiscount', 0] }] },
          avgOrderValue: { $cond: [{ $gt: ['$totalOrders', 0] }, { $divide: ['$totalRevenue', '$totalOrders'] }, 0] },
          uniqueBuyerCount: { $size: '$uniqueBuyers' },
          completionRate: {
            $cond: [{ $gt: ['$totalOrders', 0] },
              { $multiply: [{ $divide: ['$delivered', '$totalOrders'] }, 100] }, 0]
          },
          cancellationRate: {
            $cond: [{ $gt: ['$totalOrders', 0] },
              { $multiply: [{ $divide: ['$cancelled', '$totalOrders'] }, 100] }, 0]
          },
        }
      }
    ];

    // ── 2. Sales over time ────────────────────────────────────────────────────
    const dateGroupExpr = groupBy === 'month'
      ? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }
      : groupBy === 'week'
      ? { year: { $year: '$createdAt' }, week: { $week: '$createdAt' } }
      : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };

    const salesOverTimePipeline = [
      { $match: currMatch },
      {
        $group: {
          _id: dateGroupExpr,
          orders: { $sum: 1 },
          revenue: { $sum: '$total' },
          avgOrderValue: { $avg: '$total' },
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
    ];

    // ── 3. Orders by status (Donut) ───────────────────────────────────────────
    const statusDistPipeline = [
      { $match: currMatch },
      {
        $group: {
          _id: '$deliveryStatus',
          count: { $sum: 1 },
        }
      }
    ];

    // ── 4. Top Products ───────────────────────────────────────────────────────
    const productPerfPipeline = [
      { $match: currMatch },
      { $unwind: '$items' },
      ...(Object.keys(itemFilters).length ? [{ $match: itemFilters }] : []),
      {
        $group: {
          _id: '$items.product',
          ordersCount:   { $sum: 1 },
          qtySold:       { $sum: '$items.quantity' },
          revenue:       { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          avgPrice:      { $avg: '$items.price' },
          totalDiscount: { $sum: { $ifNull: ['$discount', 0] } },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] }
          },
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmpty: true } },
      {
        $project: {
          _id: 1,
          title: '$productInfo.title',
          ordersCount: 1,
          qtySold: 1,
          revenue: 1,
          avgPrice: 1,
          totalDiscount: 1,
          cancelledCount: 1,
          cancelRate: {
            $cond: [{ $gt: ['$ordersCount', 0] },
              { $multiply: [{ $divide: ['$cancelledCount', '$ordersCount'] }, 100] }, 0]
          },
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 100 }
    ];

    // ── 5. Size analysis ─────────────────────────────────────────────────────
    const sizePipeline = [
      { $match: currMatch },
      { $unwind: '$items' },
      { $match: { 'items.size': { $exists: true, $ne: null, $ne: '' } } },
      ...(productId ? [{ $match: { 'items.product': new mongoose.Types.ObjectId(productId) } }] : []),
      {
        $group: {
          _id: '$items.size',
          ordersCount: { $sum: 1 },
          qtySold:     { $sum: '$items.quantity' },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] }
          },
        }
      },
      {
        $project: {
          size: '$_id',
          ordersCount: 1,
          qtySold: 1,
          cancelledCount: 1,
          cancelRate: {
            $cond: [{ $gt: ['$ordersCount', 0] },
              { $multiply: [{ $divide: ['$cancelledCount', '$ordersCount'] }, 100] }, 0]
          },
        }
      },
      { $sort: { ordersCount: -1 } }
    ];

    // ── 6. Color analysis ────────────────────────────────────────────────────
    const colorPipeline = [
      { $match: currMatch },
      { $unwind: '$items' },
      {
        $match: {
          'items.color.name': { $exists: true, $ne: null, $ne: '' }
        }
      },
      ...(productId ? [{ $match: { 'items.product': new mongoose.Types.ObjectId(productId) } }] : []),
      {
        $group: {
          _id: '$items.color.name',
          ordersCount: { $sum: 1 },
          qtySold:     { $sum: '$items.quantity' },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] }
          },
        }
      },
      {
        $project: {
          color: '$_id',
          ordersCount: 1,
          qtySold: 1,
          cancelledCount: 1,
          cancelRate: {
            $cond: [{ $gt: ['$ordersCount', 0] },
              { $multiply: [{ $divide: ['$cancelledCount', '$ordersCount'] }, 100] }, 0]
          },
        }
      },
      { $sort: { ordersCount: -1 } }
    ];

    // ── 7. Governorate analysis ───────────────────────────────────────────────
    // Extract governorate from deliveryInfo.address (first segment before comma or full field)
    const governoratePipeline = [
      { $match: { ...currMatch, 'deliveryInfo.address': { $exists: true, $ne: null } } },
      {
        $addFields: {
          gov: {
            $trim: {
              input: {
                $arrayElemAt: [{ $split: ['$deliveryInfo.address', ','] }, 0]
              }
            }
          }
        }
      },
      { $match: { gov: { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: '$gov',
          ordersCount:  { $sum: 1 },
          revenue:      { $sum: '$total' },
          avgOrder:     { $avg: '$total' },
          delivered:    { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'delivered'] }, 1, 0] } },
          cancelled:    { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] } },
          uniqueBuyers: { $addToSet: '$buyer' },
        }
      },
      {
        $project: {
          governorate: '$_id',
          ordersCount: 1,
          revenue: 1,
          avgOrder: 1,
          delivered: 1,
          cancelled: 1,
          customerCount: { $size: '$uniqueBuyers' },
          completionRate: {
            $cond: [{ $gt: ['$ordersCount', 0] },
              { $multiply: [{ $divide: ['$delivered', '$ordersCount'] }, 100] }, 0]
          },
          rejectionRate: {
            $cond: [{ $gt: ['$ordersCount', 0] },
              { $multiply: [{ $divide: ['$cancelled', '$ordersCount'] }, 100] }, 0]
          },
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 50 }
    ];

    // ── 8. Payment method breakdown ───────────────────────────────────────────
    const paymentBreakdownPipeline = [
      { $match: currMatch },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          revenue: { $sum: '$total' },
        }
      }
    ];

    // ── 9. Customer analysis ──────────────────────────────────────────────────
    const customerPipeline = [
      { $match: currMatch },
      {
        $group: {
          _id: '$buyer',
          ordersCount:  { $sum: 1 },
          totalSpent:   { $sum: '$total' },
          lastOrder:    { $max: '$createdAt' },
          avgOrder:     { $avg: '$total' },
          isGuest:      { $first: '$isGuest' },
        }
      },
      { $match: { _id: { $ne: null } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: { path: '$userInfo', preserveNullAndEmpty: true } },
      {
        $project: {
          _id: 1,
          name: {
            $cond: [
              '$userInfo.firstName',
              { $concat: [{ $ifNull: ['$userInfo.firstName', ''] }, ' ', { $ifNull: ['$userInfo.lastName', ''] }] },
              'ضيف'
            ]
          },
          phone: '$userInfo.phone',
          ordersCount: 1,
          totalSpent: 1,
          lastOrder: 1,
          avgOrder: 1,
          isGuest: 1,
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 100 }
    ];

    // ── 10. Top items (detailed orders table) ─────────────────────────────────
    const detailedOrdersPipeline = [
      { $match: currMatch },
      { $unwind: '$items' },
      ...(Object.keys(itemFilters).length ? [{ $match: itemFilters }] : []),
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDoc'
        }
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmpty: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyer',
          foreignField: '_id',
          as: 'buyerDoc'
        }
      },
      { $unwind: { path: '$buyerDoc', preserveNullAndEmpty: true } },
      {
        $project: {
          orderNumber: 1,
          createdAt: 1,
          deliveredAt: 1,
          deliveryStatus: 1,
          paymentMethod: 1,
          isGuest: 1,
          customerName: {
            $cond: [
              { $and: ['$buyerDoc.firstName', { $ne: ['$buyerDoc.firstName', null] }] },
              { $concat: [{ $ifNull: ['$buyerDoc.firstName', ''] }, ' ', { $ifNull: ['$buyerDoc.lastName', ''] }] },
              '$deliveryInfo.fullName'
            ]
          },
          customerPhone: {
            $ifNull: ['$deliveryInfo.phone', '$buyerDoc.phone']
          },
          productTitle: '$productDoc.title',
          productId: '$items.product',
          size: '$items.size',
          colorName: '$items.color.name',
          quantity: '$items.quantity',
          unitPrice: '$items.price',
          lineTotal: { $multiply: ['$items.price', '$items.quantity'] },
          discount: { $ifNull: ['$discount', 0] },
          shippingFee: { $ifNull: ['$shippingFee', 0] },
          orderTotal: '$total',
          address: '$deliveryInfo.address',
          deliveryDays: {
            $cond: [
              { $and: ['$deliveredAt', { $ne: ['$deliveryStatus', 'cancelled'] }] },
              {
                $divide: [
                  { $subtract: ['$deliveredAt', '$createdAt'] },
                  86400000
                ]
              },
              null
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 500 }
    ];

    // ── 11. Shipping analysis ─────────────────────────────────────────────────
    const shippingPipeline = [
      { $match: currMatch },
      {
        $group: {
          _id: null,
          totalShippingCost: { $sum: { $ifNull: ['$shippingFee', 0] } },
          avgShipping:       { $avg: { $ifNull: ['$shippingFee', 0] } },
          shippedOrders:     { $sum: { $cond: [{ $in: ['$deliveryStatus', ['shipped', 'delivered']] }, 1, 0] } },
          deliveredOrders:   { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'delivered'] }, 1, 0] } },
          cancelledOrders:   { $sum: { $cond: [{ $eq: ['$deliveryStatus', 'cancelled'] }, 1, 0] } },
          totalOrders:       { $sum: 1 },
          deliveredWithTime: {
            $push: {
              $cond: [
                { $and: ['$deliveredAt', '$createdAt'] },
                { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 86400000] },
                '$$REMOVE'
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalShippingCost: 1,
          avgShipping: 1,
          shippedOrders: 1,
          deliveredOrders: 1,
          cancelledOrders: 1,
          totalOrders: 1,
          rejectionRate: {
            $cond: [{ $gt: ['$totalOrders', 0] },
              { $multiply: [{ $divide: ['$cancelledOrders', '$totalOrders'] }, 100] }, 0]
          },
          avgDeliveryDays: { $avg: '$deliveredWithTime' }
        }
      }
    ];

    // ── Execute all pipelines in parallel ─────────────────────────────────────
    const [
      kpiCurr,
      kpiPrev,
      salesOverTime,
      statusDist,
      productPerf,
      sizeAnalysis,
      colorAnalysis,
      governorateAnalysis,
      paymentBreakdown,
      topCustomers,
      detailedOrders,
      shippingStats,
    ] = await Promise.all([
      Order.aggregate(kpiPipeline(currMatch)),
      Order.aggregate(kpiPipeline(prevMatch)),
      Order.aggregate(salesOverTimePipeline),
      Order.aggregate(statusDistPipeline),
      Order.aggregate(productPerfPipeline),
      Order.aggregate(sizePipeline),
      Order.aggregate(colorPipeline),
      Order.aggregate(governoratePipeline),
      Order.aggregate(paymentBreakdownPipeline),
      Order.aggregate(customerPipeline),
      Order.aggregate(detailedOrdersPipeline),
      Order.aggregate(shippingPipeline),
    ]);

    const curr = kpiCurr[0] || {};
    const prev = kpiPrev[0] || {};

    // ── Build KPI deltas ──────────────────────────────────────────────────────
    const kpi = {
      totalOrders:      { value: curr.totalOrders      || 0, delta: pctChange(curr.totalOrders || 0, prev.totalOrders || 0) },
      delivered:        { value: curr.delivered        || 0, delta: pctChange(curr.delivered || 0, prev.delivered || 0) },
      pending:          { value: curr.pending          || 0, delta: pctChange(curr.pending || 0, prev.pending || 0) },
      shipped:          { value: curr.shipped          || 0, delta: pctChange(curr.shipped || 0, prev.shipped || 0) },
      cancelled:        { value: curr.cancelled        || 0, delta: pctChange(curr.cancelled || 0, prev.cancelled || 0) },
      totalRevenue:     { value: curr.totalRevenue     || 0, delta: pctChange(curr.totalRevenue || 0, prev.totalRevenue || 0) },
      totalDiscount:    { value: curr.totalDiscount    || 0, delta: pctChange(curr.totalDiscount || 0, prev.totalDiscount || 0) },
      totalShipping:    { value: curr.totalShipping    || 0, delta: pctChange(curr.totalShipping || 0, prev.totalShipping || 0) },
      netRevenue:       { value: curr.netRevenue       || 0, delta: pctChange(curr.netRevenue || 0, prev.netRevenue || 0) },
      avgOrderValue:    { value: Math.round((curr.avgOrderValue || 0) * 100) / 100, delta: pctChange(curr.avgOrderValue || 0, prev.avgOrderValue || 0) },
      uniqueCustomers:  { value: curr.uniqueBuyerCount || 0, delta: pctChange(curr.uniqueBuyerCount || 0, prev.uniqueBuyerCount || 0) },
      completionRate:   { value: Math.round((curr.completionRate || 0) * 10) / 10, delta: pctChange(curr.completionRate || 0, prev.completionRate || 0) },
      cancellationRate: { value: Math.round((curr.cancellationRate || 0) * 10) / 10, delta: pctChange(curr.cancellationRate || 0, prev.cancellationRate || 0) },
    };

    // ── Customer repeat analysis ──────────────────────────────────────────────
    const repeatCustomers = topCustomers.filter(c => c.ordersCount > 1).length;
    const newCustomers    = topCustomers.filter(c => c.ordersCount === 1).length;

    // ── Alerts: products needing attention ────────────────────────────────────
    const highCancelRate  = productPerf.filter(p => p.cancelRate > 30 && p.ordersCount >= 3);
    const topSellers      = [...productPerf].sort((a, b) => b.qtySold - a.qtySold).slice(0, 5);
    const lowSellers      = productPerf.filter(p => p.ordersCount <= 2 && productPerf.length > 5);
    const topSizes        = sizeAnalysis.slice(0, 5);
    const topColors       = colorAnalysis.slice(0, 5);
    const topGovs         = [...governorateAnalysis].sort((a, b) => b.revenue - a.revenue).slice(0, 3);
    const highRejectGovs  = [...governorateAnalysis].sort((a, b) => b.rejectionRate - a.rejectionRate).filter(g => g.ordersCount >= 2).slice(0, 3);

    return res.json({
      success: true,
      data: {
        period: { current: currRange, previous: prevRange },
        kpi,
        customerSummary: {
          total:    kpi.uniqueCustomers.value,
          repeat:   repeatCustomers,
          newCount: newCustomers,
          avgOrdersPerCustomer: kpi.uniqueCustomers.value > 0
            ? Math.round((kpi.totalOrders.value / kpi.uniqueCustomers.value) * 10) / 10
            : 0,
          avgSpendPerCustomer: kpi.uniqueCustomers.value > 0
            ? Math.round((kpi.totalRevenue.value / kpi.uniqueCustomers.value) * 100) / 100
            : 0,
        },
        salesOverTime,
        statusDistribution: statusDist,
        productPerformance: productPerf,
        sizeAnalysis,
        colorAnalysis,
        governorateAnalysis,
        paymentBreakdown,
        topCustomers: topCustomers.slice(0, 50),
        detailedOrders,
        shippingStats: shippingStats[0] || null,
        alerts: {
          topSellers,
          lowSellers,
          topSizes,
          topColors,
          highCancelRate,
          topGovernoratesBySales: topGovs,
          highRejectionGovernorateS: highRejectGovs,
        }
      }
    });

  } catch (err) {
    console.error('[Analytics] getFullAdminAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};
