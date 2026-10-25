// utils/productFilters.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared, DB-side product filtering for the storefront (search + facets).
// v5 inventory: stock lives at Product.colors[] → sizes[] → quantity.
// Every filter here is translated into a MongoDB query, so the whole matching
// result set is filtered/paginated in the database — never in the browser.
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from 'mongoose';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/** `size=M,L` or `size=M&size=L` → ['M','L'] */
export const toArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactInsensitive = (s) => new RegExp(`^${escapeRegex(s)}$`, 'i');

const num = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

// sorts used by the storefront, mapped to real Mongo sort objects
const SORT_MAP = {
  newest: { createdAt: -1 },
  latest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  priceLowToHigh: { price: 1 },
  priceHighToLow: { price: -1 },
  top_rated: { 'ratings.average': -1, 'ratings.count': -1 },
  topRated: { 'ratings.average': -1, 'ratings.count': -1 },
  popular: { sold: -1 },
  best_selling: { sold: -1 },
  relevance: { sold: -1 },
};

export const buildProductSort = (sort) => SORT_MAP[String(sort || '').trim()] || null;

/**
 * Builds the Mongo filter for the public storefront listing/search.
 * Supported (all combinable): search/q, category, size, color, minPrice,
 * maxPrice, minRating, brand, seller, inStock, status, isFeatured.
 * Returns `{ filter, sort, applied }` where `applied` is echoed to the client.
 */
export const buildProductFilter = (query = {}, { onlyAvailable = true } = {}) => {
  const filter = {};
  if (onlyAvailable) {
    filter.isApproved = true;
    filter.status = 'available';
  } else if (query.status) {
    filter.status = query.status;
  }

  const applied = {};

  // 1) free-text search (Arabic + English, case-insensitive, regex-escaped)
  const term = String(query.search || query.q || query.keyword || '').trim();
  if (term) {
    const rx = { $regex: escapeRegex(term), $options: 'i' };
    filter.$or = [{ title: rx }, { description: rx }, { brand: rx }, { tags: rx }];
    applied.search = term;
  }

  // 2) category (single id, csv, or repeated param)
  const categories = toArray(query.category || query.categories || query.categoryId);
  if (categories.length === 1 && isValidObjectId(categories[0])) {
    filter.category = categories[0];
    applied.category = categories[0];
  } else if (categories.length > 1) {
    const valid = categories.filter(isValidObjectId);
    if (valid.length) {
      filter.category = { $in: valid };
      applied.category = valid;
    }
  }

  // 3+4) size and/or color — matched on the SAME color entry (v5 inventory),
  // and only for colors that are active and sizes that still have stock.
  const sizes = toArray(query.size || query.sizes);
  const colors = toArray(query.color || query.colors);
  if (sizes.length || colors.length) {
    const conditions = [{ available: { $ne: false } }];

    if (sizes.length) {
      conditions.push({
        sizes: {
          $elemMatch: {
            size: { $in: sizes.map(exactInsensitive) },
            quantity: { $gt: 0 },
          },
        },
      });
      applied.size = sizes;
    }

    if (colors.length) {
      const matchers = colors.map(exactInsensitive);
      conditions.push({
        $or: [
          { value: { $in: matchers } },
          { name: { $in: matchers } },
        ],
      });
      applied.color = colors;
    }

    filter.colors = { $elemMatch: { $and: conditions } };
  }

  // 5) price range (validated: min <= max, never negative)
  const minPrice = num(query.minPrice);
  const maxPrice = num(query.maxPrice);
  if (minPrice !== undefined || maxPrice !== undefined) {
    let lo = minPrice !== undefined ? Math.max(0, minPrice) : undefined;
    let hi = maxPrice !== undefined ? Math.max(0, maxPrice) : undefined;
    if (lo !== undefined && hi !== undefined && lo > hi) [lo, hi] = [hi, lo];
    filter.price = {};
    if (lo !== undefined) filter.price.$gte = lo;
    if (hi !== undefined) filter.price.$lte = hi;
    if (Object.keys(filter.price).length) {
      applied.minPrice = lo;
      applied.maxPrice = hi;
    } else {
      delete filter.price;
    }
  }

  // 6) rating (0..5)
  const minRating = num(query.minRating ?? query.rating);
  if (minRating !== undefined && minRating > 0) {
    filter['ratings.average'] = { $gte: Math.min(5, minRating) };
    applied.minRating = Math.min(5, minRating);
  }

  // 7) extras kept for compatibility with the existing UI
  if (query.brand) {
    filter.brand = { $regex: escapeRegex(String(query.brand)), $options: 'i' };
    applied.brand = query.brand;
  }
  if (query.seller && isValidObjectId(query.seller)) {
    filter.seller = query.seller;
    applied.seller = query.seller;
  }
  if (String(query.inStock) === 'true') {
    filter.quantity = { $gt: 0 };
    applied.inStock = true;
  }
  if (String(query.isFeatured) === 'true') {
    filter.isFeatured = true;
    applied.isFeatured = true;
  }

  const sort = buildProductSort(query.sort);
  return { filter, sort, applied };
};

/** Facet values (sizes / colors / price bounds) for the filter sidebar. */
export const buildProductFacets = async (Product, baseFilter = {}) => {
  const rows = await Product.aggregate([
    { $match: { ...baseFilter } },
    {
      $project: {
        price: 1,
        colors: 1,
      },
    },
    {
      $facet: {
        price: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
        sizes: [
          { $unwind: '$colors' },
          { $match: { 'colors.available': { $ne: false } } },
          { $unwind: '$colors.sizes' },
          { $match: { 'colors.sizes.quantity': { $gt: 0 } } },
          { $group: { _id: '$colors.sizes.size', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        colors: [
          { $unwind: '$colors' },
          { $match: { 'colors.available': { $ne: false } } },
          { $group: { _id: { name: '$colors.name', value: '$colors.value' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 60 },
        ],
      },
    },
  ]).allowDiskUse(true);

  const facet = rows[0] || {};
  const priceBucket = (facet.price || [])[0] || { min: 0, max: 0 };

  return {
    price: { min: priceBucket.min || 0, max: priceBucket.max || 0 },
    sizes: (facet.sizes || []).filter((s) => s._id).map((s) => ({ size: s._id, count: s.count })),
    colors: (facet.colors || [])
      .filter((c) => c._id && (c._id.value || c._id.name))
      .map((c) => ({ name: c._id.name || c._id.value, value: c._id.value || c._id.name, count: c.count })),
  };
};
