/**
 * Animated swirl backdrop for the Login page.
 *
 * A smooth swirl field reduced to two colours by 4x4 ordered (Bayer)
 * dithering, which is what gives the chunky white-pixel-on-orange look.
 * Drawn into an ImageData at GRID resolution (one buffer pixel per visible
 * block) and blown up by CSS with `image-rendering: pixelated` — so the cost
 * is ~80k pixel writes a frame at 1080p instead of ~80k fillRect calls.
 *
 * No dependency: a WebGL shader package for one decorative login backdrop
 * would be a new runtime dep on every page load, and canvas 2D gets the same
 * effect here.
 *
 * Colours come from the live --brand tokens so the backdrop follows the
 * palette instead of hardcoding a second copy of the orange.
 */
import { useEffect, useRef } from 'react';

const PX = 5;        // block size in CSS px — bigger = chunkier, cheaper
const ARMS = 3;      // number of swirl arms
const TWIST = 9;     // how fast the arms wind with radius
const SPEED = 0.55;  // radians/sec of rotation
const FADE = 1.35;   // radial falloff — pixels thin out toward the edges

// Bayer 4x4, normalised to (0,1). Ordered dithering: compare the field value
// against a fixed per-position threshold instead of rounding, which turns a
// smooth gradient into a stable pixel pattern rather than noise.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  .map((v) => (v + 0.5) / 16);

// "#FF6B2B" -> [255, 107, 43]. Falls back when the token is missing or the
// canvas mounts before styles resolve.
function rgb(varName, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function SwirlBackground() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return undefined;

    const back = rgb('--brand', [255, 107, 43]);
    const deep = rgb('--brand-strong', [232, 90, 31]);

    let img = null;
    let w = 0;
    let h = 0;
    // Per-cell angle and radius never change while the size holds, and atan2 /
    // sqrt are the expensive part — compute them once per resize, not 60x a
    // second. Leaves one Math.sin per cell per frame.
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
    };

    const draw = (t) => {
      const d = img.data;
      for (let y = 0, i = 0; y < h; y += 1) {
        const brow = (y & 3) * 4;
        for (let x = 0; x < w; x += 1, i += 1) {
          const r = rad[i];
          // The swirl: arms rotate with time, and winding with radius is what
          // bends them into a spiral rather than a spinning starburst.
          const v = 0.5 + 0.5 * Math.sin(ang[i] * ARMS + r * TWIST - t);
          // Thin the pattern out toward the corners so the card sits on a
          // calmer field and the text stays readable.
          const lit = v * Math.max(0, 1 - r * FADE) > BAYER[brow + (x & 3)];
          const p = i * 4;
          if (lit) {
            d[p] = 255; d[p + 1] = 255; d[p + 2] = 255;
          } else {
            // Unlit cells shade from brand orange at the centre to the deeper
            // orange outward, so the plate isn't a flat slab of one colour.
            const k = Math.min(1, r);
            d[p] = back[0] + (deep[0] - back[0]) * k;
            d[p + 1] = back[1] + (deep[1] - back[1]) * k;
            d[p + 2] = back[2] + (deep[2] - back[2]) * k;
          }
          d[p + 3] = 255;
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
