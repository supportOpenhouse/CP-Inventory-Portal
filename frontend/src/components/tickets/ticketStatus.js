/**
 * Ticket status badge — shared by the Tickets workspace page and (from P5
 * Task 2 onward) the ticket detail modal. A closed ticket always reads
 * "Closed" regardless of `awaiting`; otherwise `awaiting` says whose turn it
 * is to reply next.
 */
export function ticketBadge(t) {
  if (t.status === 'closed') return { label: 'Closed', cls: 'tk-badge-closed' };
  if (t.awaiting === 'rm') return { label: 'Awaiting RM', cls: 'tk-badge-rm' };
  if (t.awaiting === 'creator') return { label: 'Awaiting review', cls: 'tk-badge-review' };
  return { label: 'Open', cls: 'tk-badge-open' };
}
