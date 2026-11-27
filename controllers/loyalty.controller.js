import mongoose from 'mongoose';
import User from '../models/user.model.js';
import LoyaltyTransaction from '../models/loyaltyTransaction.model.js';
import createError from '../utils/error.js';
import { pointsForAmount, loyaltyRules, EGP_PER_EARNED_POINT } from '../utils/loyaltyMath.js';
import {
  buildPaginationMeta,
  parsePageParams,
  withStableTiebreaker,
} from '../utils/pagination.js';

const EMPTY_LOYALTY = {
  points: 0,
  totalEarned: 0,
  totalRedeemed: 0,
};

const normalizeLoyalty = (loyalty) => ({ ...EMPTY_LOYALTY, ...(loyalty ? loyalty.toObject?.() ?? loyalty : {}) });


// Get user loyalty information (authenticated users only)
export const getUserLoyalty = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('loyalty firstName lastName email');

    if (!user) {
      throw new createError('User not found', 404);
    }

    const loyalty = normalizeLoyalty(user.loyalty);

    // Points-only system: the legacy `tier` field is intentionally not returned.
    const { tier, ...pointsOnly } = loyalty;
    res.status(200).json({ success: true, loyalty: pointsOnly });
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
    const pointsToEarn = pointsForAmount(orderAmount);
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

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'loyalty.points': pointsToEarn, 'loyalty.totalEarned': pointsToEarn } },
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
      });
    } catch (logError) {
      // Roll the balance back so the ledger and the balance cannot diverge.
      await User.findByIdAndUpdate(userId, {
        $inc: { 'loyalty.points': -pointsToEarn, 'loyalty.totalEarned': -pointsToEarn },
      });
      throw logError;
    }

    return { pointsEarned: pointsToEarn };
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

    const current = normalizeLoyalty(before.loyalty);
    // Never push a balance negative: only take back what is still available.
    const pointsToRevoke = Math.min(earned.points, current.points);
    const earnedToRemove = Math.min(earned.points, current.totalEarned);
    if (pointsToRevoke <= 0 && earnedToRemove <= 0) return;

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'loyalty.points': -pointsToRevoke, 'loyalty.totalEarned': -earnedToRemove } },
      { new: true, select: 'loyalty' }
    ).lean();

    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: -pointsToRevoke,
      source: 'manual_adjustment',
      referenceId: orderId,
      referenceModel: 'Order',
      description: `Points reversed for order #${orderId} (${reason})`,
      balanceAfter: normalizeLoyalty(user?.loyalty).points,
    });
  } catch (error) {
    console.error('Error revoking points:', error);
  }
};

/**
 * Takes back the points earned on a returned item when an admin approves a return request.
 * Partial: only the points that belong to the returned item (1 point per 5 EGP of its value).
 * Idempotent per return request. Never goes below zero and never takes more than the order earned.
 */
export const revokePointsForReturn = async (userId, orderId, returnId, itemAmountEgp) => {
  try {
    const earned = await LoyaltyTransaction.findOne({ user: userId, source: 'order_completion', referenceId: orderId }).lean();
    if (!earned) return; // points were never granted (order not delivered, guest, or too small)

    const done = await LoyaltyTransaction.exists({ user: userId, source: 'manual_adjustment', referenceId: returnId, type: 'adjusted' });
    if (done) return;

    const wanted = Math.min(pointsForAmount(itemAmountEgp), earned.points);
    if (wanted <= 0) return;

    const before = await User.findById(userId).select('loyalty').lean();
    if (!before) return;
    const current = normalizeLoyalty(before.loyalty);
    const pointsToRevoke = Math.min(wanted, current.points);
    const earnedToRemove = Math.min(wanted, current.totalEarned);
    if (pointsToRevoke <= 0 && earnedToRemove <= 0) return;

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'loyalty.points': -pointsToRevoke, 'loyalty.totalEarned': -earnedToRemove } },
      { new: true, select: 'loyalty' }
    ).lean();

    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: -pointsToRevoke,
      source: 'manual_adjustment',
      referenceId: returnId,
      referenceModel: 'ReturnRequest',
      description: `Points reversed for approved return ${returnId} (order #${orderId})`,
      balanceAfter: normalizeLoyalty(user?.loyalty).points,
    });
  } catch (error) {
    console.error('Error revoking points for return:', error);
  }
};

// Public loyalty rules (read-only constants, used by the checkout UI for previews).
export const getLoyaltyRules = (req, res) => {
  res.status(200).json({ success: true, rules: loyaltyRules() });
};

// Legacy standalone redeem endpoint: points are now redeemed only at checkout
// (createOrder, field `redeemPoints`), where the discount is applied server-side.
// Burning points without a discount would only cost customers, so it is closed.
export const redeemPoints = async (req, res, next) => {
  next(new createError('Points are redeemed at checkout', 410));
};

/** Refund redeemed points when an order is cancelled before delivery (idempotent). */
export const refundRedeemedPointsForOrder = async (userId, orderId) => {
  try {
    const redeemed = await LoyaltyTransaction.findOne({
      user: userId, source: 'redemption', type: 'redeemed', referenceId: orderId,
    }).lean();
    if (!redeemed) return;
    const refunded = await LoyaltyTransaction.exists({
      user: userId, source: 'redemption', type: 'adjusted', referenceId: orderId,
    });
    if (refunded) return;
    const pts = Math.abs(redeemed.points);
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'loyalty.points': pts, 'loyalty.totalRedeemed': -pts } },
      { new: true, select: 'loyalty' }
    ).lean();
    await LoyaltyTransaction.create({
      user: userId, type: 'adjusted', points: pts, source: 'redemption',
      referenceId: orderId, referenceModel: 'Order',
      description: `Points refunded: order #${orderId} cancelled`,
      balanceAfter: normalizeLoyalty(user?.loyalty).points,
    });
  } catch (error) {
    console.error('Error refunding redeemed points:', error);
  }
};

// Manual points adjustment (admin only)
export const adjustPoints = async (req, res, next) => {
  try {
    const { userId, notes } = req.body || {};
    const points = Number(req.body?.points);

    if (!userId || !mongoose.isValidObjectId(userId)) {
      throw new createError('User ID is required', 400);
    }

    if (!Number.isInteger(points) || points === 0) {
      throw new createError('Points amount is required', 400);
    }

    const before = await User.findById(userId).select('loyalty').lean();
    if (!before) {
      throw new createError('User not found', 404);
    }

    const isAddition = points > 0;

    const update = isAddition
      ? { $inc: { 'loyalty.points': points, 'loyalty.totalEarned': points } }
      : { $inc: { 'loyalty.points': points, 'loyalty.totalRedeemed': Math.abs(points) } };

    const guard = isAddition
      ? { _id: userId }
      : { _id: userId, 'loyalty.points': { $gte: Math.abs(points) } };

    const user = await User.findOneAndUpdate(guard, update, { new: true, select: 'loyalty' }).lean();

    if (!user) {
      throw new createError('Insufficient points balance', 400);
    }

    const loyalty = normalizeLoyalty(user.loyalty);
    // Create transaction record
    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: points,
      source: 'manual_adjustment',
      description: notes || `Manual adjustment by admin`,
      balanceAfter: loyalty.points,
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
    const { search } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 20);

    const filter = { role: 'user' };
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

    res.status(200).json({
      success: true,
      stats: {
        totalUsers: userStats?.totalUsers ?? 0,
        activeUsers: userStats?.activeUsers ?? 0,
        totalPointsEarned: userStats?.totalPointsEarned ?? 0,
        totalPointsRedeemed: userStats?.totalPointsRedeemed ?? 0,
        totalPointsAvailable: userStats?.totalPointsAvailable ?? 0,
        pointsPerEgp: 1 / EGP_PER_EARNED_POINT,
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
      throw new createError('Invalid user id', 400);
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

