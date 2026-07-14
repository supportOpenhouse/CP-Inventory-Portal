import { useRef, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

// Sidebar hierarchy — a page's rank decides the slide direction. Navigating to
// a LOWER page (bigger rank) slides the incoming content in from the right;
// navigating UP slides it in from the left.
const ORDER = ['', 'submissions', 'tickets', 'chat', 'impersonator', 'users', 'logs'];
const rankOf = (pathname) => {
  const i = ORDER.indexOf(pathname.split('/')[1] || '');
  return i === -1 ? ORDER.length : i; // unknown (e.g. /profile) sits after the list
};

export default function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  // Path whose slide-in has completed. While it differs from the live path we
  // animate; the moment the animation ends we settle and DROP the transform —
  // a lingering transform makes this wrapper a containing block that traps
  // position:fixed modals (the Filters / detail dialogs) inside the content
  // area instead of the viewport.
  const settled = useRef(location.pathname);
  const [, bump] = useState(0);

  const animating = location.pathname !== settled.current;
  const dir = rankOf(location.pathname) >= rankOf(settled.current) ? 'fwd' : 'back';

  return (
    <div
      key={location.pathname}
      className={`pt-page${animating ? ` pt-${dir}` : ''}`}
      onAnimationEnd={(e) => {
        // Ignore animationend bubbling up from child page content.
        if (e.target !== e.currentTarget) return;
        settled.current = location.pathname;
        bump((n) => n + 1);
      }}
    >
      {outlet}
    </div>
  );
}
