/**
 * Cloudinary direct-browser upload helper.
 * Uploads a single File to the configured unsigned preset.
 * Reports progress via callback. Returns the uploaded asset's public_id + secure_url.
 *
 * Env vars (must be set in frontend/.env and Vercel):
 *   VITE_CLOUDINARY_CLOUD_NAME     — e.g. "openhouse"
 *   VITE_CLOUDINARY_UPLOAD_PRESET  — e.g. "cp_unit_photos"
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export const MAX_PHOTOS = 5;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class UploadError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Only JPG, PNG, or WebP allowed. Got ${file.type || 'unknown'}.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`;
  }
  return null;
}

/**
 * Upload a file to Cloudinary using the unsigned preset.
 * @param {File} file
 * @param {(pct: number) => void} onProgress — called with 0..100
 * @returns {Promise<{ publicId: string, secureUrl: string }>}
 */
export function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      reject(new UploadError('Cloudinary not configured. Check env vars.', 'not_configured'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', UPLOAD_PRESET);

    xhr.open('POST', url, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ publicId: res.public_id, secureUrl: res.secure_url });
        } else {
          reject(new UploadError(res.error?.message || `Upload failed (${xhr.status})`, 'http_error'));
        }
      } catch {
        reject(new UploadError('Upload failed (invalid response)', 'parse_error'));
      }
    };

    xhr.onerror = () => reject(new UploadError('Network error during upload', 'network_error'));
    xhr.onabort = () => reject(new UploadError('Upload cancelled', 'aborted'));

    xhr.send(form);
  });
}

/**
 * Build a Cloudinary URL with on-the-fly transformations.
 * @param {string} publicId
 * @param {string} transform — e.g. "w_400,h_300,c_fill,q_auto" or "w_100,h_100,c_fill"
 */
export function cloudinaryUrl(publicId, transform = 'q_auto,f_auto') {
  if (!publicId) return '';
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}

export function thumbnailUrl(publicId, size = 100) {
  return cloudinaryUrl(publicId, `w_${size},h_${size},c_fill,q_auto,f_auto`);
}

export function previewUrl(publicId) {
  return cloudinaryUrl(publicId, 'w_400,h_300,c_fill,q_auto,f_auto');
}