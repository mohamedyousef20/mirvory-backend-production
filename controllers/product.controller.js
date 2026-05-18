import Product from '../models/product.model.js';
import mongoose from 'mongoose';
import { createNotifications } from '../utils/notification.js';


//create filter object
export const createFilterObj = (req, res, next) => {
  let filterObj = {};

  // Handle query parameters from the request
  const {
    minPrice,
    maxPrice,
    isApproved,
    status,
    search,
    category,
    isFeatured,
    discountPercentage,
    // add any other fields you want to filter by
  } = req.query;

  // Price range filtering - use discountedPrice for better user experience
  if (minPrice || maxPrice) {
    filterObj.price = {};
    if (minPrice) {
      filterObj.price.$gte = parseFloat(minPrice);
    }
    if (maxPrice) {
      filterObj.price.$lte = parseFloat(maxPrice);
    }
  }

  // Boolean filters
  if (isApproved !== undefined) {
    filterObj.isApproved = isApproved === 'true';
  }

  // Status filter
  if (status) {
    filterObj.status = status;
  }

  // Featured filter
  if (isFeatured !== undefined) {
    filterObj.isFeatured = isFeatured === 'true';
  }

  // Discount filter
  if (discountPercentage) {
    filterObj.discountPercentage = { $gte: parseFloat(discountPercentage) };
  }

  // Category from route params (for nested routes like /categories/:categoryId/products)
  if (req.params.categoryId) {
    console.log('Filtering by category from params:', req.params.categoryId);
    filterObj.category = req.params.categoryId;
  }
  else if (category) {
    // Support multiple category IDs (comma-separated)
    const categoryIds = String(category).split(',').map(id => id.trim()).filter(Boolean);
    if (categoryIds.length > 1) {
      filterObj.category = { $in: categoryIds.map(id => new mongoose.Types.ObjectId(id)) };
    } else if (categoryIds.length === 1) {
      filterObj.category = new mongoose.Types.ObjectId(categoryIds[0]);
    }
  }

  if (search) {
    // Trim and escape special regex characters from search query
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
    const sortFields = req.query.sort.split(',');

    sortFields.forEach(field => {
      const sortOrder = field.startsWith('-') ? -1 : 1;
      const fieldName = field.replace(/^-/, '');
      sortObj[fieldName] = sortOrder;
    });
  } else {
    // Default sorting if none specified
    sortObj.createdAt = -1;
  }

  req.sortObj = sortObj;
  next();
};

export const createProduct = async (req, res) => {
  try {
    console.log('d777dddd')
    // Extract data - handle both direct body and wrapped { data: {...} } format
    const productData = req.body.data || req.body;

    console.log('Product Data:', productData);

    // Validate required fields
    if (!productData.title || !productData.description || !productData.price || !productData.category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, description, price, and category are required'
      });
    }

    // Validate images
    if (!productData.images || !Array.isArray(productData.images) || productData.images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image is required'
      });
    }

    // Parse sizes from JSON string if it exists, or use array directly
    let sizes = [];
    if (productData.sizes) {
      if (typeof productData.sizes === 'string') {
        try {
          sizes = JSON.parse(productData.sizes);
        } catch (error) {
          console.log('Failed to parse sizes as JSON, using as array');
          sizes = Array.isArray(productData.sizes) ? productData.sizes : [productData.sizes];
        }
      } else if (Array.isArray(productData.sizes)) {
        sizes = productData.sizes;
      }
    }

    // Parse colors from JSON string if it exists, or use array directly
    let colors = [];
    if (productData.colors) {
      if (typeof productData.colors === 'string') {
        try {
          colors = JSON.parse(productData.colors);
        } catch (error) {
          console.log('Failed to parse colors as JSON, using as array');
          colors = Array.isArray(productData.colors) ? productData.colors : [productData.colors];
        }
      } else if (Array.isArray(productData.colors)) {
        colors = productData.colors;
      }

      // Validate color objects
      if (colors.length > 0) {
        const isValidColors = colors.every(color =>
          color &&
          typeof color === 'object' &&
          color.name &&
          color.value
        );

        if (!isValidColors) {
          return res.status(400).json({
            success: false,
            message: 'Invalid colors format. Each color must have name and value properties'
          });
        }

        // Set default availability if not provided
        colors = colors.map(color => ({
          name: color.name,
          value: color.value,
          available: color.available !== undefined ? color.available : true
        }));
      }
    }

    // Calculate prices
    const price = parseFloat(productData.price);
    const discountPercentage = parseFloat(productData.discountPercentage) || 0;
    const discountAmount = price * (discountPercentage / 100);
    const discountedPrice = price - discountAmount;

    // Create product with Cloudinary URLs directly from frontend
    const product = await Product.create({
      seller: req.user._id,
      title: productData.title,
      description: productData.description,
      images: productData.images,
      sizes: sizes,
      colors: colors, // Include parsed colors
      price: price,
      discountPercentage: discountPercentage,
      discountedPrice: discountedPrice,
      category: productData.category,
      status: productData.status || 'pending',
      sellerPercentage: discountedPrice * 0.88,
      isFeatured: productData.isFeatured === 'true' || productData.isFeatured === true,
      quantity: parseInt(productData.quantity) || 0
    });

    // Populate category and seller for response
    await product.populate('category', 'name nameEn');
    await product.populate('seller', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: product
    });
  } catch (error) {
    console.error('Product creation error:', error);

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Product with similar details already exists'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

export const getProductsForAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { ...(req.filterObj || {}) };

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName email')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      products,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getProducts = async (req, res) => {
  try {
    console.log('Getting products with filter...');

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    const filter = {
      isApproved: true,
      status: 'available',
      ...(req.filterObj || {})
    };

    console.log('Final filter object:', filter);

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      products,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error in getProducts:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId)
      .populate('seller', 'firstName lastName email')
      .populate('category', '_id name nameEn description descriptionEn');
    console.log(product, 'prod***************')
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({
      isApproved: true,
      isFeatured: true,
      status: 'available'
    })
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ createdAt: -1 })
      .limit(8);

    res.json({
      success: true,
      products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getNewArrivals = async (req, res) => {
  try {
    const products = await Product.find({
      isApproved: true,
      status: 'available'
    })
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort({ createdAt: -1 })
      .limit(8);

    res.json({
      success: true,
      products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    const filter = {
      isApproved: true,
      status: 'available',
      category: categoryId,
      ...(req.filterObj || {})
    };

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      // .populate('seller', 'firstName lastName')
      // .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      products,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const approveProduct = async (req, res) => {
  try {
    // Accept id from params OR body
    const id = req.params.id || req.body.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Approve product
    const product = await Product.findByIdAndUpdate(
      id,
      {
        isApproved: true,
        status: "available",
        reason: null,
      },
      { new: true }
    )
      .populate("category", "name nameEn")
      .populate("seller", "_id firstName lastName");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "المنتج غير موجود",
      });
    }

    // Socket instance
    const io = req.app.get("io");

    // Send notification to seller
    await createNotifications({
      io,
      title: "تمت الموافقة على منتجك",
      message: `تمت الموافقة على المنتج "${product.title}" وأصبح متاحًا الآن.`,
      type: "product_approved",
      actor: req.user._id, // admin id
      userIds: [product.seller._id.toString()],
      data: {
        productId: product._id,
        productTitle: product.title,
      },
      link: `/seller/products/${product._id}`,
    });

    res.json({
      success: true,
      message: "تمت الموافقة على المنتج وإشعار البائع",
      product,
    });
  } catch (error) {
    console.error("Approve Product Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const rejectProduct = async (req, res) => {
  try {
    const { id ,reason} = req.body;
console.log(req.body,'ribody')

    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    // Reject product
    const product = await Product.findByIdAndUpdate(
      id,
      {
        isApproved: false,
        status: "rejected",
        reason: reason.trim(),
      },
      { new: true }
    )
      .populate("category", "name nameEn")
      .populate("seller", "_id firstName lastName");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "المنتج غير موجود",
      });
    }

    // Socket instance
    const io = req.app.get("io");

    // Send notification to seller with rejection reason
    await createNotifications({
      io,
      title: "تم رفض منتجك",
      message: `تم رفض المنتج "${product.title}". السبب: ${reason}`,
      type: "product_rejected",
      actor: req.user._id, // admin id
      userIds: [product.seller._id.toString()],
      data: {
        productId: product._id,
        productTitle: product.title,
        reason: reason,
      },
      link: `/seller/products/${product._id}`,
    });

    res.json({
      success: true,
      message: "تم رفض المنتج وإشعار البائع",
      product,
    });
  } catch (error) {
    console.error("Reject Product Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getSellerProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {
      seller: req.user._id,
      ...(req.filterObj || {})
    };

    console.log('Filter for seller products:', filter);

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      products,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'المنتج غير موجود'
      });
    }

    // Check if the user is the seller or admin
    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بحذف هذا المنتج'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'تم حذف المنتج بنجاح'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const updates = req.body;

    // البحث عن المنتج
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'المنتج غير موجود'
      });
    }

    // التحقق إذا كان المستخدم هو صاحب المنتج أو admin
    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بتحديث هذا المنتج'
      });
    }

    // Handle image updates - Cloudinary URLs from frontend
    if (updates.images && Array.isArray(updates.images)) {
      product.images = updates.images;
    }

    // Handle sizes updates
    if (updates.sizes !== undefined) {
      let sizes = [];
      if (typeof updates.sizes === 'string') {
        try {
          sizes = JSON.parse(updates.sizes);
        } catch (error) {
          sizes = Array.isArray(updates.sizes) ? updates.sizes : [updates.sizes];
        }
      } else if (Array.isArray(updates.sizes)) {
        sizes = updates.sizes;
      }
      product.sizes = sizes;
    }

    // Handle price and discount calculations
    if (updates.price !== undefined || updates.discountPercentage !== undefined) {
      const price = updates.price !== undefined ? parseFloat(updates.price) : product.price;
      const discountPercentage = updates.discountPercentage !== undefined ? parseFloat(updates.discountPercentage) : product.discountPercentage;

      const discountAmount = price * (discountPercentage / 100);
      const discountedPrice = price - discountAmount;

      product.price = price;
      product.discountPercentage = discountPercentage;
      product.discountedPrice = discountedPrice;
    }

    // Handle other updates
    const allowedUpdates = [
      'title', 'description', 'status', 'quantity',
      'category', 'isFeatured', 'sellerPercentage'
    ];

    allowedUpdates.forEach(key => {
      if (updates[key] !== undefined) {
        if (key === 'quantity' || key === 'sellerPercentage') {
          product[key] = parseFloat(updates[key]);
        } else if (key === 'isFeatured') {
          product[key] = updates[key] === 'true' || updates[key] === true;
        } else {
          product[key] = updates[key];
        }
      }
    });

    // If the updater is a seller (not admin), require re-approval
    if (req.user.role !== 'admin') {
      product.isApproved = false;
      product.status = 'pending';
    }

    // Save the product (this will trigger the pre-save middleware)
    const updatedProduct = await product.save();

    // Populate category and seller for response
    await updatedProduct.populate('category', 'name nameEn');
    await updatedProduct.populate('seller', 'firstName lastName email');

    res.json({
      success: true,
      message: 'تم تحديث المنتج بنجاح',
      product: updatedProduct
    });

  } catch (error) {
    console.error('Error updating product:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
};

export const searchProducts = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Trim and escape special regex characters from search query
    const searchQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build search filter with case-insensitive regex
    const searchFilter = {
      isApproved: true,
      status: 'available',
      $or: [
        { title: { $regex: searchQuery, $options: 'i' } },
        { description: { $regex: searchQuery, $options: 'i' } }
      ],
      ...(req.filterObj ? (() => { const { $or, ...rest } = req.filterObj; return rest; })() : {})
    };

    // Get total count for pagination
    const total = await Product.countDocuments(searchFilter);

    const products = await Product.find(searchFilter)
      .populate('seller', 'firstName lastName')
      .populate('category', 'name nameEn')
      .sort(req.sortObj || { createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      products,
      query: q,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};