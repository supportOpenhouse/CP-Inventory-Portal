/**
 * Thin API client. Attaches JWT, parses JSON, throws ApiError on non-2xx.
 */

import { getToken, clearSession } from './auth';

// Idempotent guard so multiple concurrent 401s don't fire reload() many times.
let forceLogoutInFlight = false;

function forceLogoutOnExpiredToken() {
  if (forceLogoutInFlight) return;
  forceLogoutInFlight = true;
  clearSession();
  // Full reload so AuthContext re-mounts, finds no token, and routes to Login.
  // location.replace() drops the current history entry (no "back" button into
  // the protected page that was 401'ing).
  if (typeof window !== 'undefined' && window.location) {
    window.location.replace(window.location.pathname);
  }
}

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
    // Force-logout on auth failure: a 401 on a request that DID send a token
    // means the token is bad / expired / revoked. Clear session and reload
    // so the user lands on Login instead of staring at a "Token expired"
    // message in the middle of the app. We DON'T trigger this for unauth'd
    // requests (login, send-otp) since those legitimately 401 on bad creds.
    if (res.status === 401 && auth && getToken()) {
      forceLogoutOnExpiredToken();
    }
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

  // Add Inventory on Behalf of CP — RM/Manager/Admin only.
  // Search returns up to 20 CPs. If `city` is given, results are restricted
  // to that city AND the caller's personal CP scope is IGNORED — staff can
  // pick any active CP of the chosen city. Without `city`, falls back to
  // the caller's personal scope.
  adminCpSearch: (q, limit = 20, city = '') => {
    const params = { q, limit };
    if (city) params.city = city;
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/cps?${qs}`);
  },
  // payload mirrors createSubmission body, plus required `target_cp_id`.
  adminCreateSubmissionOnBehalf: (payload) =>
    request('/admin/submissions/on-behalf', {
      method: 'POST', body: payload,
    }),

  // Admin-only: bulk reassign multiple CPs to a different RM.
  // Body: { cp_ids: [int], target_rm_id: int }. Cap of 100 per request.
  // CHANGES THE CP'S PERMANENT RM (channel_partners.rm_id). All of those CPs'
  // listings move to the new RM going forward.
  adminBulkReassignRm: (payload) =>
    request('/admin/cps/bulk-reassign-rm', {
      method: 'POST', body: payload,
    }),

  // Admin-only: per-listing RM override (sets submissions.listing_rm_id).
  // Does NOT touch the CP's permanent rm_id. Use this when an admin wants
  // a specific listing handled by a different RM than the CP's normal one.
  // Body: { submission_ids: [int], target_rm_id: int|null }. null clears the override.
  adminBulkReassignListingRm: (payload) =>
    request('/admin/submissions/bulk-reassign-listing-rm', {
      method: 'POST', body: payload,
    }),
  // Single-listing RM override.
  // Body: { target_rm_id: int|null, update_society_mapping?: bool }
  // When updateSocietyMapping is true (and target_rm_id is not null), the
  // backend also writes society_rm_mappings so future submissions of this
  // listing's society route to the same RM.
  adminSetListingRm: (submissionId, targetRmId, { updateSocietyMapping = false } = {}) =>
    request(`/admin/submissions/${submissionId}/listing-rm`, {
      method: 'PATCH',
      body: {
        target_rm_id: targetRmId,
        update_society_mapping: !!updateSocietyMapping,
      },
    }),

  // External inventory: merged collated_data ("D Data") + properties ("F Data")
  // viewer for the admin "External Data" page. Server-side paginated.
  // Filters: { q, city, type ('D'|'F'|''), page, page_size }
  adminListExternalInventory: (filters = {}) =>
    request(`/admin/external-inventory${buildQuery(filters)}`),

  // Admin Panel — staff user management (admin only).
  adminListStaffUsers: () => request('/admin/staff-users'),
  // body: { name, phone, role: 'admin'|'rm'|'manager', email? }
  adminAddStaffUser: (payload) =>
    request('/admin/staff-users', { method: 'POST', body: payload }),
  // source: 'cp' | 'rm'.  fields: { role?, can_see_oh_properties?, is_active? }
  adminPatchStaffUser: (source, id, fields) =>
    request(`/admin/staff-users/${source}/${id}`, { method: 'PATCH', body: fields }),
  adminForceLogoutUser: (source, id) =>
    request(`/admin/staff-users/${source}/${id}/force-logout`, { method: 'POST' }),
  adminForceLogoutAll: () =>
    request('/admin/staff-users/force-logout-all', { method: 'POST' }),

  // WhatsApp messages (inbound CP replies + outbound reminders).
  // Threads list and per-thread / per-submission detail views.
  adminListWhatsAppThreads: (filters = {}) =>
    request(`/admin/whatsapp/threads${buildQuery(filters)}`),
  adminGetWhatsAppThread: (phone) =>
    request(`/admin/whatsapp/threads/${encodeURIComponent(phone)}`),
  adminGetSubmissionWhatsApp: (submissionId) =>
    request(`/admin/submissions/${submissionId}/whatsapp`),
  // Free-text WhatsApp reply (24h customer-service window only — outside
  // that window WhatsApp policy forces template messages and Interakt
  // returns an error). The backend persists the outbound row only on a
  // successful Interakt 2xx.
  adminSendWhatsAppMessage: (phone, message) =>
    request(`/admin/whatsapp/threads/${encodeURIComponent(phone)}/send`, {
      method: 'POST',
      body: { message },
    }),

  // Activity Log — admin-only feed of all mutations across the dashboard.
  // Filters: { action, category, actor_email, actor_name, search, date_from, date_to, page, page_size }
  adminListActivityLog: (filters = {}) =>
    request(`/admin/activity-log${buildQuery(filters)}`),
  // Distinct values for the filter dropdowns. Computed over the whole table,
  // not the current filter set (same anti-narrowing rule as OH Properties).
  adminListActivityLogFacets: () => request('/admin/activity-log/facets'),

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
    if (res.status === 401 && token) forceLogoutOnExpiredToken();
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