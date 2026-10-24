// controllers/guestCart.controller.js
// Guest cart validation endpoint — validates product availability and returns current prices
// No auth required. Guest cart data lives in the browser's localStorage.

import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import ShippingSettings from '../models/shippingSettings.model.js';
import createError from '../utils/error.js';
import { findColor, findSizeEntry, getPrimaryImage } from '../utils/inventory.js';

/**
 * POST /api/guest-cart/validate
 * Body: { items: [{ productId, quantity, size?, color? }] }
 * Returns enriched items with current price, title, image, and stock status.
 * Used by the frontend to render the guest cart and before proceeding to checkout.
 */
export const validateGuestCart = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ success: true, items: [], subtotal: 0 });
    }

    if (items.length > 50) {
      return next(new createError('السلة تحتوي على عدد كبير جداً من المنتجات', 400));
    }

    // Validate all productIds
    const productIds = items.map((item) => {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        throw new createError(`معرّف منتج غير صالح: ${item.productId}`, 400);
      }
      return new mongoose.Types.ObjectId(item.productId);
    });

    const products = await Product.find({ _id: { $in: productIds } })
      .select('_id title titleEn colors price discountedPrice quantity status isApproved')
      .lean();

    const productMap = Object.fromEntries(products.map((p) => [p._id.toString(), p]));

    let subtotal = 0;
    const enrichedItems = items.map((item) => {
      const product = productMap[item.productId];

      if (!product) {
        return {
          productId: item.productId,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
          available: false,
          reason: 'المنتج غير موجود',
          title: '',
          titleEn: '',
          image: null,
          price: 0,
          maxQuantity: 0,
        };
      }

      const isAvailable = product.status === 'available' && product.isApproved;
      const effectivePrice = product.discountedPrice ?? product.price;

      // v5: stock, name and image belong to the selected COLOR + SIZE
      const color = item.color ? findColor(product, item.color) : null;
      const sizeEntry = color && item.size ? findSizeEntry(color, item.size) : null;
      const selectionValid = Boolean(color && color.available !== false && sizeEntry);
      const availableQty = selectionValid ? sizeEntry.quantity : 0;
      const requestedQty = Math.min(item.quantity, availableQty);

      if (isAvailable && selectionValid && requestedQty > 0) {
        subtotal += effectivePrice * requestedQty;
      }

      let reason = null;
      if (!isAvailable) reason = 'المنتج غير متاح';
      else if (!color || !item.size) reason = 'اختر اللون والمقاس';
      else if (!selectionValid) reason = 'اللون أو المقاس لم يعد متاحاً';
      else if (availableQty === 0) reason = 'نفد المخزون';

      return {
        productId: item.productId,
        quantity: item.quantity,
        adjustedQuantity: isAvailable && selectionValid ? requestedQty : 0,
        size: item.size || null,
        color: item.color || null,
        colorName: color?.name || null,
        available: isAvailable && selectionValid,
        inStock: availableQty > 0,
        reason,
        title: product.title,
        titleEn: product.titleEn || product.title,
        // The image of the selected color (falls back to the first color only if none is selected yet)
        image: color?.image || getPrimaryImage(product),
        price: effectivePrice,
        maxQuantity: availableQty,
      };
    });

    // Get shipping settings (basic calculation - full calculation at checkout)
    const shippingSettings = await ShippingSettings.getSettings();
    let shippingFee = shippingSettings.shippingFee;

    // Apply free shipping threshold
    if (shippingSettings.freeShippingEnabled && subtotal >= shippingSettings.freeShippingMinimum) {
      shippingFee = 0;
    }

    const total = subtotal + shippingFee;

    return res.status(200).json({
      success: true,
      items: enrichedItems,
      subtotal,
      shippingFee,
      total,
    });
  } catch (err) {
    next(err);
  }
};
