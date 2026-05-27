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

/** ₹95.0 L / ₹2.50 Cr / ₹50,000 */
export function formatPrice(val) {
  if (val == null || val === '') return '—';
  const n = typeof val === 'number' ? val : parseInt(val, 10);
  if (!n || isNaN(n)) return '—';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
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

/** Validate 10-digit phone; returns { ok, cleaned, error } */
export function validatePhone(raw) {
  const cleaned = String(raw || '').replace(/\D/g, '');
  if (cleaned.length === 0) return { ok: false, cleaned: '', error: 'Required' };
  if (cleaned.length < 10) return { ok: false, cleaned, error: 'Enter 10 digits' };
  return { ok: true, cleaned: cleaned.slice(-10), error: null };
}

// Display order for the stage tabs / columns. The STATUS values themselves
// are unchanged; this is purely how they appear left-to-right in the UI.
// Visit Scheduled + Visit Completed sit before Offer because admin
// triage scans visit-related queues before rebalancing pricing.
// `label` (when set) is what the UI renders — `key` is the DB value.
export const STAGES = [
  { key: 'Unapproved',         color: '#B8860B', bg: '#FFF8E1', adminOnly: true },
  { key: 'Submitted',          color: '#6366F1', bg: '#EEF2FF' },
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
/**
 * Format the Openhouse acquisition price for display next to a submission.
 * Returns { display, tooltip } where display is "Acq ₹145L" (exact match) or
 * "Acq ~₹145L (1500 sqft)" (suggested). Returns null if no acq price.
 *
 * Match is "exact" when submission's sqft equals the matched acq row's sqft.
 * Any difference (or missing submission sqft) renders as "~" prefix + sqft hint.
 */
export function formatAcqPrice(acq_price_lakhs, acq_sqft, submission_sqft) {
  if (acq_price_lakhs == null) return null;
  const priceStr = formatPrice(acq_price_lakhs * 100000);
  const isExact =
    submission_sqft && acq_sqft &&
    Number(submission_sqft) === Number(acq_sqft);
  if (isExact) {
    return {
      display: `Acq ${priceStr}`,
      tooltip: 'Openhouse acquisition price',
    };
  }
  // Suggested price — sqft differs OR submission has no sqft
  const sqftHint = acq_sqft ? ` (${acq_sqft} sqft)` : '';
  const tooltip = submission_sqft && acq_sqft
    ? `Suggested price for ${acq_sqft} sqft (your unit: ${submission_sqft} sqft)`
    : `Suggested price${acq_sqft ? ` for ${acq_sqft} sqft` : ''}`;
  return {
    display: `Acq ~${priceStr}${sqftHint}`,
    tooltip,
  };
}