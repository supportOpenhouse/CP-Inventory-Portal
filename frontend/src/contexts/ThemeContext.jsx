import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext(null);
const KEY = 'oh_theme';

// Curtain directions for the theme swap. Picked at random each toggle so the
// flip doesn't feel mechanical; the CSS keyframes live in styles.css keyed off
// data-theme-sweep.
const SWEEPS = ['ltr', 'rtl', 'ttb', 'btt'];

function initialTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // Default to light regardless of the OS preference; a user's explicit
  // toggle is still remembered via localStorage.
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  // useLayoutEffect, not useEffect: `toggle` below drives this through
  // flushSync inside a view-transition callback, which must see the attribute
  // applied synchronously. A passive effect lands after paint — the transition
  // would snapshot the OLD colours and the curtain would reveal nothing.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    // Keep the mobile browser's top strip in step with the theme. It was pinned
    // to the brand orange in index.html, which left an orange bar above a dark
    // app. Read the live `--bg` rather than repeating hex here: getComputedStyle
    // flushes the style recalc from the attribute set above, so this always
    // lands on the theme's real page colour and can't drift from the tokens.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
  }, [theme]);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    const apply = () => setTheme(next);

    const root = document.documentElement;
    // No View Transitions support (or the user asked for less motion) — just
    // flip. The curtain is decoration; the theme change itself must not depend
    // on it.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof document.startViewTransition !== 'function') {
      apply();
      return;
    }

    root.dataset.themeSweep = SWEEPS[Math.floor(Math.random() * SWEEPS.length)];
    // flushSync forces React to commit before startViewTransition's callback
    // returns, which is how the API knows what the "after" state looks like.
    const vt = document.startViewTransition(() => flushSync(apply));
    // Clear the direction once done so a stale value can't style an unrelated
    // transition later. `finished` rejects if the transition is skipped
    // (e.g. a second toggle interrupts it), hence the catch.
    vt.finished.catch(() => {}).finally(() => { delete root.dataset.themeSweep; });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
