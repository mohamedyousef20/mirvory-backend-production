import mongoose from 'mongoose';
import UnavailableProductRequest from '../models/unavailableProductRequest.model.js';
import Product from '../models/product.model.js';
import createError from '../utils/error.js';
import {
  buildPaginationMeta,
  parsePageParams,
  withStableTiebreaker,
} from '../utils/pagination.js';

const STATUSES = ['pending', 'contacted', 'sourcing', 'available', 'completed', 'rejected'];

// The admin UI speaks "fulfilled"/"cancelled"; the stored vocabulary is
// "completed"/"rejected".
const STATUS_ALIASES = {
  fulfilled: 'completed',
  cancelled: 'rejected',
  canceled: 'rejected',
};

const normalizeStatus = (status) => STATUS_ALIASES[status] ?? status;

const trimmed = (value) => {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length ? next : null;
};

// Create unavailable product request (public - for both authenticated and guest users)
export const createRequest = async (req, res, next) => {
  try {
    const phone = trimmed(req.body?.phone);
    const size = trimmed(req.body?.size);
    const color = trimmed(req.body?.color);
    const notes = trimmed(req.body?.notes);
    const guestName = trimmed(req.body?.guestName) ?? trimmed(req.body?.customerName);
    const guestEmail = trimmed(req.body?.guestEmail);
    const productId = trimmed(req.body?.productId) ?? trimmed(req.body?.product);
    let productName = trimmed(req.body?.productName);
    const imageUrl = trimmed(req.body?.imageUrl);
    if (!phone) {
      throw new createError('Phone number is required', 400);
    }

    // Validate phone format
    if (!/^01[0125][0-9]{8}$/.test(phone)) {
      throw new createError('Invalid Egyptian phone number format', 400);
    }

    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      throw new createError('Invalid email address', 400);
    }

    const parsedQuantity = Number(req.body?.quantity ?? 1);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      throw new createError('Quantity must be a positive whole number', 400);
    }

    // A request must identify what the customer wants: a product reference, a
    // free-text product name, or a photo.
    if (!productId && !productName && !imageUrl) {
      throw new createError('Please provide a product, a product name, or an image', 400);
    }

    let product = null;
    if (productId) {
      if (!mongoose.isValidObjectId(productId)) {
        throw new createError('Invalid product id', 400);
      }
      // The product may since have been deleted — the request is still valid,
      // it just keeps the name snapshot instead of a dangling reference.
      const existing = await Product.findById(productId).select('title').lean();
      if (existing) {
        product = existing._id;
        productName = productName ?? existing.title ?? null;
      }
    }

    // Create request
    const requestData = {
      phone,
      size,
      color,
      notes,
      quantity: parsedQuantity,
      product,
      productName,
      imageUrl: imageUrl || null,
      user: req.user?._id || null,
      guestName: guestName || null,
      guestEmail: guestEmail || null,
      createdBy: req.user?._id || null
    };

    const request = await UnavailableProductRequest.create(requestData);

    // Populate user if exists
    if (request.user) {
      await request.populate('user', 'firstName lastName email');
    }

    res.status(201).json({
      success: true,
      message: 'Request created successfully',
      request
    });
  } catch (error) {
    next(error);
  }
};

// Get user's own requests (authenticated users only)
export const getUserRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 10);

    const filter = { user: req.user._id };
    if (status) {
      filter.status = normalizeStatus(status);
    }

    const [requests, total] = await Promise.all([
      UnavailableProductRequest.find(filter)
        .populate('product', 'title imageUrl status')
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      UnavailableProductRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      requests,
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Get all requests (admin only)
export const getAllRequests = async (req, res, next) => {
  try {
    const { status, search, dateFrom, dateTo } = req.query;
    const { page, limit, skip } = parsePageParams(req.query, 10);

    const filter = {};
    if (status) {
      filter.status = normalizeStatus(status);
    }

    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { phone: { $regex: escaped, $options: 'i' } },
        { guestName: { $regex: escaped, $options: 'i' } },
        { guestEmail: { $regex: escaped, $options: 'i' } },
        { productName: { $regex: escaped, $options: 'i' } }
      ];
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [requests, total, statusCounts] = await Promise.all([
      UnavailableProductRequest.find(filter)
        .populate('user', 'firstName lastName email')
        .populate('product', 'title imageUrl status')
        .populate('createdBy', 'firstName lastName')
        .sort(withStableTiebreaker({ createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .lean(),
      UnavailableProductRequest.countDocuments(filter),
      UnavailableProductRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = STATUSES.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    statusCounts.forEach(({ _id, count }) => {
      if (_id in counts) counts[_id] = count;
    });

    res.status(200).json({
      success: true,
      requests,
      stats: {
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
        ...counts,
        fulfilled: counts.completed,
        cancelled: counts.rejected,
      },
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Get single request by ID (admin only)
export const getRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new createError('Invalid request id', 400);
    }

    const request = await UnavailableProductRequest.findById(id)
      .populate('user', 'firstName lastName email phone')
      .populate('product', 'title imageUrl price status')
      .populate('createdBy', 'firstName lastName');

    if (!request) {
      throw createError('Request not found', 404);
    }

    res.status(200).json({
      success: true,
      request
    });
  } catch (error) {
    next(error);
  }
};

// Update request status (admin only)
export const updateRequestStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};
    const status = normalizeStatus(req.body?.status);

    if (!mongoose.isValidObjectId(id)) {
      throw new createError('Invalid request id', 400);
    }

    if (!STATUSES.includes(status)) {
      throw new createError('Invalid status', 400);
    }

    const request = await UnavailableProductRequest.findById(id);

    if (!request) {
      throw createError('Request not found', 404);
    }

    request.status = status;
    if (adminNotes !== undefined) {
      request.adminNotes = adminNotes;
    }

    await request.save();

    await request.populate('user', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Request status updated successfully',
      request
    });
  } catch (error) {
    next(error);
  }
};

// Delete request (admin only)
export const deleteRequest = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new createError('Invalid request id', 400);
    }

    const request = await UnavailableProductRequest.findById(id);

    if (!request) {
      throw createError('Request not found', 404);
    }


    await UnavailableProductRequest.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Request deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
