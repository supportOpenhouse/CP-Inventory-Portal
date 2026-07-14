/**
 * Topbar action that opens the New Ticket modal. Ported from
 * Direct_Inventory's `components/CreateTicketButton.jsx`: renders only the
 * button — the caller (Layout) gates it to the tickets route + admin/manager
 * role. CreateTicketModal fires `tickets:changed` on success, which both the
 * Tickets page list and Layout's pending-count dot already listen for.
 */
import { useState } from 'react';
import CreateTicketModal from './CreateTicketModal.jsx';
import { IconPlus } from '../icons.jsx';

export default function CreateTicketButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        <IconPlus size={15} /> New Ticket
      </button>
      {open && <CreateTicketModal onClose={() => setOpen(false)} />}
    </>
  );
}
