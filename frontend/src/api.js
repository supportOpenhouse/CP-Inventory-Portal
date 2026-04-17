/**
 * Thin API client. Attaches JWT, parses JSON, throws ApiError on non-2xx.
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

function buildQuery(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export { API_BASE };

export const api = {
  // Auth
  phoneLogin: (phone) =>
    request('/auth/phone-login', { method: 'POST', body: { phone }, auth: false }),
  me: () => request('/me'),

  // Public lookups
  getRmContacts: () => request('/rm-contacts', { auth: false }),
  getFaqs: () => request('/faqs', { auth: false }),

  // Societies
  searchSocieties: (search = '', limit = 20) =>
    request(`/societies?search=${encodeURIComponent(search)}&limit=${limit}`),
  getSocietyInventory: (id) => request(`/societies/${id}/inventory`),

  // Submissions (CP side)
  listSubmissions: () => request('/submissions'),
  createSubmission: (payload) =>
    request('/submissions', { method: 'POST', body: payload }),
  checkDuplicate: (payload) =>
    request('/check-duplicate', { method: 'POST', body: payload }),

  // Admin (staff only)
  adminListSubmissions: (filters = {}) =>
    request(`/admin/submissions${buildQuery(filters)}`),
  adminGetSubmission: (id) => request(`/admin/submissions/${id}`),
  adminChangeStatus: (id, status) =>
    request(`/admin/submissions/${id}/status`, { method: 'POST', body: { status } }),
  adminAddComment: (id, text) =>
    request(`/admin/submissions/${id}/comment`, { method: 'POST', body: { text } }),

  // Health
  health: () => request('/health', { auth: false }),
};

/**
 * CSV export requires the browser to follow a download. Use this helper:
 * it appends the JWT to the URL via a signed query param approach — but since
 * we use Authorization header, we fetch the CSV as a blob and trigger a download.
 */
export async function downloadAdminCsv(filters = {}) {
  const token = getToken();
  const qs = buildQuery(filters);
  const res = await fetch(`${API_BASE}/admin/submissions.csv${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, { error: 'Failed to export CSV' });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  // Extract filename from Content-Disposition header, fallback to default
  let filename = 'submissions.csv';
  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename="([^"]+)"/);
  if (match) filename = match[1];

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}