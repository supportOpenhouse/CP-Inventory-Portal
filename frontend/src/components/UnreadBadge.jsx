/**
 * Small red count badge for chat entry icons. Renders nothing at 0.
 * The parent element MUST be position: relative.
 */
export default function UnreadBadge({ count = 0 }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} unread`}
      style={{
        position: 'absolute', top: -5, right: -5,
        minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box',
        borderRadius: 9, background: '#e11d48', color: '#fff',
        fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
        boxShadow: '0 0 0 1.5px rgba(255,255,255,0.85)',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
