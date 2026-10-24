/**
 * v5 migration — move product data to the color-based structure
 *
 *   BEFORE:  product.images[] , product.sizes[] , product.quantity (one global number) , colors[{name,value,image,available}]
 *   AFTER :  product.colors[{ name, value, image, available, sizes:[{ size, quantity }] }]  (+ derived product.quantity)
 *
 * SAFE BY DESIGN
 *   - Default run is a DRY RUN: it only prints a report, it changes nothing.
 *   - `--apply` first saves a full backup file of every product it is about to change.
 *   - It never deletes the old `images` / `sizes` fields. Removing them is a separate, explicit step (`--cleanup`).
 *   - It is idempotent: products that are already in the new format are skipped, so it can be re-run.
 *   - It never links an old image to a random color. Old gallery images that do not belong to any color are
 *     only REPORTED (they stay in the database) so you can review them by hand.
 *
 * USAGE (from the backend folder, with MONGODB_URI in .env)
 *   node scripts/migrate-v5-color-inventory.js                       # dry run + report
 *   node scripts/migrate-v5-color-inventory.js --apply               # migrate (writes a backup first)
 *   node scripts/migrate-v5-color-inventory.js --apply --stock-mode=zero
 *   node scripts/migrate-v5-color-inventory.js --rollback scripts/backups/<file>.json   # undo using the backup
 *   node scripts/migrate-v5-color-inventory.js --cleanup --apply     # LATER, after you verified everything
 *
 * STOCK MODE (old products only knew ONE total quantity, not a quantity per color/size)
 *   even (default): the old total is split evenly across the color/size cells, so nothing suddenly becomes
 *                   "out of stock". Every such product is flagged `needsStockReview` — fix the numbers in the dashboard.
 *   zero          : every new cell starts at 0 (nothing can be sold until the seller enters real stock).
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const APPLY = flag('--apply');
const CLEANUP = flag('--cleanup');
const ROLLBACK_IDX = args.indexOf('--rollback');
const ROLLBACK_FILE = ROLLBACK_IDX >= 0 ? args[ROLLBACK_IDX + 1] : null;
const STOCK_MODE = opt('--stock-mode', 'even'); // even | zero

const DEFAULT_COLOR = { name: 'افتراضي', value: '#9CA3AF' };
const ONE_SIZE = 'ONE SIZE';

const str = (v) => String(v ?? '').trim();
const uniq = (arr) => [...new Set(arr)];

const hasNewShape = (d) =>
  Array.isArray(d.colors) &&
  d.colors.length > 0 &&
  d.colors.every((c) => Array.isArray(c.sizes) && c.sizes.length > 0);

const totalOf = (colors) =>
  colors.filter((c) => c.available !== false).reduce((s, c) => s + c.sizes.reduce((a, x) => a + x.quantity, 0), 0);

/** Build the new `colors` for one old product. Returns { colors, notes[], manual } */
export function convert(d) {
  const notes = [];
  const legacyImages = uniq((d.images || []).map(str).filter(Boolean));
  const legacySizes = uniq((d.sizes || []).map(str).filter(Boolean));
  const oldTotal = Math.max(0, parseInt(d.quantity, 10) || 0);

  let colors = (d.colors || []).map((c) => ({ ...c }));

  // 1) No colors at all → one default color that owns the product's main image (flagged for review)
  if (colors.length === 0) {
    if (legacyImages.length === 0) {
      return { colors: null, notes: ['no colors and no images — cannot build a color'], manual: true };
    }
    colors = [{ name: DEFAULT_COLOR.name, value: DEFAULT_COLOR.value, image: legacyImages[0], available: true }];
    notes.push('had no colors: created a default color using the first old image');
  }

  // 2) Every color needs an image (it was required before, but check anyway)
  const missingImage = colors.find((c) => !str(c.image));
  if (missingImage) {
    return { colors: null, notes: [`color "${missingImage.name}" has no image`], manual: true };
  }

  const alreadyHaveSizes = colors.filter((c) => Array.isArray(c.sizes) && c.sizes.length > 0);
  const needSizes = colors.filter((c) => !(Array.isArray(c.sizes) && c.sizes.length > 0));

  if (needSizes.length > 0) {
    const sizesForColor = legacySizes.length ? legacySizes : [ONE_SIZE];
    if (!legacySizes.length) notes.push(`product had no sizes: used "${ONE_SIZE}"`);

    // Stock: only distribute the old global number when NO color has real per-size stock yet
    const canDistribute = alreadyHaveSizes.length === 0 && STOCK_MODE === 'even';
    const targetColors = needSizes.filter((c) => c.available !== false);
    const cells = targetColors.length * sizesForColor.length;
    const base = canDistribute && cells > 0 ? Math.floor(oldTotal / cells) : 0;
    let remainder = canDistribute && cells > 0 ? oldTotal % cells : 0;

    for (const c of needSizes) {
      c.sizes = sizesForColor.map((size) => {
        let quantity = 0;
        if (canDistribute && c.available !== false) {
          quantity = base + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
        }
        return { size, quantity };
      });
    }
    notes.push(
      canDistribute
        ? `old stock ${oldTotal} split evenly over ${cells} color/size cells — REVIEW the real numbers`
        : 'new cells started at 0 — enter the real stock'
    );
  }

  const clean = colors.map((c) => ({
    ...(c._id ? { _id: c._id } : { _id: new mongoose.Types.ObjectId() }),
    name: str(c.name) || DEFAULT_COLOR.name,
    value: str(c.value),
    image: str(c.image),
    available: c.available !== false,
    sizes: c.sizes.map((s) => ({ size: str(s.size), quantity: Math.max(0, parseInt(s.quantity ?? s.stock, 10) || 0) })),
  }));

  // sanity: hex value, no duplicate colors / sizes
  const seen = new Set();
  for (const c of clean) {
    if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(c.value)) return { colors: null, notes: [`color "${c.name}" has an invalid value "${c.value}"`], manual: true };
    if (seen.has(c.value.toLowerCase())) return { colors: null, notes: [`duplicate color value ${c.value}`], manual: true };
    seen.add(c.value.toLowerCase());
    const sz = new Set();
    for (const s of c.sizes) {
      if (!s.size || sz.has(s.size.toUpperCase())) return { colors: null, notes: [`bad/duplicate size in color "${c.name}"`], manual: true };
      sz.add(s.size.toUpperCase());
    }
  }

  const usedImages = new Set(clean.map((c) => c.image));
  const unlinked = legacyImages.filter((img) => !usedImages.has(img));
  if (unlinked.length) notes.push(`${unlinked.length} old gallery image(s) belong to no color — kept in the database, not linked`);

  const needsReview = needSizes.length > 0 || colors.length === 0;
  return { colors: clean, notes, manual: false, unlinked, needsReview };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing in .env');
  await mongoose.connect(process.env.MONGODB_URI);
  const products = mongoose.connection.collection('products');
  console.log(`Connected. Mode: ${ROLLBACK_FILE ? 'ROLLBACK' : CLEANUP ? 'CLEANUP' : APPLY ? 'APPLY' : 'DRY RUN'}  | stock-mode: ${STOCK_MODE}`);

  // ───────────────────────── ROLLBACK ─────────────────────────
  if (ROLLBACK_FILE) {
    const backup = JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
    let restored = 0;
    for (const doc of backup.products) {
      const _id = new mongoose.Types.ObjectId(doc._id);
      const set = {};
      const unset = { migratedV5: '', needsStockReview: '' };
      for (const k of ['colors', 'quantity', 'images', 'sizes']) {
        if (doc[k] === undefined) unset[k] = ''; else set[k] = reviveIds(k, doc[k]);
      }
      await products.updateOne({ _id }, { ...(Object.keys(set).length ? { $set: set } : {}), $unset: unset });
      restored += 1;
    }
    console.log(`Rolled back ${restored} product(s) from ${ROLLBACK_FILE}`);
    return;
  }

  // ───────────────────────── CLEANUP ─────────────────────────
  if (CLEANUP) {
    const filter = { migratedV5: { $exists: true }, $or: [{ images: { $exists: true } }, { sizes: { $exists: true } }] };
    const n = await products.countDocuments(filter);
    console.log(`${n} migrated product(s) still hold the old images[]/sizes[] fields.`);
    if (!APPLY) { console.log('Dry run — add --apply to remove them. (Take a mongodump first!)'); return; }
    const r = await products.updateMany(filter, { $unset: { images: '', sizes: '' } });
    console.log(`Removed old fields from ${r.modifiedCount} product(s).`);
    return;
  }

  // ───────────────────────── MIGRATE ─────────────────────────
  const cursor = products.find({});
  const report = { total: 0, alreadyNew: 0, converted: [], manual: [], deletedSkipped: 0 };
  const toWrite = [];

  for await (const d of cursor) {
    report.total += 1;
    const legacyFieldsPresent = (d.images && d.images.length) || (d.sizes && d.sizes.length);
    if (hasNewShape(d) && !legacyFieldsPresent) { report.alreadyNew += 1; continue; }
    if (hasNewShape(d) && legacyFieldsPresent) {
      // Already migrated or created in v5: only report extra legacy images, nothing to convert.
      report.alreadyNew += 1;
      continue;
    }

    const res = convert(d);
    if (res.manual) {
      report.manual.push({ _id: String(d._id), title: d.title, status: d.status, reason: res.notes.join('; ') });
      continue;
    }
    const newQuantity = totalOf(res.colors);
    report.converted.push({
      _id: String(d._id), title: d.title, status: d.status,
      oldQuantity: d.quantity ?? 0, newQuantity,
      needsStockReview: res.needsReview, notes: res.notes, unlinkedImages: res.unlinked,
    });
    toWrite.push({ d, res, newQuantity });
  }

  console.log('\n──────── REPORT ────────');
  console.log(`Products scanned           : ${report.total}`);
  console.log(`Already in the new format  : ${report.alreadyNew}`);
  console.log(`To convert                 : ${report.converted.length}`);
  console.log(`Need MANUAL review (skipped): ${report.manual.length}`);
  report.manual.forEach((m) => console.log(`  ✋ ${m._id}  ${m.title}  → ${m.reason}`));
  const reviewCount = report.converted.filter((c) => c.needsStockReview).length;
  console.log(`Converted but stock needs review: ${reviewCount}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve('scripts', 'backups');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `migration-v5-report-${stamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportFile}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing was changed. Re-run with --apply to migrate.'); return; }
  if (toWrite.length === 0) { console.log('Nothing to migrate.'); return; }

  // Backup of every product about to change (used by --rollback)
  const backupFile = path.join(reportDir, `products-v5-backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), products: toWrite.map((w) => w.d) }, null, 2));
  console.log(`Backup saved: ${backupFile}  (undo with --rollback ${path.relative(process.cwd(), backupFile)})`);

  let done = 0;
  for (const { d, res, newQuantity } of toWrite) {
    await products.updateOne(
      { _id: d._id },
      {
        $set: {
          colors: res.colors,
          quantity: newQuantity,
          needsStockReview: res.needsReview,
          migratedV5: { at: new Date(), stockMode: STOCK_MODE },
        },
      }
    );
    done += 1;
  }
  console.log(`Migrated ${done} product(s). Old images[]/sizes[] fields were NOT removed.`);
}

// Restore ObjectIds that JSON turned into plain strings
function reviveIds(key, value) {
  if (key !== 'colors' || !Array.isArray(value)) return value;
  return value.map((c) => (c && c._id ? { ...c, _id: new mongoose.Types.ObjectId(c._id) } : c));
}

// Only run when executed directly (so the conversion rules can also be unit-tested)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .catch((err) => { console.error('Migration failed:', err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
