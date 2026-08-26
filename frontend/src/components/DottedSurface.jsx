/**
 * Animated dotted surface — a grid of three.js points rippling on two sine
 * waves, seen in perspective. Used as the Login page backdrop.
 *
 * Ported from the supplied `dotted-surface.tsx` with four changes forced by
 * this codebase, each noted at the point it matters:
 *   - JSX, not TSX (no TypeScript here).
 *   - A CSS class instead of Tailwind utilities + cn().
 *   - `color` prop instead of next-themes: the login plate is a dark orange
 *     gradient in BOTH themes, so the original's theme-driven black dots would
 *     be invisible there regardless of the user's setting.
 *   - Sized to its CONTAINER rather than the window, so it can't overflow the
 *     panel it sits in.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const SEPARATION = 150;
const AMOUNT_X = 40;
const AMOUNT_Y = 60;

export default function DottedSurface({
  size = 8,
  opacity = 0.8,
  color = '#ffffff',
  sizeAttenuation = true,
  className = '',
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 2000, 10000);

    const rect = container.getBoundingClientRect();
    let w = rect.width || window.innerWidth;
    let h = rect.height || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(60, w / h, 1, 10000);
    camera.position.set(0, 355, 1220);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    // Cap at 2: the grid is 2400 points over a full viewport, and a 3x retina
    // buffer costs a lot of fill rate for no visible gain on dots this small.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(scene.fog.color, 0);
    container.appendChild(renderer.domElement);

    const positions = [];
    for (let ix = 0; ix < AMOUNT_X; ix += 1) {
      for (let iy = 0; iy < AMOUNT_Y; iy += 1) {
        positions.push(
          ix * SEPARATION - (AMOUNT_X * SEPARATION) / 2,
          0, // animated below
          iy * SEPARATION - (AMOUNT_Y * SEPARATION) / 2,
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Flat material colour rather than the original's vertexColors buffer: it
    // wrote the SAME colour to all 2400 vertices, so a per-vertex attribute
    // bought nothing but memory. (It also pushed 0-255 values into a channel
    // three.js reads as 0-1, which clamped every dot to pure white.)
    const material = new THREE.PointsMaterial({
      size,
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      sizeAttenuation,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Mutable holder, NOT the id captured at setup. The original stored the
    // frame id once in a ref and cancelled that on unmount — but the id changes
    // every frame, so it cancelled a long-dead frame and the loop kept running
    // (and kept rendering into a detached canvas) forever after unmount.
    let raf = 0;
    let count = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const attr = geometry.attributes.position;
      const arr = attr.array;
      let i = 0;
      for (let ix = 0; ix < AMOUNT_X; ix += 1) {
        for (let iy = 0; iy < AMOUNT_Y; iy += 1) {
          arr[i * 3 + 1] = Math.sin((ix + count) * 0.3) * 50
            + Math.sin((iy + count) * 0.5) * 50;
          i += 1;
        }
      }
      attr.needsUpdate = true;
      renderer.render(scene, camera);
      count += 0.1;
    };

    // Respect the OS setting — a full-viewport animation is what this is for.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      renderer.render(scene, camera);
    } else {
      animate();
    }

    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      w = r.width || w;
      h = r.height || h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (still) renderer.render(scene, camera);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      // Frees the WebGL context. Browsers cap live contexts (~16), and without
      // this every login → logout → login cycle would leak one.
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [size, opacity, color, sizeAttenuation]);

  return <div ref={containerRef} className={`dotted-surface${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
