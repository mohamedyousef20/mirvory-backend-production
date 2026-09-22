import UnavailableProductRequest from '../models/unavailableProductRequest.model.js';
import { uploadImage, removeImage } from '../services/imageUploadService.js';
import createError from '../utils/error.js';

// Create unavailable product request (public - for both authenticated and guest users)
export const createRequest = async (req, res, next) => {
  try {
    const { phone, size, guestName, guestEmail } = req.body;
    const file = req.file;

    // Validation
    if (!file) {
      throw createError('Image is required', 400);
    }

    if (!phone) {
      throw createError('Phone number is required', 400);
    }

    if (!size) {
      throw createError('Size is required', 400);
    }

    // Validate phone format
    if (!/^01[0125][0-9]{8}$/.test(phone)) {
      throw createError('Invalid Egyptian phone number format', 400);
    }

    // Upload image to Cloudinary
    let uploadResult;
    try {
      uploadResult = await uploadImage(file);
    } catch (error) {
      console.error('Image upload error:', error);
      throw createError('Failed to upload image', 500);
    }

    // Create request
    const requestData = {
      phone,
      size,
      image: uploadResult.url,
      imagePublicId: uploadResult.publicId,
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
    const { page = 1, limit = 10, status } = req.query;

    const filter = { user: req.user._id };
    if (status) {
      filter.status = status;
    }

    const requests = await UnavailableProductRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await UnavailableProductRequest.countDocuments(filter);

    res.status(200).json({
      success: true,
      requests,
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

// Get all requests (admin only)
export const getAllRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { phone: { $regex: search, $options: 'i' } },
        { guestName: { $regex: search, $options: 'i' } },
        { guestEmail: { $regex: search, $options: 'i' } }
      ];
    }

    const requests = await UnavailableProductRequest.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await UnavailableProductRequest.countDocuments(filter);

    res.status(200).json({
      success: true,
      requests,
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

// Get single request by ID (admin only)
export const getRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const request = await UnavailableProductRequest.findById(id)
      .populate('user', 'firstName lastName email phone')
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
    const { status, adminNotes } = req.body;

    const validStatuses = ['pending', 'contacted', 'sourcing', 'available', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw createError('Invalid status', 400);
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

    const request = await UnavailableProductRequest.findById(id);

    if (!request) {
      throw createError('Request not found', 404);
    }

    // Delete image from Cloudinary
    if (request.imagePublicId) {
      try {
        await removeImage(request.imagePublicId);
        console.log(`Deleted image from Cloudinary: ${request.imagePublicId}`);
      } catch (error) {
        console.error(`Failed to delete image ${request.imagePublicId}:`, error);
        // Continue with deletion even if Cloudinary delete fails
      }
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
