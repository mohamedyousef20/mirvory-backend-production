import createError from './error.js';
const fail = (message) => { throw new createError(message, 400); };
export function productEditFields(raw, isAdmin) {
  const out = {};
  for (const key of ['title', 'description', 'brand', 'rejectionReason']) {
    if (raw[key] === undefined || (key === 'rejectionReason' && !isAdmin)) continue;
    if (typeof raw[key] !== 'string') fail(`${key}: text required`);
    out[key] = raw[key].trim();
    if (['title', 'description'].includes(key) && !out[key]) fail(`${key}: required`);
  }
  for (const [key, max] of [['price', Infinity], ['discountPercentage', 100], ['sellerPercentage', Infinity]]) {
    if (raw[key] === undefined || (key === 'sellerPercentage' && !isAdmin)) continue;
    const n = Number(raw[key]);
    if (raw[key] === '' || raw[key] === null || !Number.isFinite(n) || n < 0 || n > max || (key === 'price' && n === 0)) fail(`${key}: invalid number`);
    out[key] = n;
  }
  for (const key of ['isFeatured', 'isTrusted', 'isApproved', 'needsStockReview']) {
    if (!isAdmin || raw[key] === undefined) continue;
    if (![true, false, 'true', 'false'].includes(raw[key])) fail(`${key}: invalid boolean`);
    out[key] = raw[key] === true || raw[key] === 'true';
  }
  if (raw.tags !== undefined) {
    const tags = typeof raw.tags === 'string' ? raw.tags.split(',') : raw.tags;
    if (!Array.isArray(tags) || tags.length > 50 || tags.some(t => typeof t !== 'string' || t.length > 100)) fail('tags: invalid list');
    out.tags = [...new Set(tags.map(t => t.trim()).filter(Boolean))];
  }
  if (isAdmin && raw.status !== undefined) {
    if (!['available', 'pending', 'deleted'].includes(raw.status)) fail('status: invalid value');
    out.status = raw.status;
  }
  return out;
}
