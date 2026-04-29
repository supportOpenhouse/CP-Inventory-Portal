/**
 * Shared formatting helpers used across CP and admin views.
 */

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

/** "Today" / "Yesterday" / "3d ago" / "Apr 10" */
export function timeAgo(d) {
  if (!d) return '';
  const now = new Date();
  const then = new Date(d);
  if (isNaN(then.getTime())) return '';
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

/** "Apr 17, 10:30 AM" */
export function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "30 Apr 2026" — accepts ISO ('2026-04-30') or HTTP-date
 *  ('Thu, 30 Apr 2026 00:00:00 GMT'). Used for date-only fields like
 *  scheduled_date where the time portion is meaningless. */
export function formatDateOnly(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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

export const STAGES = [
  { key: 'Unapproved',         color: '#B8860B', bg: '#FFF8E1', adminOnly: true },
  { key: 'Submitted',          color: '#6366F1', bg: '#EEF2FF' },
  { key: 'Offer Given',        color: '#FF6B2B', bg: '#FFF3ED' },
  { key: 'Visit Scheduled',    color: '#D946EF', bg: '#FDF4FF' },
  { key: 'Visit Completed',    color: '#10B981', bg: '#D1FAE5' },   // green = success
  { key: 'Price Rejected',     color: '#DC2626', bg: '#FEE2E2' },
  { key: 'Duplicate Rejected', color: '#DC2626', bg: '#FEE2E2' },
];

export function stageMeta(key) {
  return STAGES.find((s) => s.key === key) || STAGES[0];
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