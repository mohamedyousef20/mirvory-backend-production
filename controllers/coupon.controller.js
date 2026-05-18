import Coupon from '../models/coupon.model.js'
import Cart from '../models/cart.model.js'

// 🧾 Get all coupons
export const getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find().sort('-createdAt');
        res.send(coupons);
    } catch (error) {
        res.status(500).send('Error retrieving coupons: ' + error.message);
    }
};

// 🔍 Get a single coupon
export const getCouponById = async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) return res.status(404).send('Coupon not found');
        res.send(coupon);
    } catch (error) {
        res.status(500).send('Error retrieving coupon: ' + error.message);
    }
};

// ➕ Create a new coupon
export const createCoupon = async (req, res) => {
    // const { error } = validateCoupon(req.body);
    // if (error) return res.status(400).send(error.details[0].message);
    console.log('im very smart')
    try {
        let coupon = await Coupon.findOne({ code: req.body.code.toUpperCase() });
        if (coupon) return res.status(400).send('Coupon code already exists');

        coupon = new Coupon({
            ...req.body,
            code: req.body.code.toUpperCase(),
        });

        await coupon.save();
        res.status(201).send(coupon);
    } catch (error) {
        res.status(500).send('Error creating coupon: ' + error.message);
    }
};

// ✏️ Update a coupon
export const updateCoupon = async (req, res) => {
    try {
        // 1. Verify coupon existence
        let coupon = await Coupon.findById(req.params.id);
        if (!coupon) return res.status(404).send('Coupon not found');

        // 2. Check for code uniqueness if the code is being changed
        if (req.body.code && req.body.code.toUpperCase() !== coupon.code) {
            const existingCoupon = await Coupon.findOne({ code: req.body.code.toUpperCase() });
            if (existingCoupon) return res.status(400).send('Coupon code already exists');
        }

        // 3. Map frontend keys to backend database schema keys explicitly
        const updateFields = {
            ...req.body,
            code: req.body.code ? req.body.code.toUpperCase() : coupon.code,

            // Explicit mapping to bridge the frontend vs backend name gap
            minCartValue: req.body.minPurchaseAmount !== undefined
                ? req.body.minPurchaseAmount
                : req.body.minCartValue,

            maxDiscount: req.body.maxDiscountAmount !== undefined
                ? req.body.maxDiscountAmount
                : req.body.maxDiscount,

            updatedAt: new Date(),
        };

        // 4. Update the document with schema validation enabled
        const updatedCoupon = await Coupon.findByIdAndUpdate(
            req.params.id,
            updateFields,
            {
                new: true,           // Return the updated document instead of the old one
                runValidators: true  // Enforce Mongoose schema validation constraints on update
            }
        );

        res.send(updatedCoupon);
    } catch (error) {
        console.error('Error updating coupon:', error);
        res.status(500).send('Error updating coupon: ' + error.message);
    }
};

// ❌ Delete a coupon
export const deleteCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndRemove(req.params.id);
        if (!coupon) return res.status(404).send('Coupon not found');
        res.send(coupon);
    } catch (error) {
        res.status(500).send('Error deleting coupon: ' + error.message);
    }
};

// 🛒 Remove coupon from cart and restore original total
export const removeCouponFromCart = async (req, res) => {
    try {
        console.log(req.user._id, 'ddddddddddddddddddddddddddddddddsssssssss')
        // Find user's cart
        const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        // Check if coupon is applied
        if (!cart.appliedCoupon) {
            return res.status(400).json({
                success: false,
                message: 'No coupon applied to cart'
            });
        }

        // Store removed coupon data for response
        const removedCoupon = {
            code: cart.appliedCoupon.code,
            discountAmount: cart.appliedCoupon.discountAmount,
            originalTotal: cart.appliedCoupon.originalTotal
        };

        // Calculate original subtotal from cart items
        const originalSubtotal = cart.items.reduce((total, item) => {
            return total + (item.product.price * item.quantity);
        }, 0);

        // Remove coupon from cart
        cart.appliedCoupon = undefined;

        // Restore original total
        cart.total = originalSubtotal;

        // Save updated cart
        await cart.save();

        // Send success response
        res.status(200).json({
            success: true,
            message: 'Coupon removed successfully',
            data: {
                cart: {
                    _id: cart._id,
                    items: cart.items,
                    subtotal: originalSubtotal,
                    total: originalSubtotal,
                    appliedCoupon: null
                },
                removedCoupon,
                originalTotal: originalSubtotal,
                message: 'Coupon removed and cart total restored'
            }
        });

    } catch (error) {
        console.error('Remove coupon from cart error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while removing coupon from cart: ' + error.message
        });
    }
};

// 🔍 Validate coupon code and apply to cart
export const validateCouponCode = async (req, res) => {
    try {
        const { code } = req.body;
        console.log('the valid coupon from frontend ')
        if (!code) {
            return res.status(400).send('Coupon code is required');
        }

        const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');

        if (!cart) {
            return res.status(400).send('Cart not found');
        }

        if (!cart.items || cart.items.length === 0) {
            return res.status(400).send('Cart is empty');
        }

        // Calculate cart total from the cart items
        const cartTotal = cart.items.reduce((total, item) => {
            return total + (item.product.price * item.quantity);
        }, 0);

        console.log(cartTotal, 'cartTotal')

        if (cartTotal <= 0) {
            return res.status(400).send('Invalid cart total');
        }

        // Find valid coupon
        const coupon = await Coupon.findOne({
            code,
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(400).send('Invalid or expired coupon code');
        }

        // Validate minimum cart value
        if (cartTotal < coupon.minCartValue) {
            return res.status(400).send(`Minimum cart value of ${coupon.minCartValue} required for this coupon`);
        }

        // Check usage limits
        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            return res.status(400).send('Coupon usage limit exceeded');
        }

        // Check if user has already used this coupon
        if (coupon.onePerUser) {
            const existingUsage = await Order.findOne({
                user: req.user._id,
                'coupon.code': coupon.code,
                status: { $in: ['confirmed', 'processing', 'completed'] }
            });
            if (existingUsage) {
                return res.status(400).send('You have already used this coupon');
            }
        }

        // Calculate discount
        let discountAmount = 0;

        if (coupon.discountType === 'percentage') {
            discountAmount = (cartTotal * coupon.discountValue) / 100;

            // Apply max discount limit
            if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
                discountAmount = coupon.maxDiscount;
            }
        } else if (coupon.discountType === 'fixed') {
            discountAmount = coupon.discountValue;
        }

        // Ensure discount doesn't exceed cart total
        discountAmount = Math.min(discountAmount, cartTotal);
        const discountedTotal = Math.max(0, cartTotal - discountAmount);

        // ✅ Update the cart total with the discounted amount
        cart.total = discountedTotal;

        // Store coupon in cart for later use during checkout
        cart.appliedCoupon = {
            code: coupon.code,
            discountAmount: discountAmount,
            discountedTotal: discountedTotal,
            originalTotal: cartTotal, // Store original for reference
            appliedAt: new Date()
        };

        await cart.save();
        console.log('Updated cart total after discount:', cart.total);
        console.log(cart.total, 'cart.total')
        // Prepare response
        const response = {
            valid: true,
            coupon: {
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
                minCartValue: coupon.minCartValue,
                maxDiscount: coupon.maxDiscount
            },
            originalTotal: parseFloat(cartTotal.toFixed(2)),
            discountedTotal: parseFloat(discountedTotal.toFixed(2)),
            discountAmount: parseFloat(discountAmount.toFixed(2)),
            message: `Coupon applied successfully! You saved $${discountAmount.toFixed(2)}`
        };

        res.send(response);

    } catch (error) {
        console.error('Coupon validation error:', error);
        res.status(500).send('Error validating coupon: ' + error.message);
    }
};