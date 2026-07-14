/**
 * Cloudinary helper.
 *
 * Uploads go through our OWN backend (POST /api/media/upload) so the Cloudinary
 * api_secret never reaches the browser and only authenticated users can upload.
 * Read/transform URLs are still built client-side from the cloud name, which is
 * public by design (it already appears in every delivered image URL).
 *
 * Env vars (frontend/.env + Vercel):
 *   VITE_CLOUDINARY_CLOUD_NAME — read/transform URLs only (no secret)
 *   VITE_API_BASE_URL          — backend base, used for the upload POST
 */

import { getToken } from './auth';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export const MAX_PHOTOS = 5;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB (images)
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Video uploads (CP "Share media" → Video). The unsigned preset must allow
// video (resource type Auto/Video) or Cloudinary returns 400.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

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

export function validateVideo(file) {
  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return `Only MP4, MOV, or WebM video allowed. Got ${file.type || 'unknown'}.`;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 100 MB.`;
  }
  return null;
}

/**
 * Upload a file to Cloudinary VIA our backend proxy. The browser POSTs the
 * file to /api/media/upload (auth required); the backend signs and forwards it
 * to Cloudinary. Progress reflects the browser→backend leg (the meaningful
 * "is my file leaving" bar). XHR is used instead of fetch for progress events.
 * @param {File} file
 * @param {(pct: number) => void} onProgress — called with 0..100
 * @param {'image'|'video'} resourceType — default 'image'
 * @returns {Promise<{ publicId: string, secureUrl: string }>}
 */
export function uploadToCloudinary(file, onProgress, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    form.append('resource_type', resourceType);

    xhr.open('POST', `${API_BASE}/media/upload`, true);
    // Send the HttpOnly session cookie; add the Bearer header only when
    // impersonating (getToken() is non-null only in an impersonation tab).
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ publicId: res.publicId, secureUrl: res.secureUrl });
        } else {
          reject(new UploadError(res.error || `Upload failed (${xhr.status})`, 'http_error'));
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
  // submissions.photos has two coexisting formats:
  //   - admin uploads (DetailPanel "+ Photos") store bare publicIds
  //   - CP "Share media" (2026-06-18+) stores full Cloudinary URLs
  // When the value is already a URL, inject the transform into the
  // existing /image/upload/ segment instead of pasting another base URL
  // in front (which would 404 with the blue "?" placeholder).
  if (publicId.startsWith('https://res.cloudinary.com/')) {
    return publicId.replace('/image/upload/', `/image/upload/${transform}/`);
  }
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}

export function thumbnailUrl(publicId, size = 100) {
  return cloudinaryUrl(publicId, `w_${size},h_${size},c_fill,q_auto,f_auto`);
}

export function previewUrl(publicId) {
  return cloudinaryUrl(publicId, 'w_400,h_300,c_fill,q_auto,f_auto');
}
