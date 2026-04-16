import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const checkHealth = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setResult({ ok: res.ok, status: res.status, data });
    } catch (err) {
      setResult({ ok: false, status: 'network', data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Openhouse CP Portal</h1>
      <p style={styles.subtitle}>Phase 2.1 — Vite + React scaffold ✓</p>

      <p style={styles.apiLine}>
        API base: <code style={styles.code}>{API_BASE}</code>
      </p>

      <button
        onClick={checkHealth}
        disabled={loading}
        style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
      >
        {loading ? 'Checking…' : 'Test /api/health'}
      </button>

      {result && (
        <pre
          style={{
            ...styles.pre,
            background: result.ok ? '#f0fff4' : '#fff5f5',
            borderColor: result.ok ? '#48bb78' : '#f56565',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: 520,
    margin: '60px auto',
    padding: 20,
    textAlign: 'center',
  },
  title: { color: '#FF6B2B', marginBottom: 8, fontSize: 28 },
  subtitle: { color: '#555', marginBottom: 24, fontSize: 14 },
  apiLine: { fontSize: 12, color: '#888', marginBottom: 20 },
  code: { background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, fontSize: 11 },
  btn: {
    padding: '12px 24px',
    background: '#FF6B2B',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  pre: {
    marginTop: 24,
    padding: 16,
    border: '1px solid',
    borderRadius: 8,
    textAlign: 'left',
    fontSize: 12,
    overflow: 'auto',
  },
};
