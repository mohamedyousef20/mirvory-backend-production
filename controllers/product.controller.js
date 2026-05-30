import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';
import { createNotifications } from '../utils/notification.js';
import createError from '../utils/error.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// 🛠 FILTER & SORT MIDDLEWARES
// ==========================================
export const createFilterObj = (req, res, next) => {
  let filterObj = {};
  const { minPrice, maxPrice, isApproved, status, search, category, isFeatured, discountPercentage } = req.query;

  if (minPrice || maxPrice) {
    filterObj.price = {};
    if (minPrice) filterObj.price.$gte = parseFloat(minPrice);
    if (maxPrice) filterObj.price.$lte = parseFloat(maxPrice);
  }

  if (isApproved !== undefined) filterObj.isApproved = isApproved === 'true';
  if (status) filterObj.status = status;
  if (isFeatured !== undefined) filterObj.isFeatured = isFeatured === 'true';
  if (discountPercentage) filterObj.discountPercentage = { $gte: parseFloat(discountPercentage) };

  if (req.params.categoryId && isValidObjectId(req.params.categoryId)) {
    filterObj.category = req.params.categoryId;
  } else if (category) {
    const categoryIds = String(category).split(',').map(id => id.trim()).filter(id => isValidObjectId(id));
    if (categoryIds.length > 1) {
      filterObj.category = { $in: categoryIds };
    } else if (categoryIds.length === 1) {
      filterObj.category = categoryIds[0];
    }
  }

  if (search) {
    const searchQuery = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filterObj.$or = [
      { title: { $regex: searchQuery, $options: 'i' } },
      { description: { $regex: searchQuery, $options: 'i' } }
    ];
  }

  req.filterObj = filterObj;
  next();
};

export const createSortObj = (req, res, next) => {
  let sortObj = {};
  if (req.query.sort) {
    const sortFields = String(req.query.sort).split(',');
    sortFields.forEach(field => {
      const sortOrder = field.startsWith('-') ? -1 : 1;
      const fieldName = field.replace(/^-/, '');
      sortObj[fieldName] = sortOrder;
    });
  } else {
    sortObj.createdAt = -1;
  }
  req.sortObj = sortObj;
  next();
};

// ==========================================
// 📦 PRODUCT CRUD & MANAGEMENT
// ==========================================
export const createProduct = async (req, res, next) => {
  try {
    const productData = req.body.data || req.body;

    if (!productData.title || !productData.description || !productData.price || !productData.category) {
      throw createError("جميع الحقول الأساسية (الاسم، الوصف، السعر، القسم) مطلوبة", 400);
    }
    if (!isValidObjectId(productData.category)) throw createError("القسم المحدد غير صالح", 400);

    if (!productData.images || !Array.isArray(productData.images) || productData.images.length === 0) {
      throw createError("يجب إرفاق صورة واحدة على الأقل للمنتج", 400);
    }

    let sizes = [];
    if (productData.sizes) {
      try {
        sizes = typeof productData.sizes === 'string' ? JSON.parse(productData.sizes) : productData.sizes;
        if (!Array.isArray(sizes)) sizes = [sizes];
      } catch (e) { sizes = [productData.sizes]; }
    }

    let colors = [];
    if (productData.colors) {
      try {
        colors = typeof productData.colors === 'string' ? JSON.parse(productData.colors) : productData.colors;
        if (!Array.isArray(colors)) colors = [colors];
      } catch (e) { colors = [productData.colors]; }

      if (colors.length > 0) {
        const isValidColors = colors.every(c => c && typeof c === 'object' && c.name && c.value);
        if (!isValidColors) throw createError("صيغة الألوان غير صحيحة", 400);
        colors = colors.map(c => ({ name: c.name, value: c.value, available: c.available !== false }));
      }
    }

    const price = parseFloat(productData.price);
    const discountPercentage = parseFloat(productData.discountPercentage) || 0;
    const discountAmount = price * (discountPercentage / 100);
    const discountedPrice = price - discountAmount;

    const product = await Product.create({
      seller: req.user._id,
      title: productData.title,
      description: productData.description,
      images: productData.images,
      sizes,
      colors,
      price,
      discountPercentage,
      discountedPrice,
      category: productData.category,
      status: 'pending', // دائماً pending ليتطلب مراجعة
      isApproved: false,
      sellerPercentage: discountedPrice * 0.88, // نسبة مبدئية
      isFeatured: productData.isFeatured === 'true' || productData.isFeatured === true,
      quantity: parseInt(productData.quantity) || 0
    });

    await product.populate('category', 'name nameEn');
    await product.populate('seller', 'firstName lastName email');

    // 🔔 NOTIFICATION: Product Submitted for Review
    (async () => {
      try {
        const io = req.app.get("io");
        const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();

        if (adminUsers.length > 0) {
          await createNotifications({
            io, title: '📦 منتج جديد للمراجعة',
            message: `تم إضافة منتج جديد "${product.title}" بواسطة ${product.seller.firstName}`,
            type: 'PRODUCT_SUBMITTED', actor: req.user._id, userIds: adminUsers.map(a => a._id.toString()), // ✅ تم إصلاح userId لـ userIds
            data: { productId: product._id }, link: `/admin/products/${product._id}`,
          });
        }
      } catch (err) { console.error("Notification Error:", err); }
    })();

    res.status(201).json({ success: true, message: 'تم إضافة المنتج وهو قيد المراجعة', product });
  } catch (error) {
    if (error.code === 11000) return next(new createError("يوجد منتج مشابه بالفعل", 400));
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw createError("معرف المنتج غير صالح", 400);

    const updates = req.body;
    const product = await Product.findById(id);

    if (!product) throw createError("المنتج غير موجود", 404);

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      throw createError("غير مصرح لك بتحديث هذا المنتج", 403);
    }

    if (updates.images && Array.isArray(updates.images)) product.images = updates.images;

    if (updates.sizes !== undefined) {
      try {
        product.sizes = typeof updates.sizes === 'string' ? JSON.parse(updates.sizes) : (Array.isArray(updates.sizes) ? updates.sizes : [updates.sizes]);
      } catch (e) { product.sizes = updates.sizes; }
    }

    if (updates.price !== undefined || updates.discountPercentage !== undefined) {
      const price = updates.price !== undefined ? parseFloat(updates.price) : product.price;
      const discountPercentage = updates.discountPercentage !== undefined ? parseFloat(updates.discountPercentage) : product.discountPercentage;
      product.price = price;
      product.discountPercentage = discountPercentage;
      product.discountedPrice = price - (price * (discountPercentage / 100));
    }

    const allowedUpdates = ['title', 'description', 'quantity', 'category', 'isFeatured', 'sellerPercentage'];
    allowedUpdates.forEach(key => {
      if (updates[key] !== undefined) {
        if (key === 'quantity' || key === 'sellerPercentage') product[key] = parseFloat(updates[key]);
        else if (key === 'isFeatured') product[key] = (updates[key] === 'true' || updates[key] === true);
        else product[key] = updates[key];
      }
    });

    const requiresReapproval = req.user.role !== 'admin';
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
          const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();
          if (adminUsers.length > 0) {
            await createNotifications({
              io, title: '📦 تحديث منتج للمراجعة',
              message: `تم تعديل منتج "${updatedProduct.title}" ويحتاج إلى مراجعة جديدة`,
              type: 'PRODUCT_UPDATED_PENDING', actor: req.user._id, userIds: adminUsers.map(a => a._id.toString()),
              data: { productId: updatedProduct._id }, link: `/admin/products/${updatedProduct._id}`,
            });
          }
        } catch (err) { console.error(err); }
      })();
    }

    res.status(200).json({ success: true, message: 'تم تحديث المنتج بنجاح', product: updatedProduct });
  } catch (error) { next(error); }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw createError("معرف المنتج غير صالح", 400);

    const product = await Product.findById(id);
    if (!product) throw createError("المنتج غير موجود", 404);

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      throw createError("غير مصرح لك بحذف هذا المنتج", 403);
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
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("مرفوض. للإدارة فقط.", 403);

    const id = req.params.id || req.body.id;
    if (!isValidObjectId(id)) throw createError("معرف المنتج غير صالح", 400);

    const product = await Product.findByIdAndUpdate(
      id, { isApproved: true, status: "available", reason: null }, { new: true }
    ).populate("category", "name nameEn").populate("seller", "_id firstName lastName");

    if (!product) throw createError("المنتج غير موجود", 404);

    (async () => {
      try {
        const io = req.app.get("io");
        await createNotifications({
          io, title: "✅ تمت الموافقة على منتجك",
          message: `تمت الموافقة على المنتج "${product.title}" وهو معروض الآن للبيع.`,
          type: "PRODUCT_APPROVED", actor: req.user._id, userIds: [product.seller._id.toString()], // ✅ تم التعديل
          data: { productId: product._id }, link: `/seller/products/${product._id}`,
        });
      } catch (err) { console.error(err); }
    })();

    res.status(200).json({ success: true, message: "تمت الموافقة على المنتج بنجاح", product });
  } catch (error) { next(error); }
};

export const rejectProduct = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("مرفوض. للإدارة فقط.", 403);

    const { id, reason } = req.body;
    if (!isValidObjectId(id)) throw createError("معرف المنتج غير صالح", 400);
    if (!reason || reason.trim() === '') throw createError("يجب توضيح سبب الرفض", 400);

    const product = await Product.findByIdAndUpdate(
      id, { isApproved: false, status: "rejected", reason: reason.trim() }, { new: true }
    ).populate("category", "name nameEn").populate("seller", "_id firstName lastName");

    if (!product) throw createError("المنتج غير موجود", 404);

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

// ==========================================
// 🔍 GETTERS & LISTINGS (Optimized with .lean())
// ==========================================
export const getProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;

    const filter = { isApproved: true, status: 'available', ...(req.filterObj || {}) };

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip).limit(limit).lean();

    res.status(200).json({ success: true, products, pagination: { current: page, pages: Math.ceil(total / limit), total } });
  } catch (error) { next(error); }
};

export const getProductsForAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') throw createError("مرفوض", 403);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const filter = { ...(req.filterObj || {}) };
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName email')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip).limit(limit).lean();

    res.status(200).json({ success: true, products, pagination: { current: page, pages: Math.ceil(total / limit), total } });
  } catch (error) { next(error); }
};

export const getSellerProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const filter = { seller: req.user._id, status: { $ne: 'deleted' }, ...(req.filterObj || {}) };
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip).limit(limit).lean();

    res.status(200).json({ success: true, products, pagination: { current: page, pages: Math.ceil(total / limit), total } });
  } catch (error) { next(error); }
};

export const getProductById = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) throw createError("معرف المنتج غير صالح", 400);

    const product = await Product.findById(productId)
      .populate('seller', 'firstName lastName email')
      .populate('category', '_id name nameEn description descriptionEn').lean();

    if (!product || product.status === 'deleted') throw createError("المنتج غير موجود", 404);
    res.status(200).json({ success: true, product });
  } catch (error) { next(error); }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ isApproved: true, isFeatured: true, status: 'available' })
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ createdAt: -1 }).limit(10).lean();
    res.status(200).json({ success: true, products });
  } catch (error) { next(error); }
};

export const getNewArrivals = async (req, res, next) => {
  try {
    const products = await Product.find({ isApproved: true, status: 'available' })
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ createdAt: -1 }).limit(10).lean();
    res.status(200).json({ success: true, products });
  } catch (error) { next(error); }
};

export const getProductsByCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    if (!isValidObjectId(categoryId)) throw createError("معرف القسم غير صالح", 400);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;

    const filter = { isApproved: true, status: 'available', category: categoryId, ...(req.filterObj || {}) };
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip).limit(limit).lean();

    res.status(200).json({ success: true, products, pagination: { current: page, pages: Math.ceil(total / limit), total } });
  } catch (error) { next(error); }
};

export const searchProducts = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === '') throw createError("كلمة البحث مطلوبة", 400);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;

    const searchQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const { $or, ...restFilterObj } = req.filterObj || {};

    const searchFilter = {
      isApproved: true, status: 'available',
      $or: [
        { title: { $regex: searchQuery, $options: 'i' } },
        { description: { $regex: searchQuery, $options: 'i' } }
      ],
      ...restFilterObj
    };

    const total = await Product.countDocuments(searchFilter);
    const products = await Product.find(searchFilter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip).limit(limit).lean();

    res.status(200).json({ success: true, products, query: q, pagination: { current: page, pages: Math.ceil(total / limit), total } });
  } catch (error) { next(error); }
};