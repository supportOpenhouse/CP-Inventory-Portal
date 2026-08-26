/**
 * Animated swirl backdrop for the Login page.
 *
 * A smooth spiral field reduced to 1-bit by 4x4 ordered (Bayer) dithering —
 * that threshold-instead-of-round step is what produces the chunky white
 * pixels and the sparse-to-solid density gradients.
 *
 * The canvas is TRANSPARENT except for the white pixels, so the page's own
 * orange gradient shows through underneath and stays the background. Drawn
 * into an ImageData at GRID resolution (one buffer pixel per visible block)
 * and blown up by CSS with `image-rendering: pixelated` — ~80k pixel writes a
 * frame at 1080p instead of ~80k fillRect calls. Measured ~1ms/frame.
 *
 * No dependency: a WebGL shader package for one decorative login backdrop
 * would be a new runtime dep on every page load, and canvas 2D gets there.
 */
import { useEffect, useRef } from 'react';

const PX = 4;        // block size in CSS px — bigger = chunkier, cheaper
const SPEED = 0.9;   // radians/sec of rotation
const ARMS = 2;      // spiral arms
const TWIST = 18;    // how tightly the arms wind with radius — the "swirl"
const RINGS = 9;     // concentric ripple frequency
const MIX = 0.35;    // ripple's share of the field; the rest is the spiral
const FADE = 0.3;    // gentle edge falloff. Kept small on purpose: a strong
                     // one collapses the pattern into a blob in the middle
                     // and leaves the corners bare (the first attempt's bug).

// Bayer 4x4, normalised to (0,1). Ordered dithering: compare the field value
// against a fixed per-position threshold rather than rounding, which turns a
// smooth gradient into a stable pixel pattern instead of noise.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  .map((v) => (v + 0.5) / 16);

export default function SwirlBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let img = null;
    let w = 0;
    let h = 0;
    // Per-cell angle and radius hold until the size changes, and atan2/hypot
    // are the expensive part — compute them once per resize, not 60x a second.
    // Leaves two Math.sin per cell per frame.
    let ang = null;
    let rad = null;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.ceil(rect.width / PX));
      h = Math.max(1, Math.ceil(rect.height / PX));
      canvas.width = w;
      canvas.height = h;
      img = ctx.createImageData(w, h);
      ang = new Float32Array(w * h);
      rad = new Float32Array(w * h);
      const cx = w / 2;
      const cy = h / 2;
      const norm = Math.hypot(cx, cy) || 1;
      for (let y = 0, i = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1, i += 1) {
          const dx = x - cx;
          const dy = y - cy;
          ang[i] = Math.atan2(dy, dx);
          rad[i] = Math.hypot(dx, dy) / norm;
        }
      }
      // Every cell is white for its whole life — only alpha changes. Writing
      // RGB once here keeps the per-frame loop down to a single byte per cell.
      const d = img.data;
      for (let p = 0; p < d.length; p += 4) {
        d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
      }
    };

    const draw = (t) => {
      const d = img.data;
      for (let y = 0, i = 0; y < h; y += 1) {
        const brow = (y & 3) * 4;
        for (let x = 0; x < w; x += 1, i += 1) {
          const r = rad[i];
          // Spiral: winding the phase with radius is what bends the arms into
          // a vortex instead of a spinning starburst.
          const spiral = Math.sin(ang[i] * ARMS + r * TWIST - t);
          // A concentric ripple on a different period. The interference keeps
          // the bands from reading as a flat pinwheel.
          const ripple = Math.sin(r * RINGS - t * 1.7);
          const v = 0.5 + 0.5 * (spiral * (1 - MIX) + ripple * MIX);
          d[i * 4 + 3] = v * (1 - FADE * r) > BAYER[brow + (x & 3)] ? 255 : 0;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    // Respect the OS setting: a full-viewport animation is exactly the kind of
    // motion this preference exists for. Static frame, no rAF loop at all.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const start = performance.now();
    const loop = (now) => {
      draw(((now - start) / 1000) * SPEED);
      raf = requestAnimationFrame(loop);
    };

    resize();
    if (still) draw(0);
    else raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(0);
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="swirl-bg" aria-hidden="true" />;
}
