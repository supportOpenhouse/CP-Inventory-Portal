// App loading indicator — bouncing pink dots (DotLoader). `full` centers big
// dots for a whole area; otherwise small dots inline, with an optional label.
import DotLoader from './DotLoader.jsx';

export default function Loading({ full = false, label }) {
  if (full) {
    return (
      <div className="loading" role="status" aria-label="Loading">
        <DotLoader />
      </div>
    );
  }
  return (
    <span className="dl-inline" role="status" aria-label="Loading">
      <DotLoader small />
      {label && <span className="dl-label">{label}</span>}
    </span>
  );
}
