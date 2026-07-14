import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Segmented toggle with a sliding indicator that glides to the active option
 * (Board/Table, Dots/Heat map, Today/This week, …). The
 * thumb is measured from the active button so it works with any button widths.
 *
 * Props:
 *   options:  [{ value, label }]  — label may be any node.
 *   value / onChange              — controlled selection.
 *   bare                          — drop the grey container fill + outline
 *                                   (used on Home); the thumb becomes a soft
 *                                   brand pill instead of a raised surface one.
 *   className / style             — passthrough to the container.
 */
export default function SegToggle({ options, value, onChange, bare = false, className = '', style }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return undefined;
    const measure = () => {
      const el = container.querySelector('button.on');
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const bRect = el.getBoundingClientRect();
      const left = bRect.left - cRect.left;
      const width = bRect.width;
      setThumb((prev) => (prev.left === left && prev.width === width && prev.ready ? prev : { left, width, ready: true }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [value, options]);

  return (
    <div ref={ref} className={`seg-toggle${bare ? ' seg-bare' : ''}${className ? ` ${className}` : ''}`} style={style} role="tablist">
      <span
        className="seg-thumb"
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width, opacity: thumb.ready ? 1 : 0 }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
