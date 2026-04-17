import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';

/**
 * FAQ chatbot widget. Renders a small circular button fixed to the bottom-right
 * of the dashboard. Click to open a panel with FAQs grouped by category,
 * collapsible, searchable, with a "Chat with RM" fallback.
 *
 * Props:
 *   rmPhone — fallback WhatsApp/call number shown at the bottom of the panel.
 */
export default function Chatbot({ rmPhone = '+919555666059' }) {
  const [open, setOpen] = useState(false);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null); // faq id
  const [search, setSearch] = useState('');

  // Lazy-load FAQs the first time the widget opens
  useEffect(() => {
    if (!open || faqs.length > 0 || loading) return;
    setLoading(true);
    api
      .getFaqs()
      .then((data) => setFaqs(data.faqs || []))
      .catch(() => setFaqs([]))
      .finally(() => setLoading(false));
  }, [open, faqs.length, loading]);

  const filtered = useMemo(() => {
    if (!search.trim()) return faqs;
    const q = search.toLowerCase();
    return faqs.filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        (f.category || '').toLowerCase().includes(q)
    );
  }, [faqs, search]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const f of filtered) {
      const cat = f.category || 'Other';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(f);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const waLink = `https://wa.me/${rmPhone.replace(/\D/g, '')}`;

  return (
    <>
      {!open && (
        <button
          className="chatbot-fab"
          onClick={() => setOpen(true)}
          aria-label="Help"
          title="Frequently asked questions"
        >
          💬
        </button>
      )}

      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 700 }}>
                Help &amp; FAQs
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                Quick answers to common questions
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                border: 'none',
                width: 28,
                height: 28,
                borderRadius: '50%',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--oh-border)' }}>
            <input
              className="input-field"
              placeholder="Search FAQs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: '9px 12px' }}
            />
          </div>

          <div className="chatbot-body">
            {loading && <div className="society-loading">Loading…</div>}

            {!loading && grouped.length === 0 && (
              <div className="empty-state" style={{ padding: '32px 16px' }}>
                <p>No FAQs match your search.</p>
              </div>
            )}

            {!loading &&
              grouped.map(([category, items]) => (
                <div key={category} style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      color: 'var(--oh-orange)',
                      padding: '8px 14px 4px',
                    }}
                  >
                    {category}
                  </div>
                  {items.map((f) => {
                    const isOpen = expanded === f.id;
                    return (
                      <div key={f.id} className="chatbot-faq-item">
                        <button
                          className="chatbot-faq-question"
                          onClick={() => setExpanded(isOpen ? null : f.id)}
                        >
                          <span>{f.question}</span>
                          <span style={{ color: 'var(--oh-gray)', fontSize: 12 }}>
                            {isOpen ? '−' : '+'}
                          </span>
                        </button>
                        {isOpen && <div className="chatbot-faq-answer">{f.answer}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>

          <div className="chatbot-footer">
            <div style={{ fontSize: 11, color: 'var(--oh-gray)', marginBottom: 6 }}>
              Can't find what you're looking for?
            </div>
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="primary-btn"
              style={{
                display: 'block',
                textAlign: 'center',
                textDecoration: 'none',
                padding: '10px',
                fontSize: 13,
              }}
            >
              Chat with your RM on WhatsApp
            </a>
          </div>
        </div>
      )}
    </>
  );
}
