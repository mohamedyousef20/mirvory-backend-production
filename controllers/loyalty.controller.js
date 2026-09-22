import User from '../models/user.model.js';
import LoyaltyTransaction from '../models/loyaltyTransaction.model.js';
import createError from '../utils/error.js';

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

    res.status(200).json({
      success: true,
      loyalty: user.loyalty,
      tier: user.loyalty.tier,
      nextTier: getNextTier(user.loyalty.tier),
      pointsToNextTier: getPointsToNextTier(user.loyalty.tier, user.loyalty.totalEarned)
    });
  } catch (error) {
    next(error);
  }
};

// Get user loyalty transaction history
export const getUserLoyaltyTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type } = req.query;

    const filter = { user: req.user._id };
    if (type) {
      filter.type = type;
    }

    const transactions = await LoyaltyTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await LoyaltyTransaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    next(error);
  }
};

// Earn points from order completion (internal function, can be called from order controller)
export const earnPointsFromOrder = async (userId, orderId, orderAmount) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const pointsToEarn = Math.floor(orderAmount * POINTS_PER_EGP);
    if (pointsToEarn <= 0) return;

    const oldTier = user.loyalty.tier;
    const newTotalEarned = user.loyalty.totalEarned + pointsToEarn;
    const newTier = calculateTier(newTotalEarned);

    user.loyalty.points += pointsToEarn;
    user.loyalty.totalEarned = newTotalEarned;
    user.loyalty.tier = newTier;

    await user.save();

    // Create transaction record
    await LoyaltyTransaction.create({
      user: userId,
      type: 'earned',
      points: pointsToEarn,
      source: 'order_completion',
      referenceId: orderId,
      referenceModel: 'Order',
      description: `Points earned from order #${orderId}`,
      balanceAfter: user.loyalty.points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null
    });

    return { pointsEarned: pointsToEarn, tierUpgraded: newTier !== oldTier, newTier };
  } catch (error) {
    console.error('Error earning points:', error);
  }
};

// Redeem points (user)
export const redeemPoints = async (req, res, next) => {
  try {
    const { points, orderId } = req.body;

    if (!points || points <= 0) {
      throw createError('Invalid points amount', 400);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      throw createError('User not found', 404);
    }

    if (user.loyalty.points < points) {
      throw createError('Insufficient points balance', 400);
    }

    const oldTier = user.loyalty.tier;
    user.loyalty.points -= points;
    user.loyalty.totalRedeemed += points;
    const newTier = calculateTier(user.loyalty.totalEarned);
    user.loyalty.tier = newTier;

    await user.save();

    // Create transaction record
    await LoyaltyTransaction.create({
      user: req.user._id,
      type: 'redeemed',
      points: -points,
      source: 'redemption',
      referenceId: orderId || null,
      referenceModel: 'Order',
      description: `Points redeemed for discount`,
      balanceAfter: user.loyalty.points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null
    });

    res.status(200).json({
      success: true,
      message: 'Points redeemed successfully',
      pointsRedeemed: points,
      remainingPoints: user.loyalty.points,
      tier: user.loyalty.tier
    });
  } catch (error) {
    next(error);
  }
};

// Manual points adjustment (admin only)
export const adjustPoints = async (req, res, next) => {
  try {
    const { userId, points, notes } = req.body;

    if (!userId) {
      throw createError('User ID is required', 400);
    }

    if (!points || points === 0) {
      throw createError('Points amount is required', 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw createError('User not found', 404);
    }

    const oldTier = user.loyalty.tier;
    const isAddition = points > 0;

    if (isAddition) {
      user.loyalty.points += points;
      user.loyalty.totalEarned += points;
    } else {
      if (user.loyalty.points < Math.abs(points)) {
        throw createError('Insufficient points balance', 400);
      }
      user.loyalty.points += points; // points is negative
      user.loyalty.totalRedeemed += Math.abs(points);
    }

    const newTier = calculateTier(user.loyalty.totalEarned);
    user.loyalty.tier = newTier;

    await user.save();

    // Create transaction record
    await LoyaltyTransaction.create({
      user: userId,
      type: 'adjusted',
      points: points,
      source: 'manual_adjustment',
      description: notes || `Manual adjustment by admin`,
      balanceAfter: user.loyalty.points,
      tierBefore: oldTier,
      tierAfter: newTier !== oldTier ? newTier : null,
      adjustedBy: req.user._id,
      notes: notes
    });

    res.status(200).json({
      success: true,
      message: 'Points adjusted successfully',
      loyalty: user.loyalty
    });
  } catch (error) {
    next(error);
  }
};

// Get all users loyalty info (admin only)
export const getAllUsersLoyalty = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, tier, search } = req.query;

    console.log('Fetching loyalty users with params:', { page, limit, tier, search });

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

    const users = await User.find(filter)
      .select('firstName lastName email loyalty phone')
      .sort({ 'loyalty.totalEarned': -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    console.log('Found loyalty users:', users.length, 'total:', total);

    res.status(200).json({
      success: true,
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error in getAllUsersLoyalty:', error);
    next(error);
  }
};

// Get user loyalty transactions (admin only)
export const getUserTransactionsAdmin = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    const filter = { user: userId };
    if (type) {
      filter.type = type;
    }

    const transactions = await LoyaltyTransaction.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('adjustedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await LoyaltyTransaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total
      }
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
