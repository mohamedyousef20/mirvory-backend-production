import mongoose from 'mongoose';
import User from '../models/user.model.js';
import LoyaltyTransaction from '../models/loyaltyTransaction.model.js';
import createError from '../utils/error.js';
import {
  buildPaginationMeta,
  parsePageParams,
  withStableTiebreaker,
} from '../utils/pagination.js';

const EMPTY_LOYALTY = {
  points: 0,
  tier: 'bronze',
  totalEarned: 0,
  totalRedeemed: 0,
};

const normalizeLoyalty = (loyalty) => ({ ...EMPTY_LOYALTY, ...(loyalty ? loyalty.toObject?.() ?? loyalty : {}) });

// Loyalty tier thresholds (points required)
const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 1000,
  gold: 5000,
  platinum: 10000
};

// Points earned per EGP spent
const POINTS_PER_EGP = 1;

// Calculate tier based on total earned points
const calculateTier = (totalEarned) => {
  if (totalEarned >= TIER_THRESHOLDS.platinum) return 'platinum';
  if (totalEarned >= TIER_THRESHOLDS.gold) return 'gold';
  if (totalEarned >= TIER_THRESHOLDS.silver) return 'silver';
  return 'bronze';
};

// Get user loyalty information (authenticated users only)
export const getUserLoyalty = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('loyalty firstName lastName email');

    if (!user) {
      throw createError('User not found', 404);
    }

    const loyalty = normalizeLoyalty(user.loyalty);

    res.status(200).json({
      success: true,
      loyalty,
      tier: loyalty.tier,
      nextTier: getNextTier(loyalty.tier),
      pointsToNextTier: getPointsToNextTier(loyalty.tier, loyalty.totalEarned)
    });
  } catch (error) {
    next(error);
  }
};

// Get user loyalty transaction history
export const getUserLoyaltyTransactions = async (req, res, next) => {
  try {
    const { type } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 20);

    const filter = { user: req.user._id };
    if (type) {
      filter.type = type;
    }

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find(filter)
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      transactions,
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Earn points from order completion (internal function, can be called from order controller)
export const earnPointsFromOrder = async (userId, orderId, orderAmount) => {
  try {
    const pointsToEarn = Math.floor(Number(orderAmount) * POINTS_PER_EGP);
    if (!Number.isFinite(pointsToEarn) || pointsToEarn <= 0) return;

    // An order may reach "delivered" more than once (status toggled back and
    // forth, retried webhook, …) — points must only ever be granted once.
    const alreadyAwarded = await LoyaltyTransaction.exists({
      user: userId,
      source: 'order_completion',
      referenceId: orderId,
    });
    if (alreadyAwarded) return;

    const before = await User.findById(userId).select('loyalty').lean();
    if (!before) return;

    const oldLoyalty = normalizeLoyalty(before.loyalty);
    const oldTier = oldLoyalty.tier;
    const newTier = calculateTier(oldLoyalty.totalEarned + pointsToEarn);

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { 'loyalty.points': pointsToEarn, 'loyalty.totalEarned': pointsToEarn },
        $set: { 'loyalty.tier': newTier },
      },
      { new: true, select: 'loyalty' }
    ).lean();

    const balanceAfter = normalizeLoyalty(user?.loyalty).points;

    try {
      await LoyaltyTransaction.create({
        user: userId,
        type: 'earned',
        points: pointsToEarn,
        source: 'order_completion',
        referenceId: orderId,
        referenceModel: 'Order',
        description: `Points earned from order #${orderId}`,
        balanceAfter,
        tierBefore: oldTier,
        tierAfter: newTier !== oldTier ? newTier : null
      });
    } catch (logError) {
      // Roll the balance back so the ledger and the balance cannot diverge.
      await User.findByIdAndUpdate(userId, {
        $inc: { 'loyalty.points': -pointsToEarn, 'loyalty.totalEarned': -pointsToEarn },
        $set: { 'loyalty.tier': oldTier },
      });
      throw logError;
    }

    return { pointsEarned: pointsToEarn, tierUpgraded: newTier !== oldTier, newTier };
  } catch (error) {
    console.error('Error earning points:', error);
  }
};

/**
 * Reverses the points granted for an order (cancellation / refund).
 */
export const revokePointsFromOrder = async (userId, orderId, reason = 'order_reverted') => {
  try {
    const earned = await LoyaltyTransaction.findOne({
      user: userId,
      source: 'order_completion',
      referenceId: orderId,
    }).lean();
    if (!earned) return;

    const alreadyReverted = await LoyaltyTransaction.exists({
      user: userId,
      source: 'manual_adjustment',
      referenceId: orderId,
      type: 'adjusted',
    });
    if (alreadyReverted) return;

    const before = await User.findById(userId).select('loyalty').lean();
    if (!before) return;

    const oldLoyalty = normalizeLoyalty(before.loyalty);
    const oldTier = oldLoyalty.tier;
    // Never push a balance negative: only take back what is still available.
    const pointsToRevoke = Math.min(earned.points, oldLoyalty.points);
    const newTotalEarned = Math.max(0, oldLoyalty.totalEarned - earned.points);
    const newTier = calculateTier(newTotalEarned);

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { 'loyalty.points': -pointsToRevoke, 'loyalty.totalEarned': -(oldLoyalty.totalEarned - newTotalEarned) },
        $set: { 'loyalty.tier': newTier },
      },
      { new: true, select: 'loyalty' }
    ).lean();

    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: -pointsToRevoke,
      source: 'manual_adjustment',
      referenceId: orderId,
      referenceModel: 'Order',
      description: `Points reverted for order #${orderId} (${reason})`,
      balanceAfter: normalizeLoyalty(user?.loyalty).points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null,
    });
  } catch (error) {
    console.error('Error revoking points:', error);
  }
};

// Redeem points (user)
export const redeemPoints = async (req, res, next) => {
  try {
    const points = Number(req.body?.points);
    const { orderId } = req.body || {};

    if (!Number.isInteger(points) || points <= 0) {
      throw createError('Invalid points amount', 400);
    }

    if (orderId && !mongoose.isValidObjectId(orderId)) {
      throw createError('Invalid order id', 400);
    }

    const before = await User.findById(req.user._id).select('loyalty').lean();
    if (!before) {
      throw createError('User not found', 404);
    }

    const oldTier = normalizeLoyalty(before.loyalty).tier;

    // Conditional update: two concurrent redemptions cannot both pass the
    // balance check, so the balance can never go negative.
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, 'loyalty.points': { $gte: points } },
      { $inc: { 'loyalty.points': -points, 'loyalty.totalRedeemed': points } },
      { new: true, select: 'loyalty' }
    ).lean();

    if (!user) {
      throw createError('Insufficient points balance', 400);
    }

    const loyalty = normalizeLoyalty(user.loyalty);
    const newTier = calculateTier(loyalty.totalEarned);
    if (newTier !== oldTier) {
      await User.findByIdAndUpdate(req.user._id, { $set: { 'loyalty.tier': newTier } });
    }

    // Create transaction record
    await LoyaltyTransaction.create({
      user: req.user._id,
      type: 'redeemed',
      points: -points,
      source: 'redemption',
      referenceId: orderId || null,
      referenceModel: 'Order',
      description: `Points redeemed for discount`,
      balanceAfter: loyalty.points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null
    });

    res.status(200).json({
      success: true,
      message: 'Points redeemed successfully',
      pointsRedeemed: points,
      remainingPoints: loyalty.points,
      tier: newTier
    });
  } catch (error) {
    next(error);
  }
};

// Manual points adjustment (admin only)
export const adjustPoints = async (req, res, next) => {
  try {
    const { userId, notes } = req.body || {};
    const points = Number(req.body?.points);

    if (!userId || !mongoose.isValidObjectId(userId)) {
      throw createError('User ID is required', 400);
    }

    if (!Number.isInteger(points) || points === 0) {
      throw createError('Points amount is required', 400);
    }

    const before = await User.findById(userId).select('loyalty').lean();
    if (!before) {
      throw createError('User not found', 404);
    }

    const oldTier = normalizeLoyalty(before.loyalty).tier;
    const isAddition = points > 0;

    const update = isAddition
      ? { $inc: { 'loyalty.points': points, 'loyalty.totalEarned': points } }
      : { $inc: { 'loyalty.points': points, 'loyalty.totalRedeemed': Math.abs(points) } };

    const guard = isAddition
      ? { _id: userId }
      : { _id: userId, 'loyalty.points': { $gte: Math.abs(points) } };

    const user = await User.findOneAndUpdate(guard, update, { new: true, select: 'loyalty' }).lean();

    if (!user) {
      throw createError('Insufficient points balance', 400);
    }

    const loyalty = normalizeLoyalty(user.loyalty);
    const newTier = calculateTier(loyalty.totalEarned);
    if (newTier !== oldTier) {
      await User.findByIdAndUpdate(userId, { $set: { 'loyalty.tier': newTier } });
      loyalty.tier = newTier;
    }

    // Create transaction record
    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: points,
      source: 'manual_adjustment',
      description: notes || `Manual adjustment by admin`,
      balanceAfter: loyalty.points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null,
      adjustedBy: req.user._id,
      notes: notes
    });

    res.status(200).json({
      success: true,
      message: 'Points adjusted successfully',
      loyalty
    });
  } catch (error) {
    next(error);
  }
};

// Get all users loyalty info (admin only)
export const getAllUsersLoyalty = async (req, res, next) => {
  try {
    const { tier, search } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 20);

    const filter = { role: 'user' };
    if (tier) {
      filter['loyalty.tier'] = tier;
    }

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('firstName lastName email loyalty phone createdAt updatedAt')
        .sort(withStableTiebreaker({ 'loyalty.totalEarned': -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      users: users.map((user) => ({ ...user, loyalty: normalizeLoyalty(user.loyalty) })),
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Aggregate loyalty figures for the admin dashboard (admin only)
export const getLoyaltyStats = async (req, res, next) => {
  try {
    const [userStats] = await User.aggregate([
      { $match: { role: 'user' } },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: { $sum: { $cond: [{ $gt: ['$loyalty.points', 0] }, 1, 0] } },
          totalPointsEarned: { $sum: { $ifNull: ['$loyalty.totalEarned', 0] } },
          totalPointsRedeemed: { $sum: { $ifNull: ['$loyalty.totalRedeemed', 0] } },
          totalPointsAvailable: { $sum: { $ifNull: ['$loyalty.points', 0] } },
        },
      },
    ]);

    const tierBreakdown = await User.aggregate([
      { $match: { role: 'user' } },
      { $group: { _id: { $ifNull: ['$loyalty.tier', 'bronze'] }, count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalUsers: userStats?.totalUsers ?? 0,
        activeUsers: userStats?.activeUsers ?? 0,
        totalPointsEarned: userStats?.totalPointsEarned ?? 0,
        totalPointsRedeemed: userStats?.totalPointsRedeemed ?? 0,
        totalPointsAvailable: userStats?.totalPointsAvailable ?? 0,
        tiers: tierBreakdown.reduce(
          (acc, { _id, count }) => ({ ...acc, [_id]: count }),
          { bronze: 0, silver: 0, gold: 0, platinum: 0 }
        ),
        thresholds: TIER_THRESHOLDS,
        pointsPerEgp: POINTS_PER_EGP,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get every loyalty transaction (admin only)
export const getAllTransactionsAdmin = async (req, res, next) => {
  try {
    const { type, source } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 20);

    const filter = {};
    if (type) filter.type = type;
    if (source) filter.source = source;

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find(filter)
        .populate('user', 'firstName lastName email phone')
        .populate('adjustedBy', 'firstName lastName')
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      transactions,
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Get user loyalty transactions (admin only)
export const getUserTransactionsAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { type } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 20);

    if (!mongoose.isValidObjectId(userId)) {
      throw createError('Invalid user id', 400);
    }

    const filter = { user: userId };
    if (type) {
      filter.type = type;
    }

    const [transactions, total] = await Promise.all([
      LoyaltyTransaction.find(filter)
        .populate('user', 'firstName lastName email')
        .populate('adjustedBy', 'firstName lastName')
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      LoyaltyTransaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      transactions,
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Helper functions
const getNextTier = (currentTier) => {
  const tiers = ['bronze', 'silver', 'gold', 'platinum'];
  const currentIndex = tiers.indexOf(currentTier);
  if (currentIndex < tiers.length - 1) {
    return tiers[currentIndex + 1];
  }
  return null;
};

const getPointsToNextTier = (currentTier, totalEarned) => {
  const nextTier = getNextTier(currentTier);
  if (!nextTier) return 0;
  return TIER_THRESHOLDS[nextTier] - totalEarned;
};
