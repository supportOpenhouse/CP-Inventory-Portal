/**
 * Saved filter presets — three slots in the Filters modal header.
 *
 * Ordering IS priority. The leftmost preset is the one that auto-applies when
 * the user's local filter store has aged out (12h), so dragging a preset to
 * the front is what promotes it — there's no separate "make this the default"
 * toggle to get out of sync with the order. The backend enforces the same rule
 * (`ufp_priority_is_first`), so the two can't drift.
 *
 * Drag-and-drop is the native HTML5 API: no dnd library for three chips.
 *
 * Props:
 *   doc          — { presets: [slot1, slot2, slot3], sequence: [n,n,n], priority: n|null }
 *                  `presets` is indexed by SLOT (fixed home of a preset);
 *                  `sequence` is the DISPLAY order of those slot numbers.
 *   currentFilters — the filter object a new preset would capture
 *   onApply      — (filters) => void, fired when a chip is clicked
 *   onChange     — (nextDoc) => void, fired on save / delete / reorder
 *   saving       — disables the controls while a PUT is in flight
 */
import { useState } from 'react';
import { IconPlus, IconClose, IconCheck } from '../icons.jsx';

const SLOT_COUNT = 3;

export default function PresetBar({ doc, currentFilters, onApply, onChange, saving = false }) {
  // Slot currently being named, or null. -1 is never used: a save always
  // targets a concrete empty slot.
  const [namingSlot, setNamingSlot] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [dragFrom, setDragFrom] = useState(null); // index into `sequence`

  const sequence = doc.sequence || [1, 2, 3];
  const firstEmptySlot = [1, 2, 3].find((n) => !doc.presets[n - 1]) ?? null;

  // Every mutation re-derives priority from position rather than carrying it
  // separately — that's what keeps it equal to sequence[0] by construction.
  const emit = (presets, seq) => {
    const leadSlot = seq[0];
    onChange({
      presets,
      sequence: seq,
      priority: presets[leadSlot - 1] ? leadSlot : null,
    });
  };

  const saveNew = () => {
    const name = draftName.trim();
    if (!name || namingSlot === null) return;
    const presets = [...doc.presets];
    presets[namingSlot - 1] = { name, filters: currentFilters };
    // A brand-new preset keeps its slot's current position in the order.
    emit(presets, sequence);
    setNamingSlot(null);
    setDraftName('');
  };

  const remove = (slot) => {
    const presets = [...doc.presets];
    presets[slot - 1] = null;
    // If the deleted preset was leading, the next occupied slot inherits
    // priority — emit() re-derives it, so nothing to do here but drop it.
    emit(presets, sequence);
  };

  const drop = (toIdx) => {
    if (dragFrom === null || dragFrom === toIdx) return;
    const seq = [...sequence];
    const [moved] = seq.splice(dragFrom, 1);
    seq.splice(toIdx, 0, moved);
    setDragFrom(null);
    emit(doc.presets, seq);
  };

  return (
    <div className="preset-bar">
      {sequence.map((slot, idx) => {
        const p = doc.presets[slot - 1];
        const isPriority = doc.priority === slot;

        if (namingSlot === slot) {
          return (
            <form
              key={slot}
              className="preset-chip preset-chip-naming"
              onSubmit={(e) => { e.preventDefault(); saveNew(); }}
            >
              <input
                autoFocus
                value={draftName}
                maxLength={40}
                placeholder="Preset name"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setNamingSlot(null); }}
              />
              <button type="submit" className="preset-icon-btn" aria-label="Save preset" disabled={!draftName.trim()}>
                <IconCheck size={13} />
              </button>
            </form>
          );
        }

        if (!p) {
          // Empty slot. Only the first empty one offers a save, so the row
          // doesn't read as three identical "+" buttons.
          if (slot !== firstEmptySlot) return <div key={slot} className="preset-chip preset-chip-blank" />;
          return (
            <button
              key={slot}
              type="button"
              className="preset-chip preset-chip-add"
              disabled={saving}
              onClick={() => { setDraftName(''); setNamingSlot(slot); }}
              title="Save the filters below as a preset"
            >
              <IconPlus size={12} /> Save preset
            </button>
          );
        }

        return (
          <div
            key={slot}
            className={`preset-chip${isPriority ? ' preset-chip-priority' : ''}${dragFrom === idx ? ' preset-chip-dragging' : ''}`}
            draggable={!saving}
            onDragStart={() => setDragFrom(idx)}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(e) => e.preventDefault()} // required, or onDrop never fires
            onDrop={() => drop(idx)}
            title={isPriority
              ? `"${p.name}" is your priority preset — applied automatically when you open Submissions. Drag another preset here to change that.`
              : `Apply "${p.name}". Drag to the leftmost slot to make it your priority preset.`}
          >
            <button type="button" className="preset-chip-apply" onClick={() => onApply(p.filters)} disabled={saving}>
              {isPriority && <span className="preset-star" aria-label="Priority preset">★</span>}
              {p.name}
            </button>
            <button
              type="button"
              className="preset-icon-btn"
              onClick={() => remove(slot)}
              disabled={saving}
              aria-label={`Delete preset ${p.name}`}
            >
              <IconClose size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export { SLOT_COUNT };
