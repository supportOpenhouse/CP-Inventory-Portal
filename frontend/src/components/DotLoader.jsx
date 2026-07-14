/**
 * Bouncing-dots loader — three dots doing a staggered "jump" (translateY up,
 * mirrored, looping). Adapted from a Motion (motion-v) sample to pure CSS: this
 * project animates with CSS throughout (skeleton shimmer, toast, toggle thumb)
 * and has no motion library, so a keyframe replicates the same effect with zero
 * dependency. `small` scales it down for inline use.
 */
export default function DotLoader({ small = false }) {
  return (
    <span className={`dot-loader${small ? ' dot-loader-sm' : ''}`} role="status" aria-label="Loading">
      <span className="dl-dot" />
      <span className="dl-dot" />
      <span className="dl-dot" />
    </span>
  );
}
