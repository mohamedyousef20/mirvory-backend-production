// utils/inventory.js
// ─────────────────────────────────────────────────────────────────────────────
// v5 — color-based inventory.
// Stock lives at:  Product → colors[] (matched by color.value) → sizes[] (matched by size) → quantity
// Every function here is the single place that knows that structure.
// ─────────────────────────────────────────────────────────────────────────────
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import createError from './error.js';

const HEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const norm = (v) => String(v ?? '').trim();
const key = (v) => norm(v).toLowerCase();

const parseMaybeJson = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};

/**
 * Validate + normalize `colors[]` coming from the client (create / update).
 * Throws a 400 createError with a clear Arabic message on the first problem.
 * The returned array contains ONLY known fields (no legacy images/sizes leak in).
 */
export function normalizeColors(rawColors) {
  let colors = parseMaybeJson(rawColors);
  if (colors && !Array.isArray(colors)) colors = [colors];
  if (!Array.isArray(colors) || colors.length === 0) {
    throw new createError('يجب إضافة لون واحد على الأقل مع صورته ومقاساته', 400);
  }

  const seenColors = new Set();

  return colors.map((c, i) => {
    if (!c || typeof c !== 'object') throw new createError(`بيانات اللون رقم ${i + 1} غير صالحة`, 400);

    const name = norm(c.name);
    const value = norm(c.value);
    const image = norm(c.image);

    if (!name) throw new createError(`اسم اللون رقم ${i + 1} مطلوب`, 400);
    if (!HEX.test(value)) throw new createError(`قيمة اللون "${name}" يجب أن تكون HEX صحيحة`, 400);
    if (!image) throw new createError(`صورة اللون "${name}" مطلوبة`, 400);
    if (seenColors.has(value.toLowerCase())) throw new createError(`اللون "${name}" مكرر داخل المنتج`, 400);
    seenColors.add(value.toLowerCase());

    const rawSizes = parseMaybeJson(c.sizes);
    if (!Array.isArray(rawSizes) || rawSizes.length === 0) {
      throw new createError(`اللون "${name}" يجب أن يحتوي على مقاس واحد على الأقل`, 400);
    }

    const seenSizes = new Set();
    const sizes = rawSizes.map((s) => {
      const size = norm(s?.size);
      // `quantity` is the field name; `stock` is accepted as an alias
      const qtyRaw = s?.quantity ?? s?.stock;
      const quantity = Number(qtyRaw);

      if (!size) throw new createError(`يوجد مقاس بدون اسم في اللون "${name}"`, 400);
      if (size.length > 20) throw new createError(`المقاس "${size}" طويل جدًا`, 400);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new createError(`كمية المقاس ${size} في اللون "${name}" يجب أن تكون رقمًا صحيحًا ولا تقل عن صفر`, 400);
      }
      if (seenSizes.has(size.toUpperCase())) throw new createError(`المقاس ${size} مكرر داخل اللون "${name}"`, 400);
      seenSizes.add(size.toUpperCase());

      return { size, quantity };
    });

    const out = { name, value, image, available: c.available !== false, sizes };
    if (c._id && mongoose.Types.ObjectId.isValid(c._id)) out._id = c._id; // keep identity on edit
    return out;
  });
}

/** Total sellable stock = all sizes of all available colors. */
export const computeTotalStock = (colors = []) =>
  colors
    .filter((c) => c.available !== false)
    .reduce((sum, c) => sum + (c.sizes || []).reduce((s, x) => s + (x.quantity || 0), 0), 0);

export const findColor = (product, colorValue) =>
  (product.colors || []).find((c) => key(c.value) === key(colorValue)) || null;

export const findSizeEntry = (color, size) =>
  (color?.sizes || []).find((s) => norm(s.size).toUpperCase() === norm(size).toUpperCase()) || null;

/** Image shown on cards / lists: first available color that has an image. */
export const getPrimaryImage = (product) => {
  const colors = product?.colors || [];
  const first = colors.find((c) => c.available !== false && c.image) || colors.find((c) => c.image);
  return first ? first.image : null;
};

/**
 * Shape a product for API responses: adds `image`/`totalStock` and makes sure the
 * removed legacy global fields (images[], sizes[]) can never reach the client again,
 * even if old documents still hold them in MongoDB.
 */
export const toClientProduct = (p) => {
  if (!p) return p;
  const o = typeof p.toObject === 'function' ? p.toObject() : { ...p };
  delete o.images;
  delete o.sizes;
  o.image = getPrimaryImage(o);
  o.totalStock = computeTotalStock(o.colors);
  return o;
};

/**
 * Resolve the exact (color, size) a customer selected and check there is enough stock.
 * Throws a clear 400 otherwise. Returns { color, sizeEntry }.
 */
export function resolveSelection(product, colorValue, size, quantity = 1) {
  const title = product?.title ? `"${product.title}"` : 'المنتج';

  if (!colorValue || !size) throw new createError(`اختر اللون والمقاس للمنتج ${title}`, 400);

  const color = findColor(product, colorValue);
  if (!color) throw new createError(`اللون المحدد غير موجود في المنتج ${title}`, 400);
  if (color.available === false) throw new createError(`اللون ${color.name} غير متاح حاليًا للمنتج ${title}`, 400);

  const sizeEntry = findSizeEntry(color, size);
  if (!sizeEntry) throw new createError(`المقاس ${size} غير متاح في اللون ${color.name} للمنتج ${title}`, 400);

  if (sizeEntry.quantity < quantity) {
    throw new createError(
      sizeEntry.quantity === 0
        ? `المقاس ${size} من اللون ${color.name} نفد من المخزون (${title})`
        : `المتاح من المقاس ${size} في اللون ${color.name} هو ${sizeEntry.quantity} فقط (${title})`,
      400
    );
  }
  return { color, sizeEntry };
}

const cellFilter = (colorValue, size) => ({
  'c.value': colorValue,
  's.size': size,
});

/**
 * Atomically take stock for ONE line: Product + Color + Size.
 * The guard `quantity >= qty` lives inside the same MongoDB operation, so two simultaneous
 * orders can never both buy the last piece. Returns true if the stock was taken.
 */
export async function takeStock({ productId, colorValue, size, quantity }) {
  const result = await Product.updateOne(
    {
      _id: productId,
      status: 'available',
      colors: {
        $elemMatch: {
          value: colorValue,
          available: { $ne: false },
          sizes: { $elemMatch: { size, quantity: { $gte: quantity } } },
        },
      },
    },
    {
      $inc: {
        'colors.$[c].sizes.$[s].quantity': -quantity,
        quantity: -quantity,
        sold: quantity,
      },
    },
    {
      arrayFilters: [{ 'c.value': colorValue }, { 's.size': size }],
    }
  );
  return result.modifiedCount === 1;
}

/** Give stock back to the exact color+size (cancel / failed order). */
export async function returnStock({ productId, colorValue, size, quantity }) {
  const result = await Product.updateOne(
    { _id: productId, colors: { $elemMatch: { value: colorValue, sizes: { $elemMatch: { size } } } } },
    {
      $inc: {
        'colors.$[c].sizes.$[s].quantity': quantity,
        quantity: quantity,
        sold: -quantity,
      },
    },
    { arrayFilters: [{ 'c.value': colorValue }, { 's.size': size }] }
  );
  return result.modifiedCount === 1;
}

/**
 * Reserve stock for several lines. All-or-nothing: if any line fails, the lines already
 * taken are returned, so stock can never be corrupted by a half-finished order.
 * lines: [{ productId, colorValue, size, quantity }]
 */
export async function reserveStock(lines) {
  const taken = [];
  try {
    for (const line of lines) {
      const ok = await takeStock(line);
      if (!ok) {
        throw new createError('نفدت الكمية المطلوبة من أحد المنتجات أثناء تأكيد الطلب، يرجى مراجعة السلة', 409);
      }
      taken.push(line);
    }
  } catch (err) {
    for (const line of taken) {
      try { await returnStock(line); } catch (rollbackErr) {
        console.error('[CRITICAL] Stock rollback failed:', line, rollbackErr);
      }
    }
    throw err;
  }
}

/** Return stock for every item of an order (used on cancellation). */
export async function restoreOrderStock(order) {
  const report = { restored: 0, skipped: [] };
  for (const item of order.items) {
    const colorValue = item.color?.value;
    const size = item.size;
    if (!colorValue || !size) { report.skipped.push(String(item._id)); continue; }
    const ok = await returnStock({ productId: item.product, colorValue, size, quantity: item.quantity });
    if (ok) report.restored += 1; else report.skipped.push(String(item._id));
  }
  return report;
}
