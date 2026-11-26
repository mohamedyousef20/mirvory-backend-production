import mongoose from 'mongoose';
import Event from '../models/event.model.js';
import Order from '../models/order.model.js';
import Cart from '../models/cart.model.js';
import Product from '../models/product.model.js';
import ReturnRequest from '../models/returnRequest.model.js';

const TYPES = ['pageview', 'product_view', 'add_to_cart', 'checkout_start', 'purchase', 'search'];
const clip = (v, n) => String(v ?? '').slice(0, n);

// POST /api/behavior/track  (public, rate limited) body: { sid, type, path?, productId?, term?, results?, device?, ref?, utm?, isAuth? }
export const trackEvent = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sid || !TYPES.includes(b.type)) return res.status(204).end();
    const doc = {
      sid: clip(b.sid, 40), type: b.type, path: clip(b.path, 200),
      device: ['mobile', 'tablet', 'desktop'].includes(b.device) ? b.device : 'desktop',
      ref: clip(b.ref, 80), utm: clip(b.utm, 60), isAuth: Boolean(b.isAuth),
    };
    if (b.productId && mongoose.Types.ObjectId.isValid(b.productId)) doc.product = b.productId;
    if (b.type === 'search') { doc.term = clip(b.term, 80).trim().toLowerCase(); doc.results = Number.isFinite(+b.results) ? +b.results : null; }
    await Event.create(doc);
    return res.status(204).end();
  } catch {
    return res.status(204).end(); // tracking must never break the site
  }
};

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// GET /api/behavior/admin?days=30   (admin only)
export const getBehaviorAnalytics = async (req, res) => {
  try {
    const days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
    const since = new Date(Date.now() - days * 864e5);
    const evMatch = { createdAt: { $gte: since } };

    // ── Funnel: distinct sessions per step, split by device ──
    const stepRows = await Event.aggregate([
      { $match: evMatch },
      { $group: { _id: { type: '$type', device: '$device' }, sids: { $addToSet: '$sid' } } },
      { $project: { type: '$_id.type', device: '$_id.device', n: { $size: '$sids' } } },
    ]);
    const allSessions = await Event.aggregate([{ $match: evMatch }, { $group: { _id: '$sid' } }, { $count: 'n' }]);
    const stepTotals = await Event.aggregate([
      { $match: evMatch },
      { $group: { _id: '$type', sids: { $addToSet: '$sid' } } },
      { $project: { n: { $size: '$sids' } } },
    ]);
    const tot = Object.fromEntries(stepTotals.map((r) => [r._id, r.n]));
    const sessions = allSessions[0]?.n || 0;
    const steps = [
      { key: 'sessions', label: 'زيارات (جلسات)', n: sessions },
      { key: 'product_view', label: 'شاهد منتج', n: tot.product_view || 0 },
      { key: 'add_to_cart', label: 'أضاف للسلة', n: tot.add_to_cart || 0 },
      { key: 'checkout_start', label: 'بدأ الشراء', n: tot.checkout_start || 0 },
      { key: 'purchase', label: 'أكمل الطلب', n: tot.purchase || 0 },
    ].map((s, i, a) => ({ ...s, ofPrev: i ? pct(s.n, a[i - 1].n) : 100, ofVisits: pct(s.n, sessions) }));
    const byDevice = {};
    for (const r of stepRows) { (byDevice[r.device] ||= {})[r.type] = r.n; }

    // ── Search terms ──
    const search = await Event.aggregate([
      { $match: { ...evMatch, type: 'search', term: { $ne: '' } } },
      { $group: { _id: '$term', count: { $sum: 1 }, avgResults: { $avg: '$results' }, zero: { $sum: { $cond: [{ $eq: ['$results', 0] }, 1, 0] } } } },
      { $sort: { count: -1 } }, { $limit: 40 },
    ]);
    const topTerms = search.map((s) => ({ term: s._id, count: s.count, avgResults: Math.round((s.avgResults || 0) * 10) / 10 }));
    const zeroTerms = search.filter((s) => s.zero > 0).sort((a, b) => b.zero - a.zero).slice(0, 15).map((s) => ({ term: s._id, count: s.zero }));

    // ── Sources ──
    const sources = await Event.aggregate([
      { $match: { ...evMatch, type: 'pageview' } },
      { $group: { _id: { $cond: [{ $ne: ['$utm', ''] }, { $concat: ['utm:', '$utm'] }, { $cond: [{ $ne: ['$ref', ''] }, '$ref', 'مباشر'] }] }, sids: { $addToSet: '$sid' } } },
      { $project: { n: { $size: '$sids' } } }, { $sort: { n: -1 } }, { $limit: 12 },
    ]);

    // ── Products: views vs add to cart vs sold in period ──
    const pev = await Event.aggregate([
      { $match: { ...evMatch, product: { $ne: null }, type: { $in: ['product_view', 'add_to_cart'] } } },
      { $group: { _id: '$product', views: { $sum: { $cond: [{ $eq: ['$type', 'product_view'] }, 1, 0] } }, carts: { $sum: { $cond: [{ $eq: ['$type', 'add_to_cart'] }, 1, 0] } } } },
    ]);
    const sold = await Order.aggregate([
      { $match: { createdAt: { $gte: since }, deliveryStatus: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', qty: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
    ]);
    const rets = await ReturnRequest.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$product', count: { $sum: 1 } } },
    ]);
    const ids = new Set([...pev, ...sold, ...rets].map((r) => String(r._id)));
    const prodDocs = await Product.find({ _id: { $in: [...ids] } }).select('title').lean();
    const title = Object.fromEntries(prodDocs.map((p) => [String(p._id), p.title]));
    const m = {};
    const row = (id) => (m[id] ||= { id, title: title[id] || '—', views: 0, carts: 0, qty: 0, revenue: 0, returns: 0 });
    pev.forEach((r) => Object.assign(row(String(r._id)), { views: r.views, carts: r.carts }));
    sold.forEach((r) => Object.assign(row(String(r._id)), { qty: r.qty, revenue: r.revenue }));
    rets.forEach((r) => (row(String(r._id)).returns = r.count));
    const products = Object.values(m).map((p) => ({ ...p, cartRate: pct(p.carts, p.views), buyRate: pct(p.qty, p.views), returnRate: pct(p.returns, p.qty) }));
    const productLists = {
      mostViewed: [...products].sort((a, b) => b.views - a.views).slice(0, 10),
      viewedNotBought: products.filter((p) => p.views >= 5 && p.qty === 0).sort((a, b) => b.views - a.views).slice(0, 10),
      highReturn: products.filter((p) => p.returns > 0).sort((a, b) => b.returnRate - a.returnRate || b.returns - a.returns).slice(0, 10),
    };

    // ── Returns by reason ──
    const reasons = await ReturnRequest.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { reason: '$reason', type: '$type' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 12 },
    ]);

    // ── Abandoned carts (logged-in): cart has items, untouched 24h+, no order since ──
    const cutoff = new Date(Date.now() - 24 * 36e5);
    const carts = await Cart.find({ 'items.0': { $exists: true }, updatedAt: { $gte: since, $lte: cutoff } })
      .sort({ updatedAt: -1 }).limit(200).populate('user', 'firstName lastName phone').populate('items.product', 'title').lean();
    const ordered = await Order.aggregate([
      { $match: { createdAt: { $gte: since }, buyer: { $in: carts.map((c) => c.user?._id).filter(Boolean) } } },
      { $group: { _id: '$buyer', last: { $max: '$createdAt' } } },
    ]);
    const lastOrder = Object.fromEntries(ordered.map((o) => [String(o._id), o.last]));
    const abandoned = carts.filter((c) => c.user && !(lastOrder[String(c.user._id)] > c.updatedAt));
    const abandonedValue = abandoned.reduce((s, c) => s + (c.total || c.items.reduce((a, i) => a + i.price * i.quantity, 0)), 0);
    const abandonedList = abandoned.slice(0, 30).map((c) => ({
      name: `${c.user.firstName || ''} ${c.user.lastName || ''}`.trim(), phone: c.user.phone || '',
      value: c.total || c.items.reduce((a, i) => a + i.price * i.quantity, 0),
      items: c.items.map((i) => i.product?.title).filter(Boolean).slice(0, 3), updatedAt: c.updatedAt,
    }));

    // ── Customers: new vs repeat, guest vs registered AOV, days between orders ──
    const ord = await Order.aggregate([
      { $match: { createdAt: { $gte: since }, deliveryStatus: { $ne: 'cancelled' } } },
      { $group: { _id: '$isGuest', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
    ]);
    const seg = (g) => { const r = ord.find((o) => Boolean(o._id) === g); return r ? { orders: r.orders, aov: Math.round(r.revenue / r.orders) } : { orders: 0, aov: 0 }; };
    const buyers = await Order.aggregate([
      { $match: { isGuest: { $ne: true }, deliveryStatus: { $ne: 'cancelled' } } },
      { $group: { _id: '$buyer', n: { $sum: 1 }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
    ]);
    const repeat = buyers.filter((b) => b.n >= 2);
    const avgGapDays = repeat.length ? Math.round(repeat.reduce((s, b) => s + (b.last - b.first) / 864e5 / (b.n - 1), 0) / repeat.length) : null;

    return res.json({
      success: true,
      data: {
        days, funnel: steps, byDevice, search: { top: topTerms, zero: zeroTerms }, sources: sources.map((s) => ({ source: s._id, sessions: s.n })),
        products: productLists, returnReasons: reasons.map((r) => ({ reason: r._id.reason, type: r._id.type, count: r.count })),
        abandonedCarts: { count: abandoned.length, value: Math.round(abandonedValue), list: abandonedList },
        customers: { guest: seg(true), registered: seg(false), registeredBuyers: buyers.length, repeatBuyers: repeat.length, repeatRate: pct(repeat.length, buyers.length), avgDaysBetweenOrders: avgGapDays },
        tracking: { events: await Event.estimatedDocumentCount() },
      },
    });
  } catch (err) {
    console.error('[Behavior] error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
