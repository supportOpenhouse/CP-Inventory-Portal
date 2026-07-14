/**
 * Thin API client. Attaches JWT, parses JSON, throws ApiError on non-2xx.
 */

import { getToken, clearSession } from './auth';

// Idempotent guard so multiple concurrent 401s don't fire reload() many times.
let forceLogoutInFlight = false;

function forceLogoutOnExpiredToken() {
  if (forceLogoutInFlight) return;
  forceLogoutInFlight = true;
  resetCache();  // identity gone — drop the previous user's cached reads
  clearSession();
  // Full reload so AuthContext re-mounts, finds no token, and routes to Login.
  // location.replace() drops the current history entry (no "back" button into
  // the protected page that was 401'ing).
  if (typeof window !== 'undefined' && window.location) {
    window.location.replace(window.location.pathname);
  }
}

// Same-origin by default: prod serves /api via a Vercel rewrite, dev via the
// Vite proxy (see vite.config.js). Both make the session cookie first-party.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

// ── GET cache ──────────────────────────────────────────────────────────────
// Correctness over cleverness: only GETs are cached (in-memory Map keyed by the
// full path+query), and ANY write nukes the whole cache — you never see your own
// edits stale. Cross-user changes are bounded by TTL (or targeted invalidate());
// login/logout resets everything. The deliberate cost is over-invalidation.
let cacheEpoch = 0;
const getCache = new Map();   // path -> { data, expires }
const inflight = new Map();   // path -> Promise<data> (dedupes concurrent GETs, cached or not)

// TTL (seconds) by path prefix — FIRST match wins. No match → 0 → not cached.
const TTL_RULES = [
  ['/tickets/pending-count', 10],   // live nav badge
  ['/tickets', 30],
  ['/me', 0],                        // identity — always fresh
  ['/health', 0],
  ['/comet/', 20],                   // chat state (requests / access / history)
  ['/submissions/stats', 120],
  ['/', 1800],                       // everything else (most reads) — 30 min
];
function ttlFor(path) {
  for (const [prefix, ttl] of TTL_RULES) if (path.startsWith(prefix)) return ttl;
  return 0;
}

// Reads hand out clones so a component can't mutate the shared cached object.
function clone(data) {
  if (data == null || typeof data !== 'object') return data;
  try { return structuredClone(data); } catch { return JSON.parse(JSON.stringify(data)); }
}

// Drop matching cache entries — for cross-user changes caught by polling
// (e.g. a tickets:updated broadcast), which aren't your own writes.
function invalidateCache(prefix) {
  for (const key of getCache.keys()) if (key.startsWith(prefix)) getCache.delete(key);
}

// Bump the epoch and clear everything — writes and auth changes both do this so
// a stale read (or a new identity's view of the old user's data) never survives.
function resetCache() {
  cacheEpoch += 1;
  getCache.clear();
  inflight.clear();
}

async function request(path, { method = 'GET', body = null, auth = true, autoLogout = true, fresh = false, resetCacheOnWrite = true } = {}) {
  // The raw network call.
  const doFetch = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      // getToken() is non-null ONLY in an impersonation tab; normal sessions
      // authenticate via the HttpOnly cookie sent by credentials: 'include'.
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      throw new ApiError(0, { error: `Network error: ${netErr.message}` });
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      // Force-logout on auth failure. auth:false (login/otp) and autoLogout:false
      // (mount bootstrap) legitimately 401 and must NOT trigger it (see
      // forceLogoutOnExpiredToken).
      if (res.status === 401 && auth && autoLogout) forceLogoutOnExpiredToken();
      throw new ApiError(res.status, data || { error: `HTTP ${res.status}` });
    }
    return data;
  };

  // Writes wipe everything on completion — including in-flight GETs, so a fetch
  // fired right after can't piggyback on a pre-write request and render stale.
  // `resetCacheOnWrite: false` opts out for POSTs that don't mutate any cached
  // read (e.g. CometChat user provisioning) — otherwise those would blow the
  // whole cache every time an embedded chat thread mounts.
  if (method !== 'GET') {
    let data;
    try {
      data = await doFetch();
    } catch (err) {
      // The submission detail panel is optimistic now (no re-fetch to reveal an
      // error), so surface admin save failures as a toast. Skip 401 (the logout
      // path handles it). Success toasts are fired by the panels themselves.
      if (path.startsWith('/admin/') && err?.status !== 401) {
        window.dispatchEvent(new CustomEvent('app-toast', {
          detail: { message: `Update failed: ${err?.message || 'please retry'}`, kind: 'err' },
        }));
      }
      throw err;
    }
    if (resetCacheOnWrite) resetCache();
    return data;
  }

  const ttl = ttlFor(path);

  // 1. Cache read (skipped by `fresh`) — return a clone.
  if (!fresh && ttl > 0) {
    const hit = getCache.get(path);
    if (hit && hit.expires > Date.now()) return clone(hit.data);
  }

  // 2. In-flight de-dup: concurrent callers for the same path share one promise.
  const pending = inflight.get(path);
  if (pending) return pending.then(clone);

  // 3. Fire. Snapshot the epoch so a write landing mid-flight can't poison the
  //    cache with pre-write data.
  const started = cacheEpoch;
  const p = doFetch()
    .then((data) => {
      if (ttl > 0 && cacheEpoch === started) {
        getCache.set(path, { data, expires: Date.now() + ttl * 1000 });
      }
      inflight.delete(path);
      return data;
    })
    .catch((err) => { inflight.delete(path); throw err; });
  inflight.set(path, p);
  return p.then(clone);
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
  // App-mount session probe: same as me() but never triggers force-logout/
  // reload, so a logged-out visitor just lands on Login instead of looping.
  meBootstrap: () => request('/me', { autoLogout: false }),
  // Clears the HttpOnly session cookie server-side. auth:false (no header
  // needed; cookie rides along via credentials:'include') and never reloads.
  logout: () => request('/auth/logout', { method: 'POST', auth: false }),

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
  // Accurate per-stage counts over the CP's FULL history (the list caps at 100).
  submissionsStats: () => request('/submissions/stats'),
  // Search the CP's full submission history (server-side, past the 100 cap).
  searchSubmissions: (q) => request(`/submissions/search?q=${encodeURIComponent(q)}`),
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
  // CP shares media on a Submitted listing (Cloudinary refs already uploaded
  // client-side). payload: { photos: [public_id], videos: [{public_id, url}] }
  shareMedia: (submissionId, payload) =>
    request(`/submissions/${submissionId}/media`, { method: 'POST', body: payload }),
  // CP deletes one of their uploaded videos by Cloudinary public_id.
  deleteVideo: (submissionId, publicId) =>
    request(`/submissions/${submissionId}/media/video`, { method: 'DELETE', body: { public_id: publicId } }),
  // RMs in the submission's city — for the "Book visit" RM dropdown.
  getRmOptions: (submissionId) =>
    request(`/submissions/${submissionId}/rm-options`),
  // CP requests a visit slot. payload: { date, slot, rm_id }
  bookVisit: (submissionId, payload) =>
    request(`/submissions/${submissionId}/book-visit`, { method: 'POST', body: payload }),

  // Admin (staff only)
  adminListSubmissions: (filters = {}) =>
    request(`/admin/submissions${buildQuery(filters)}`),
  adminGetSubmission: (id) => request(`/admin/submissions/${id}`),
  adminChangeStatus: (id, status, statusReason = null) =>
    request(`/admin/submissions/${id}/status`, {
      method: 'POST',
      body: statusReason == null ? { status } : { status, status_reason: statusReason },
    }),
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
  // statusReason is required by the backend when status === 'Rejected' (one
  // of REJECTED_REASONS) and ignored/cleared otherwise — same rule as the
  // single-row adminChangeStatus above.
  adminBulkStatus: (ids, status, statusReason = null) =>
    request('/admin/submissions/bulk-status', {
      method: 'POST',
      body: statusReason == null ? { ids, status } : { ids, status, status_reason: statusReason },
    }),
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
  // Pre-flight for Schedule Visit: lists units already in the properties DB
  // for the given society_name (case-insensitive). Used to warn the admin
  // before pushing the visit to the Forms app.
  adminListPropertiesBySociety: (societyName) =>
    request(`/admin/properties/by-society?society_name=${encodeURIComponent(societyName || '')}`),
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
  // Admin-only: mint a short-lived CP-scoped token for "View as CP". Returns { token }.
  adminImpersonateCp: (cpId) =>
    request(`/admin/impersonate-cp/${cpId}`, { method: 'POST' }),
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

  // Admin Panel — staff user management (admin only).
  adminListStaffUsers: () => request('/admin/staff-users'),
  // body: { name, phone, role: 'admin'|'rm'|'manager', email? }
  adminAddStaffUser: (payload) =>
    request('/admin/staff-users', { method: 'POST', body: payload }),
  // source: 'cp' | 'rm'.  fields: { role?, is_active? }
  adminPatchStaffUser: (source, id, fields) =>
    request(`/admin/staff-users/${source}/${id}`, { method: 'PATCH', body: fields }),
  adminForceLogoutUser: (source, id) =>
    request(`/admin/staff-users/${source}/${id}/force-logout`, { method: 'POST' }),
  adminForceLogoutAll: () =>
    request('/admin/staff-users/force-logout-all', { method: 'POST' }),

  // Tickets (staff only; admin/manager create, rm replies).
  ticketsList: (filters = {}) => request(`/tickets${buildQuery(filters)}`),
  ticketsPendingCount: () => request('/tickets/pending-count'),
  ticketGet: (id) => request(`/tickets/${id}`),
  // payload: { title, summary?, submission_id? | rm_id? }
  ticketCreate: (payload) => request('/tickets', { method: 'POST', body: payload }),
  ticketReply: (id, body) => request(`/tickets/${id}/reply`, { method: 'POST', body: { body } }),
  ticketClose: (id) => request(`/tickets/${id}/close`, { method: 'POST' }),
  ticketReopen: (id) => request(`/tickets/${id}/reopen`, { method: 'POST' }),

  // Activity Log — admin-only feed of all mutations across the dashboard.
  // Filters: { action, category, actor_email, actor_name, search, date_from, date_to, page, page_size }
  adminListActivityLog: (filters = {}) =>
    request(`/admin/activity-log${buildQuery(filters)}`),
  // Distinct values for the filter dropdowns. Computed over the whole table,
  // not the current filter set (same anti-narrowing rule as the facet dropdowns).
  adminListActivityLogFacets: () => request('/admin/activity-log/facets'),

  // Chat (CometChat) — backend provisions the CometChat user, mints login
  // tokens, and proxies/logs sends. Paths mount under /api/comet.
  // Provisioning POSTs — they don't mutate any cached read, so they must NOT
  // wipe the GET cache (they fire on every chat mount / detail open).
  getCometAuthToken: () => request('/comet/auth-token', { method: 'POST', resetCacheOnWrite: false }),
  cometEnsureCpUser: (cpId) => request('/comet/ensure-user', { method: 'POST', body: { cp_id: cpId }, resetCacheOnWrite: false }),
  cometBroadcast: (payload) => request('/comet/broadcast', { method: 'POST', body: payload }),
  cometRequestChat: () => request('/comet/request-chat', { method: 'POST' }),
  cometSend: ({ cp_id = null, text }) => request('/comet/send', { method: 'POST', body: { cp_id, text } }),
  cometHistory: (cpId) => request(`/comet/history?cp_id=${cpId}`),
  cometListRequests: () => request('/comet/requests'),
  cometAccessStatus: (cpIds) => request(`/comet/access?cp_ids=${cpIds.join(',')}`),
  cometEnableCp: (cpId) => request('/comet/enable', { method: 'POST', body: { cp_id: cpId } }),
  cometDisableCp: (cpId) => request('/comet/disable', { method: 'POST', body: { cp_id: cpId } }),

  // Health
  health: () => request('/health', { auth: false }),

  // Cache controls: invalidate(prefix) drops matching cached GETs (for changes
  // caught by polling, not your own writes); resetCache() wipes all (auth
  // change). Your own writes already clear the cache automatically.
  invalidate: (prefix) => invalidateCache(prefix),
  resetCache,
};

/**
 * CSV export needs the browser to follow a blob download, so it builds its own
 * fetch instead of going through request(). Auth rides the HttpOnly cookie
 * (credentials: 'include'); the Authorization header is added only in an
 * impersonation tab, where getToken() returns the per-tab Bearer token.
 */
export async function downloadAdminCsv(filters = {}) {
  const token = getToken();
  const qs = buildQuery(filters);
  const res = await fetch(`${API_BASE}/admin/submissions.csv${qs}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401) forceLogoutOnExpiredToken();
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