// Private storage for payment receipts. Receipts can hold financial and contact details, so:
//  - they are uploaded as Cloudinary "authenticated" assets (no public URL works),
//  - only the publicId is stored, and it is never selected by default,
//  - admins view them through an authorized endpoint that fetches a signed URL server-side
//    and streams the bytes back with no-store headers. No Cloudinary URL ever reaches a browser.
import cloudinary from '../config/cloudinary.js';

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

// Check the real file signature instead of trusting the client's mimetype.
export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export const uploadReceipt = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'mirvory/receipts',
        resource_type: 'image',
        type: 'authenticated',
        // Cap the size and strip embedded metadata (GPS, device info).
        transformation: [{ width: 1600, crop: 'limit', quality: 'auto', flags: 'strip_profile' }],
        invalidate: true,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });

// Server-side only. Never return this URL to a client.
export const signedReceiptUrl = (publicId) =>
  cloudinary.url(publicId, { resource_type: 'image', type: 'authenticated', sign_url: true, secure: true });

export async function fetchReceiptBytes(publicId) {
  const r = await fetch(signedReceiptUrl(publicId));
  if (!r.ok) throw new Error(`receipt fetch failed (${r.status})`);
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'image/jpeg' };
}

export const deleteReceipt = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true });
