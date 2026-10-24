import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';
import { createNotifications } from '../utils/notification.js';
import createError from '../utils/error.js';
import { formatPaginationResponse } from '../middlewares/pagination.js';
import { withStableTiebreaker } from '../utils/pagination.js';
import cloudinary from '../config/cloudinary.js';
import { normalizeColors, toClientProduct } from '../utils/inventory.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// 📦 PRODUCT CRUD & MANAGEMENT
// ==========================================
export const createProduct = async (req, res, next) => {
  console.log('>>start')
  try {
    const productData = req.body.data || req.body;

    if (!productData.title || !productData.description || !productData.price || !productData.category) {
      throw new createError("جميع الحقول الأساسية (الاسم، الوصف، السعر، القسم) مطلوبة", 400);
    }
    if (!isValidObjectId(productData.category)) throw new createError("القسم المحدد غير صالح", 400);

    // v5: images, sizes and stock live inside each color. Global images[]/sizes[] are not accepted anymore.
    const colors = normalizeColors(productData.colors);

    const price = parseFloat(productData.price);
    const discountPercentage = parseFloat(productData.discountPercentage) || 0;
    const discountAmount = price * (discountPercentage / 100);
    const discountedPrice = price - discountAmount;

    let multiplier = 0.90;
    if (!discountedPrice || discountedPrice <= 0) {
      multiplier = 0.90;
    } else if (discountedPrice < 300) {
      multiplier = 0.82;
    } else if (discountedPrice >= 300 && discountedPrice <= 799) {
      multiplier = 0.85;
    } else if (discountedPrice >= 800 && discountedPrice <= 1999) {
      multiplier = 0.88;
    }

    const sellerPercentage = discountedPrice * multiplier;
    const videoUrl =
      typeof productData.videoUrl === 'string'
        ? productData.videoUrl.trim()
        : '';

    if (videoUrl) {
      try {
        const parsedUrl = new URL(videoUrl);

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch {
        throw new createError('رابط الفيديو غير صالح', 400);
      }
    }

    const product = await Product.create({
      seller: req.user._id,
      title: productData.title,
      description: productData.description,
      videoUrl,
      colors,
      price,
      discountPercentage,
      discountedPrice,
      category: productData.category,
      status: 'pending',
      isApproved: false,
      sellerPercentage,
      isFeatured:
        productData.isFeatured === 'true' ||
        productData.isFeatured === true,
      // `quantity` is derived from colors[].sizes[].quantity by the model's pre-save hook
    });


    await product.populate('category', 'name nameEn');
    await product.populate('seller', 'firstName lastName email');

    // 🔔 NOTIFICATION: Product Submitted for Review
    (async () => {
      try {
        const io = req.app.get("io");
        const admin = await User.findOne({ role: 'admin' }).select('_id');

        await createNotifications({
          io, title: '📦 منتج جديد للمراجعة',
          message: `تم إضافة منتج جديد "${product.title}" بواسطة ${product.seller.firstName}`,
          type: 'PRODUCT_SUBMITTED',
          actor: req.user._id,
          userId: admin._id.toString(),
          data: { productId: product._id }, link: `/products/${product._id}`,
        });

      } catch (err) { console.error("Notification Error:", err); }
    })();

    res.status(201).json({ success: true, message: 'تم إضافة المنتج وهو قيد المراجعة', product: toClientProduct(product) });
  } catch (error) {
    if (error.code === 11000) return next(new createError("يوجد منتج مشابه بالفعل", 400));
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const productId = req.params.id
    if (!isValidObjectId(productId)) throw new createError("معرف المنتج غير صالح", 400);

    const product = await Product.findById(productId);

    if (!product) throw new createError("المنتج غير موجود", 404);

    // Check authorization: admin can edit any product, seller can only edit their own
    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      throw new createError("غير مصرح لك بتحديث هذا المنتج", 403);
    }

    const updates = req.body;

    // Parse JSON fields if they come as strings (FormData)
    const parsedUpdates = { ...updates };
    ['colors', 'deletedColorImages'].forEach(field => {
      if (parsedUpdates[field] && typeof parsedUpdates[field] === 'string') {
        try { parsedUpdates[field] = JSON.parse(parsedUpdates[field]); } catch (e) { /* validated below */ }
      }
    });

    // v5: colors carry their own image + sizes + stock. Replacing `colors` replaces all of them,
    // so the form must send every color it wants to keep (with its sizes).
    if (parsedUpdates.colors !== undefined) {
      const newColors = normalizeColors(parsedUpdates.colors);

      // Delete from Cloudinary only the color images that are no longer used by any color
      const stillUsed = new Set(newColors.map(c => c.image));
      const orphaned = (product.colors || []).map(c => c.image).filter(img => img && !stillUsed.has(img));
      const requestedDeletes = Array.isArray(parsedUpdates.deletedColorImages) ? parsedUpdates.deletedColorImages : [];
      const toDelete = [...new Set([...orphaned, ...requestedDeletes.filter(img => !stillUsed.has(img))])];

      for (const imageUrl of toDelete) {
        try {
          const fileName = imageUrl.split('/').pop();
          const publicId = fileName.split('.')[0];
          await cloudinary.uploader.destroy(`mirvory/${publicId}`);
        } catch (error) {
          console.error(`Failed to delete color image ${imageUrl}:`, error);
        }
      }

      product.colors = newColors;
      product.needsStockReview = false; // the seller/admin just entered real per-size stock
    }

    // Update price and discount
    if (parsedUpdates.price !== undefined || parsedUpdates.discountPercentage !== undefined) {
      const price = parsedUpdates.price !== undefined ? parseFloat(parsedUpdates.price) : product.price;
      const discountPercentage = parsedUpdates.discountPercentage !== undefined ? parseFloat(parsedUpdates.discountPercentage) : product.discountPercentage;
      product.price = price;
      product.discountPercentage = discountPercentage;
      product.discountedPrice = price - (price * (discountPercentage / 100));
    }

    // Update other fields
    const allowedUpdates = ['title', 'description', 'category', 'isFeatured', 'sellerPercentage', 'brand', 'tags', 'isTrusted'];
    allowedUpdates.forEach(key => {
      if (parsedUpdates[key] !== undefined) {
        if (key === 'sellerPercentage') product[key] = parseFloat(parsedUpdates[key]);
        else if (key === 'isFeatured' || key === 'isTrusted') product[key] = (parsedUpdates[key] === 'true' || parsedUpdates[key] === true);
        else if (key === 'tags' && typeof parsedUpdates[key] === 'string') product[key] = parsedUpdates[key].split(',').map(t => t.trim());
        else product[key] = parsedUpdates[key];
      }
    });

    // Set reapproval status for non-admin updates
    const requiresReapproval = req.user.role !== 'admin' && req.user.role !== 'super_admin';
    if (requiresReapproval) {
      product.isApproved = false;
      product.status = 'pending';
    }

    const updatedProduct = await product.save();
    await updatedProduct.populate('category', 'name nameEn');
    await updatedProduct.populate('seller', 'firstName lastName email');

    // 🔔 NOTIFICATION: Product Updated Pending Review
    if (requiresReapproval) {
      (async () => {
        try {
          const io = req.app.get("io");
          const admin = await User.findOne({ role: 'admin' }).select('_id');
          await createNotifications({
            io, title: '📦 تحديث منتج للمراجعة',
            message: `تم تعديل منتج "${updatedProduct.title}" ويحتاج إلى مراجعة جديدة`,
            type: 'PRODUCT_UPDATED', actor: req.user._id,
            userId: admin._id.toString(),
            data: { productId: updatedProduct._id }, link: `/admin/products/${updatedProduct._id}`,
          });

        } catch (err) { console.error(err); }
      })();
    }

    res.status(200).json({ success: true, message: 'تم تحديث المنتج بنجاح', product: toClientProduct(updatedProduct) });
  } catch (error) { next(error); }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.body;
    if (!isValidObjectId(id)) throw new createError("معرف المنتج غير صالح", 400);

    const product = await Product.findById(id);
    if (!product) throw new createError("المنتج غير موجود", 404);

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      throw new createError("غير مصرح لك بحذف هذا المنتج", 403);
    }

    // 🚨 الحل المعماري الصارم: الحذف المنطقي Soft Delete لحماية استقرار قواعد البيانات المالية
    product.status = 'deleted';
    product.isApproved = false;
    await product.save();

    res.status(200).json({ success: true, message: 'تم إيقاف وحذف المنتج منطقياً لضمان سلامة الفواتير المرتبطة' });
  } catch (error) { next(error); }
};

// ==========================================
// 🛡 ADMIN APPROVALS
// ==========================================
export const approveProduct = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw new createError("مرفوض. للإدارة فقط.", 403);

    const id = req.params.id || req.body.id;
    if (!isValidObjectId(id)) throw new createError("معرف المنتج غير صالح", 400);

    const product = await Product.findByIdAndUpdate(
      id, { isApproved: true, status: "available", reason: null }, { new: true }
    ).populate("category", "name nameEn").populate("seller", "_id firstName lastName");

    if (!product) throw new createError("المنتج غير موجود", 404);

    (async () => {
      try {
        // ⚠️ تأكد من جلب الـ io في أول الدالة
        const io = req.app.get("io");

        // عدل استدعاء الدالة المساعدة ليكون هكذا:
        await createNotifications({
          io,
          title: "تم قبول منتجك",
          message: `تمت الموافقة على المنتج "${product.title}" وهو معروض الآن للبيع.`,
          type: "PRODUCT_APPROVED",
          actor: req.user._id,             // المعرف بتاع الإدمن اللي وافق
          userId: product.seller._id.toString(),
          data: { productId: product._id },
          link: `/vendor/dashbord`         // الرابط اللي التاجر هيروح عليه لما يضغط
        });
      } catch (err) { console.error(err); }
    })();

    res.status(200).json({ success: true, message: "تمت الموافقة على المنتج بنجاح", product });
  } catch (error) { next(error); }
};



export const rejectProduct = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw new createError("مرفوض. للإدارة فقط.", 403);

    const { id, reason } = req.body;
    if (!isValidObjectId(id)) throw new createError("معرف المنتج غير صالح", 400);
    if (!reason || reason.trim() === '') throw new createError("يجب توضيح سبب الرفض", 400);

    const product = await Product.findByIdAndUpdate(
      id, { isApproved: false, status: "rejected", reason: reason.trim() }, { new: true }
    ).populate("category", "name nameEn").populate("seller", "_id firstName lastName");

    if (!product) throw new createError("المنتج غير موجود", 404);

    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io, title: "❌ تم رفض منتجك",
          message: `تم رفض منتج "${product.title}". السبب: ${reason}`,
          type: "PRODUCT_REJECTED", actor: req.user._id, userIds: [product.seller._id.toString()], // ✅ تم التعديل
          data: { productId: product._id, reason }, link: `/seller/products/${product._id}`,
        });
      } catch (err) { console.error(err); }
    })();

    res.status(200).json({ success: true, message: "تم رفض المنتج وإشعار البائع", product });
  } catch (error) { next(error); }
};

export const trustProduct = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw new createError("مرفوض. للإدارة فقط.", 403);

    const id = req.params.id || req.body.id;
    if (!isValidObjectId(id)) throw new createError("معرف المنتج غير صالح", 400);

    const product = await Product.findByIdAndUpdate(
      id, { isTrusted: true }, { new: true }
    )

    if (!product) throw new createError("المنتج غير موجود", 404);

    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io, title: "✅ تم توثيق  منتجك",
          message: `تم توثيق منتجك "${product.title}" وهو معروض الآن للبيع.`,
          type: "PRODUCT_UPDATED", actor: req.user._id,
          userIds: product.seller._id.toString(), // ✅ تم التعديل
          data: { productId: product._id }, link: `/products/${product._id}`,
        });
      } catch (err) { console.error(err); }
    })();

    res.status(200).json({ success: true, message: "تمت التوثيق على المنتج بنجاح", product });
  } catch (error) { next(error); }
};
// ==========================================
// 🔍 GETTERS & LISTINGS (Optimized with .lean())
// ==========================================
export const getProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = withStableTiebreaker(req.sort);
    const filterObj = req.filter || {};

    const filter = {
      isApproved: true,
      status: "available",
    };

    // Price Filter
    if (
      filterObj.minPrice !== undefined ||
      filterObj.maxPrice !== undefined
    ) {
      filter.price = {};

      if (filterObj.minPrice !== undefined) {
        filter.price.$gte = Number(filterObj.minPrice);
      }

      if (filterObj.maxPrice !== undefined) {
        filter.price.$lte = Number(filterObj.maxPrice);
      }
    }

    // Add remaining filters
    Object.keys(filterObj).forEach((key) => {
      if (key !== "minPrice" && key !== "maxPrice") {
        filter[key] = filterObj[key];
      }
    });

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .select('title colors price discountedPrice discountPercentage ratings seller category status sold quantity')
        .populate('seller', 'firstName lastName')
        .populate('category', 'name')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.status(200).json(formatPaginationResponse(products.map(toClientProduct), total, req.pagination));
  } catch (error) { next(error); }
};

export const getProductsForAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw new createError("مرفوض", 403);
    const { page, limit, skip } = req.pagination;
    const sortObj = withStableTiebreaker(req.sort);
    const filterObj = req.filter || {};

    const filter = { ...filterObj };
    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate('seller', 'firstName lastName email')
        .populate('category', 'name nameEn')
        .sort(sortObj)
        .skip(skip).limit(limit).lean(),
    ]);

    res.status(200).json(formatPaginationResponse(products.map(toClientProduct), total, req.pagination));
  } catch (error) { next(error); }
};

export const getSellerProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination;
    const sortObj = withStableTiebreaker(req.sort);
    const filterObj = req.filter || {};

    const filter = { seller: req.user._id, status: { $ne: 'deleted' }, ...filterObj };
    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate('category', 'name nameEn')
        .sort(sortObj)
        .skip(skip).limit(limit).lean(),
    ]);

    res.status(200).json(formatPaginationResponse(products.map(toClientProduct), total, req.pagination));
  } catch (error) { next(error); }
};

export const getProductById = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) throw new createError("معرف المنتج غير صالح", 400);

    const product = await Product.findById(productId)
      .populate('seller', 'firstName lastName email')
      .populate('category', '_id name nameEn description descriptionEn videoUrl').lean();

    if (!product || product.status === 'deleted') throw new createError("المنتج غير موجود", 404);
    res.status(200).json({ success: true, product: toClientProduct(product) });
  } catch (error) { next(error); }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const filter = { isApproved: true, isFeatured: true, status: 'available' };
    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(12)
      .lean();

    res.status(200).json({ success: true, data: products.map(toClientProduct) });
  } catch (error) { next(error); }
};

export const getNewArrivals = async (req, res, next) => {
  try {
    const filter = { isApproved: true, status: 'available' };
    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();

    res.status(200).json({ success: true, data: products.map(toClientProduct) });
  } catch (error) { next(error); }
};

export const getProductsByCategory = async (req, res, next) => {
  try {
    console.log("getProductsByCategory called with params:", req.params);

    const { categoryId } = req.params;

    if (!isValidObjectId(categoryId)) {
      throw new createError("معرف القسم غير صالح", 400);
    }

    const { page, limit, skip } = req.pagination;
    const sortObj = withStableTiebreaker(req.sort);
    const filterObj = req.filter || {};

    const filter = {
      isApproved: true,
      status: "available",
      category: categoryId,
    };

    // Price filter
    if (
      filterObj.minPrice !== undefined ||
      filterObj.maxPrice !== undefined
    ) {
      filter.price = {};

      if (filterObj.minPrice !== undefined) {
        filter.price.$gte = Number(filterObj.minPrice);
      }

      if (filterObj.maxPrice !== undefined) {
        filter.price.$lte = Number(filterObj.maxPrice);
      }
    }

    // Other filters
    Object.keys(filterObj).forEach((key) => {
      if (key !== "minPrice" && key !== "maxPrice") {
        filter[key] = filterObj[key];
      }
    });

    console.log("Filter constructed:", filter);

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),

      Product.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    console.log("Total products:", total);
    console.log("Products:", products.length);

    res.status(200).json(
      formatPaginationResponse(
        products.map(toClientProduct),
        total,
        req.pagination
      )
    );
  } catch (error) {
    next(error);
  }
};