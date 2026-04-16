/**
 * Thin API client. Attaches the JWT (if present) to every request,
 * parses JSON, and throws a consistent ApiError on non-2xx responses.
 */

import { getToken } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    throw new ApiError(0, { error: `Network error: ${netErr.message}` });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(res.status, data || { error: `HTTP ${res.status}` });
  }
  return data;
}

/* Convenience wrappers by endpoint — one per backend route.
   Add new endpoints here as they come online in later steps. */

export const api = {
  // Auth (public)
  phoneLogin: (phone) =>
    request('/auth/phone-login', { method: 'POST', body: { phone }, auth: false }),

  // Current user (requires auth)
  me: () => request('/me'),

  // Public lookups
  getRmContacts: () => request('/rm-contacts', { auth: false }),
  getFaqs: () => request('/faqs', { auth: false }),

  // Societies (auth)
  searchSocieties: (search = '', limit = 20) =>
    request(`/societies?search=${encodeURIComponent(search)}&limit=${limit}`),
  getSocietyInventory: (id) => request(`/societies/${id}/inventory`),

  // Submissions (auth)
  listSubmissions: () => request('/submissions'),
  createSubmission: (payload) =>
    request('/submissions', { method: 'POST', body: payload }),
  checkDuplicate: (payload) =>
    request('/check-duplicate', { method: 'POST', body: payload }),

  // Health (debugging)
  health: () => request('/health', { auth: false }),
};
