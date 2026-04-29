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
  sendOtp: (phone) =>
    request('/auth/send-otp', { method: 'POST', body: { phone }, auth: false }),
  verifyOtp: (phone, code) =>
    request('/auth/verify-otp', { method: 'POST', body: { phone, code }, auth: false }),
  me: () => request('/me'),

  // Public lookups
  getRmContacts: () => request('/rm-contacts', { auth: false }),
  // Auth'd: returns the CP's own assigned RM (via channel_partners.rm -> rms)
  getMyRm: () => request('/my-rm'),
  getFaqs: () => request('/faqs', { auth: false }),

  // Societies
  searchSocieties: (search = '', limit = 20, city = '') => {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    qs.set('limit', String(limit));
    if (city) qs.set('city', city);
    return request(`/societies?${qs.toString()}`);
  },
  getSocietyInventory: (id) => request(`/societies/${id}/inventory`),

  // Submissions (CP side)
  listSubmissions: () => request('/submissions'),
  createSubmission: (payload) =>
    request('/submissions', { method: 'POST', body: payload }),
  checkDuplicate: (payload) =>
    request('/check-duplicate', { method: 'POST', body: payload }),
  // CP accepts or rejects a pending counter offer (optional comment)
  counterOfferResponse: (submissionId, action /* 'accept' | 'reject' */, comment = '') =>
    request(`/submissions/${submissionId}/counter-offer-response`, {
      method: 'POST', body: { action, comment },
    }),
  // Timeline for a CP's own submission (detail modal)
  listMySubmissionEvents: (submissionId) =>
    request(`/submissions/${submissionId}/events`),

  // Admin (staff only)
  adminListSubmissions: (filters = {}) =>
    request(`/admin/submissions${buildQuery(filters)}`),
  adminGetSubmission: (id) => request(`/admin/submissions/${id}`),
  adminChangeStatus: (id, status) =>
    request(`/admin/submissions/${id}/status`, { method: 'POST', body: { status } }),
  adminAddComment: (id, text) =>
    request(`/admin/submissions/${id}/comment`, { method: 'POST', body: { text } }),
  adminUpdateSubmission: (id, fields) =>
    request(`/admin/submissions/${id}`, { method: 'PATCH', body: fields }),
  adminDeleteSubmission: (id) =>
    request(`/admin/submissions/${id}`, { method: 'DELETE' }),
  adminGetCpHistory: (cpId) =>
    request(`/admin/cp/${cpId}/submissions`),
  adminListRms: () => request('/admin/rms'),
  // Admin-only: change a CP's permanent RM (channel_partners.rm_id)
  // rmId may be null to unassign.
  adminSetCpRm: (cpId, rmId) =>
    request(`/admin/channel-partners/${cpId}/rm`, {
      method: 'PATCH',
      body: { rm_id: rmId },
    }),
  adminBulkStatus: (ids, status) =>
    request('/admin/submissions/bulk-status', { method: 'POST', body: { ids, status } }),
  adminListCpNotes: (cpId) => request(`/admin/cp/${cpId}/notes`),
  adminAddCpNote: (cpId, text) =>
    request(`/admin/cp/${cpId}/notes`, { method: 'POST', body: { text } }),
  adminDeleteCpNote: (noteId) =>
    request(`/admin/cp/notes/${noteId}`, { method: 'DELETE' }),
  // Admin sends a counter offer; price is in LAKHS (converted server-side)
  adminSendCounterOffer: (submissionId, priceLakhs) =>
    request(`/admin/submissions/${submissionId}/counter-offer`, {
      method: 'POST', body: { price_lakhs: priceLakhs },
    }),
  // Forms-app integration — Schedule Visit
  adminListFieldExecs: () => request('/admin/field-execs'),
  adminScheduleVisit: (submissionId, payload) =>
    request(`/admin/submissions/${submissionId}/schedule-visit`, {
      method: 'POST', body: payload,
    }),
  // Bulk variant: payload = { schedule_date, schedule_time, items: [{id, field_exec_id}, ...] }
  // Cap of 20 items per request enforced server-side.
  adminBulkScheduleVisit: (payload) =>
    request('/admin/submissions/bulk-schedule-visit', {
      method: 'POST', body: payload,
    }),

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