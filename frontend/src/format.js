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

/** Validate 10-digit phone; returns { ok, cleaned, error } */
export function validatePhone(raw) {
  const cleaned = String(raw || '').replace(/\D/g, '');
  if (cleaned.length === 0) return { ok: false, cleaned: '', error: 'Required' };
  if (cleaned.length < 10) return { ok: false, cleaned, error: 'Enter 10 digits' };
  return { ok: true, cleaned: cleaned.slice(-10), error: null };
}

export const STAGES = [
  { key: 'Submitted',       color: '#6366F1', bg: '#EEF2FF' },
  { key: 'Evaluation',      color: '#E8A838', bg: '#FFF8EC' },
  { key: 'Offer Given',     color: '#FF6B2B', bg: '#FFF3ED' },
  { key: 'Visit Scheduled', color: '#D946EF', bg: '#FDF4FF' },
  { key: 'Rejected',        color: '#DC2626', bg: '#FEE2E2' },  // deeper red for emphasis
];

export function stageMeta(key) {
  return STAGES.find((s) => s.key === key) || STAGES[0];
}