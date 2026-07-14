/**
 * Shared formatting helpers used across CP and admin views.
 *
 * Timezone policy:
 *   The backend stores and returns all timestamps in UTC (+00:00). The
 *   frontend always displays them in IST (Asia/Kolkata, +05:30) so users
 *   see times in their local context regardless of browser timezone. All
 *   date/time formatters in this file pin the display TZ to IST.
 */

const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** YYYY-MM-DD string for "today" in IST. Use for date-input `min` values
 *  so the picker doesn't disable today during the IST 00:00–05:30 window
 *  when UTC is still on yesterday's date. */
export function todayInIST() {
  // en-CA locale formats as YYYY-MM-DD which matches <input type="date">.
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TZ });
}

/** "HH:MM" (24-hour) for the current moment in IST. Use for time-input `min`
 *  and past-time checks so a booking dated today can't pick a time already
 *  gone by. Zero-padded so plain string comparison with an input value works. */
export function nowTimeIST() {
  // en-GB + hour12:false yields 00–23 "HH:MM" (midnight = "00:00").
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST_TZ,
  });
}

/** ₹95.0 L / ₹2.50 Cr / ₹50,000 */
export function formatPrice(val) {
  if (val == null || val === '') return '—';
  const n = typeof val === 'number' ? val : parseInt(val, 10);
  if (!n || isNaN(n)) return '—';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

/** BHK config for display. Drops a trailing ".0" ("2.0" -> "2") while keeping
 *  real decimals ("3.5" -> "3.5"). With suffix (default) -> "2 BHK"; without
 *  -> "2". Returns '—' when empty/non-numeric. Tolerates leftover "2 BHK"
 *  strings via parseFloat. */
export function formatBhk(val, suffix = true) {
  const n = parseFloat(val);
  if (Number.isNaN(n)) return '—';
  return suffix ? `${n} BHK` : String(n);
}

/** Format while typing: "9500000" -> "95,00,000" (no ₹ prefix) */
export function formatIndianNumber(val) {
  if (val == null || val === '') return '';
  const digits = String(val).replace(/\D/g, '');
  if (!digits) return '';
  // Indian grouping: last 3, then pairs of 2
  const len = digits.length;
  if (len <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** "Today" / "Yesterday" / "3d ago" / "Apr 10".
 *  Calendar-day diff is computed in IST so the bucket flips at IST
 *  midnight, not the browser's local midnight or UTC midnight. */
export function timeAgo(d) {
  if (!d) return '';
  const now = new Date();
  const then = new Date(d);
  if (isNaN(then.getTime())) return '';
  // Shift each timestamp by the IST offset before flooring to a day, so
  // "Today" / "Yesterday" reflect IST calendar dates regardless of the
  // browser's timezone.
  const istDay = (dt) => Math.floor((dt.getTime() + IST_OFFSET_MS) / 86400000);
  const days = istDay(now) - istDay(then);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: IST_TZ });
}

/** "Apr 17, 10:30 AM" — pinned to IST. */
export function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST_TZ,
  });
}

/** "30 Apr 2026" — accepts ISO ('2026-04-30') or HTTP-date
 *  ('Thu, 30 Apr 2026 00:00:00 GMT'). Used for date-only fields like
 *  scheduled_date where the time portion is meaningless. Pinned to IST
 *  so a UTC midnight timestamp on a given calendar date renders as the
 *  same date in IST (UTC midnight = IST 05:30 same day). */
export function formatDateOnly(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: IST_TZ,
  });
}

/** "13:30" → "1:30 PM"; "09:00" → "9:00 AM"; "00:15" → "12:15 AM"; "12:00" → "12:00 PM".
 *  Accepts HH:MM strings (the format scheduled_time is stored in). Returns the
 *  input unchanged if it doesn't match HH:MM, so the caller is safe with junk. */
export function formatTime12(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return String(t);
  let hh = Number(m[1]);
  const mm = m[2];
  const period = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${period}`;
}

// 8:00 AM -> 8:00 PM in 30-minute steps, for the Schedule Visit time picker.
// value stays 24-hour "HH:MM" (what the backend/Forms app expects); label is
// the 12-hour display via formatTime12.
export const VISIT_TIME_SLOTS = (() => {
  const out = [];
  for (let mins = 7 * 60; mins <= 20 * 60; mins += 30) {
    const value = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    out.push({ value, label: formatTime12(value) });
  }
  return out;
})();

/** Validate 10-digit phone; returns { ok, cleaned, error } */
export function validatePhone(raw) {
  const cleaned = String(raw || '').replace(/\D/g, '');
  if (cleaned.length === 0) return { ok: false, cleaned: '', error: 'Required' };
  if (cleaned.length < 10) return { ok: false, cleaned, error: 'Enter 10 digits' };
  return { ok: true, cleaned: cleaned.slice(-10), error: null };
}

/**
 * Sanitize a phone-input value for onChange: digits only (drops '+', spaces,
 * and any non-digit), capped at 10 digits — or 12 when it starts with the
 * country code '91' (so "91" + 10-digit national number is allowed).
 */
export function sanitizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const max = digits.startsWith('91') ? 12 : 10;
  return digits.slice(0, max);
}

// Display order for the stage tabs / columns. The STATUS values themselves
// are unchanged; this is purely how they appear left-to-right in the UI.
// Visit Scheduled + Visit Completed sit before Offer because admin
// triage scans visit-related queues before rebalancing pricing.
// `label` (when set) is what the UI renders — `key` is the DB value.
export const STAGES = [
  { key: 'Unapproved',         color: '#ffd73b', bg: '#ffd73b', fg: '#1a1a1a', adminOnly: true },
  { key: 'Submitted',          color: '#6366F1', bg: '#EEF2FF' },
  { key: 'Visit Requested',    color: '#8b5cf6', bg: '#F5F3FF' },   // CP booked a slot; awaiting admin scheduling
  { key: 'Visit Scheduled',    color: '#D946EF', bg: '#FDF4FF' },
  { key: 'Visit Completed',    color: '#10B981', bg: '#D1FAE5' },   // green = success
  { key: 'Offer',              label: 'Offer Given', color: '#FF6B2B', bg: '#FFF3ED' },
  { key: 'Closure',            color: '#FF6B2B', bg: '#FFF3ED' },
  { key: 'Price Rejected',     color: '#DC2626', bg: '#FEE2E2' },
  { key: 'Rejected',           color: '#DC2626', bg: '#FEE2E2' },
];

// Stages that are set automatically — never offered as a manual destination
// in the status dropdown, and when a row is already in one of these the
// dropdown is hidden entirely (movement out happens via dedicated flows like
// counter-offer or visit completion). Mirrors AUTO_ONLY_STAGES in backend.
export const AUTO_ONLY_STAGES = new Set(['Visit Scheduled', 'Visit Completed', 'Offer']);

// Sub-categories the admin picks from when setting status='Rejected'. Stored
// on submissions.status_reason and shown as "Rejected (<reason>)" in cards.
export const REJECTED_REASONS = [
  'Cancelled Post Token',
  'Dead - Legal',
  'Dead - Not Interested',
  'Dead - Sold',
  'Duplicacy',
  'Hold',
  'OH Rejected',
  'Seller Rejected',
  'Visit Cancelled',
];

export function stageMeta(key) {
  return STAGES.find((s) => s.key === key) || STAGES[0];
}

/** Display label for a stage key. Falls back to the key itself when no
 *  override is set (most stages render their key directly). Use this any
 *  place the UI needs to show a stage name from a raw status string. */
export function stageLabel(key) {
  const s = STAGES.find((st) => st.key === key);
  return (s && s.label) || key;
}
// Colors for the OH price chip: green when we have a confident match, brown
// for any "Check Price" state so it reads as "needs a human look".
export const OH_MATCH_COLOR = '#16a34a';
export const OH_CHECK_COLOR = '#b45309';

/**
 * Format the Openhouse price for display next to a submission, from the
 * backend's oh_pricing match (see _attach_oh_pricing in admin.py).
 *
 * `s` is the submission row; it reads s.oh_state / s.oh_price / s.oh_area /
 * s.oh_area_off_by. Matching is society + nearest-area only (no BHK/city).
 *
 * Returns null when oh_state is null/absent (pricing data unavailable — render
 * nothing, the old no-match behavior). Otherwise returns:
 *   { state, isMatch, display, color, sub, tooltip }
 * where on a match `display` is the formatted price (e.g. "₹1.04 Cr") and on a
 * non-match `display` is "Check Price" with a short `sub` reason chip.
 */
export function formatOhPrice(s) {
  const state = s && s.oh_state;
  if (!state) return null;

  if (state === 'match') {
    const off = Number(s.oh_area_off_by) || 0;
    const areaNote = s.oh_area
      ? ` ${s.oh_area} sqft${off > 0 ? ` (${off} sqft off)` : ' (exact)'}`
      : '';
    return {
      state,
      isMatch: true,
      display: formatPrice(s.oh_price),   // oh_price is full rupees
      color: OH_MATCH_COLOR,
      sub: null,
      tooltip: `Matched${areaNote}`,
    };
  }

  // Non-match → "Check Price" + reason chip + tooltip.
  let sub, tooltip;
  if (state === 'area_off') {
    const off = Number(s.oh_area_off_by) || 0;
    sub = 'area off';
    tooltip = `Nearest priced area is ${off} sqft off (>50) — open card to verify`;
  } else if (state === 'no_area') {
    sub = 'no area';
    tooltip = "Listing has no area, so it can't be area-matched";
  } else {
    // 'no_match' (and any unknown non-null state)
    sub = 'no match';
    tooltip = 'No OH price for this society';
  }
  return {
    state,
    isMatch: false,
    display: 'Check Price',
    color: OH_CHECK_COLOR,
    sub,
    tooltip,
  };
}