/**
 * Pricing — Asking price (brand orange), OH Price (Openhouse's internal
 * comp, via formatOhPrice), and Rate/sqft. Ported from CP DetailPanel.jsx
 * ("Pricing" block). Read-only; no staff gate.
 */
import { formatPrice, formatOhPrice } from '../../../format';

export default function PricingSection({ submission, embedded }) {
  if (!submission) return null;
  const s = submission;
  const oh = formatOhPrice(s);

  const body = (
    <div className={embedded ? 'field-inline' : 'field-grid-2'}>
      <div className="field-row">
        <div className="field-lbl">Asking</div>
        <div className="field-val" style={{ color: 'var(--brand)', fontWeight: 700 }}>
          {formatPrice(s.asking_price)}
        </div>
      </div>
      {oh && (
        <div className="field-row" title={oh.tooltip}>
          <div className="field-lbl">OH Price</div>
          <div className={`field-val ${oh.isMatch ? 'val-green' : 'val-check'}`} style={{ fontWeight: 700 }}>
            {oh.display}
          </div>
          {oh.sub && <div className="oh-reason">{oh.sub}</div>}
        </div>
      )}
      {s.asking_price && s.sqft ? (
        <div className="field-row">
          <div className="field-lbl">Rate / sqft</div>
          <div className="field-val">₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}</div>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return body;
  return (
    <div className="card-block">
      <h3>Pricing</h3>
      {body}
    </div>
  );
}
