import Offer from '../models/offer.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import createError from '../utils/error.js';
import mongoose from 'mongoose';
import { uploadImage, removeImage } from '../services/imageUploadService.js';
import {
  buildPaginationMeta,
  parsePageParams,
  withStableTiebreaker,
} from '../utils/pagination.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Create a new offer
export const createOffer = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const {
      title,
      description,
      type,
      value,
      minPurchaseAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      applicableProducts,
      applicableCategories,
      usageLimit
    } = req.body;

    // Validate dates
    if (new Date(startDate) >= new Date(endDate)) {
      throw new createError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 400);
    }

    // Validate value based on type
    if (type === 'percentage' && (value < 0 || value > 100)) {
      throw new createError('قيمة النسبة المئوية يجب أن تكون بين 0 و 100', 400);
    }

    // Handle image upload
    let imageUrl = '';
    let imagePublicId = '';
    if (req.file) {
      try {
        const uploadResult = await uploadImage(req.file);
        imageUrl = uploadResult.url;
        imagePublicId = uploadResult.publicId;
      } catch (error) {
        console.error('Image upload error:', error);
        throw createError('فشل في رفع الصورة', 500);
      }
    }

    const offer = new Offer({
      title,
      description,
      type,
      value,
      minPurchaseAmount: minPurchaseAmount || 0,
      maxDiscountAmount,
      startDate,
      endDate,
      applicableProducts: applicableProducts || [],
      applicableCategories: applicableCategories || [],
      usageLimit,
      image: imageUrl,
      imagePublicId,
      createdBy: req.user._id
    });

    await offer.save();

    res.status(201).json({ status: "success", message: 'تم إنشاء العرض بنجاح', data: offer });
  } catch (error) {
    next(error);
  }
};

// Get all offers (admin only)
export const getOffers = async (req, res, next) => {
  console.log('off1')
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const { page, limit, skip } = parsePageParams(req.query, 10);
    const { status, type } = req.query;

    const filter = {};
    if (status === 'active') {
      filter.isActive = true;
      filter.startDate = { $lte: new Date() };
      filter.endDate = { $gte: new Date() };
    } else if (status === 'expired') {
      filter.endDate = { $lt: new Date() };
    } else if (status === 'inactive') {
      filter.isActive = false;
    }

    if (type) {
      filter.type = type;
    }

    const offers = await Offer.find(filter)
      .populate('applicableProducts', 'title price images')
      .populate('applicableCategories', 'name')
      .populate('createdBy', 'firstName lastName')
      .sort(withStableTiebreaker({ createdAt: -1 }))
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Offer.countDocuments(filter);

    res.status(200).json({
      data: offers,
      pagination: buildPaginationMeta({ page, limit }, total),
    });
  } catch (error) {
    next(error);
  }
};

// Get active offers for users
export const getActiveOffers = async (req, res, next) => {
  try {
    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    })
      .populate('applicableProducts', 'title price images discountPercentage')
      .populate('applicableCategories', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(offers);
  } catch (error) {
    next(error);
  }
};

// Get offer by ID
export const getOfferById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw new createError("المعرف غير صالح", 400);

    const offer = await Offer.findById(id)
      .populate('applicableProducts', 'title price images')
      .populate('applicableCategories', 'name')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    if (!offer) throw new createError('العرض غير موجود', 404);

    // Check permissions - only admin can view inactive offers
    if (!offer.isActive && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError('غير مصرح لك بعرض هذا العرض', 403);
    }

    res.status(200).json(offer);
  } catch (error) {
    next(error);
  }
};

// Update offer
export const updateOffer = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const { id } = req.params;
    if (!isValidObjectId(id)) throw new createError("المعرف غير صالح", 400);

    const offer = await Offer.findById(id);
    if (!offer) throw new createError('العرض غير موجود', 404);

    const {
      title,
      description,
      type,
      value,
      minPurchaseAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      applicableProducts,
      applicableCategories,
      usageLimit,
      isActive,
      deleteImage
    } = req.body;

    // Validate dates if provided
    if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
      throw new createError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 400);
    }

    // Validate value based on type
    if (type === 'percentage' && value !== undefined && (value < 0 || value > 100)) {
      throw new createError('قيمة النسبة المئوية يجب أن تكون بين 0 و 100', 400);
    }

    // Handle image deletion
    if (deleteImage === 'true' && offer.imagePublicId) {
      try {
        await removeImage(offer.imagePublicId);
        console.log(`Deleted image from Cloudinary: ${offer.imagePublicId}`);
      } catch (error) {
        console.error(`Failed to delete image ${offer.imagePublicId}:`, error);
      }
      offer.image = '';
      offer.imagePublicId = '';
    }

    // Handle new image upload
    if (req.file) {
      // Delete old image if exists
      if (offer.imagePublicId) {
        try {
          await removeImage(offer.imagePublicId);
          console.log(`Deleted old image from Cloudinary: ${offer.imagePublicId}`);
        } catch (error) {
          console.error(`Failed to delete old image ${offer.imagePublicId}:`, error);
        }
      }
      try {
        const uploadResult = await uploadImage(req.file);
        offer.image = uploadResult.url;
        offer.imagePublicId = uploadResult.publicId;
      } catch (error) {
        console.error('Image upload error:', error);
        throw createError('فشل في رفع الصورة', 500);
      }
    }

    // Update fields
    if (title) offer.title = title;
    if (description) offer.description = description;
    if (type) offer.type = type;
    if (value !== undefined) offer.value = value;
    if (minPurchaseAmount !== undefined) offer.minPurchaseAmount = minPurchaseAmount;
    if (maxDiscountAmount !== undefined) offer.maxDiscountAmount = maxDiscountAmount;
    if (startDate) offer.startDate = startDate;
    if (endDate) offer.endDate = endDate;
    if (applicableProducts) offer.applicableProducts = applicableProducts;
    if (applicableCategories) offer.applicableCategories = applicableCategories;
    if (usageLimit !== undefined) offer.usageLimit = usageLimit;
    if (isActive !== undefined) offer.isActive = isActive;
    offer.updatedBy = req.user._id;

    await offer.save();

    res.status(200).json({ status: "success", message: 'تم تحديث العرض بنجاح', data: offer });
  } catch (error) {
    next(error);
  }
};

// Delete offer
export const deleteOffer = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const { id } = req.params;
    if (!isValidObjectId(id)) throw new createError("المعرف غير صالح", 400);

    const offer = await Offer.findByIdAndDelete(id);
    if (!offer) throw new createError('العرض غير موجود', 404);

    res.status(200).json({ success: true, message: 'تم حذف العرض بنجاح' });
  } catch (error) {
    next(error);
  }
};

// Toggle offer active status
export const toggleOfferStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("صلاحيات غير كافية", 403);
    }

    const { id } = req.params;
    if (!isValidObjectId(id)) throw new createError("المعرف غير صالح", 400);

    const offer = await Offer.findById(id);
    if (!offer) throw new createError('العرض غير موجود', 404);

    offer.isActive = !offer.isActive;
    offer.updatedBy = req.user._id;
    await offer.save();

    res.status(200).json({ 
      status: "success", 
      message: offer.isActive ? 'تم تفعيل العرض' : 'تم تعطيل العرض', 
      data: offer 
    });
  } catch (error) {
    next(error);
  }
};