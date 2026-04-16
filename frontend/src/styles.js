/**
 * Shared CSS and design tokens, extracted from the original JSX prototype.
 * Imported once at app root; all screens pick up the classes.
 */

export const fonts = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:wght@500;600;700&display=swap');
`;

export const css = `
  :root {
    --oh-orange: #FF6B2B;
    --oh-orange-light: #FFF4EC;
    --oh-charcoal: #1A1A1A;
    --oh-gray: #6B7280;
    --oh-bg-warm: #FAF7F2;
    --oh-border: #EEEEEE;
    --oh-yellow: #F59E0B;
    --oh-green: #10B981;
    --oh-red: #EF4444;
    --oh-shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
    --oh-shadow-lg: 0 4px 16px rgba(0,0,0,0.08);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body, html, #root { height: 100%; background: var(--oh-bg-warm); font-family: 'DM Sans', sans-serif; color: var(--oh-charcoal); -webkit-font-smoothing: antialiased; }

  .app-shell { max-width: 480px; margin: 0 auto; background: #fff; min-height: 100vh; position: relative; box-shadow: var(--oh-shadow-lg); padding-bottom: 80px; }

  /* ===== Header ===== */
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; color: #fff; }
  .header-brand { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .header-brand-accent { color: var(--oh-orange); }
  .header-user { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .header-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--oh-orange); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
  .logout-btn { background: rgba(255,255,255,0.12); color: #fff; border: none; padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .logout-btn:hover { background: rgba(255,255,255,0.2); }
  .back-btn { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 0; }

  /* ===== Form cards & inputs ===== */
  .form-section { padding: 0 20px 20px; animation: slideUp 0.25s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .form-card { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; padding: 16px; margin-top: 16px; box-shadow: var(--oh-shadow-sm); }
  .form-card-title { font-size: 13px; font-weight: 600; color: var(--oh-charcoal); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
  .input-label { font-size: 12px; color: var(--oh-gray); font-weight: 500; margin-bottom: 6px; }
  .input-field, .select-field { width: 100%; padding: 11px 14px; border: 1.5px solid var(--oh-border); border-radius: 10px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; color: var(--oh-charcoal); background: #fff; transition: border-color 0.15s, box-shadow 0.15s; }
  .input-field:focus, .select-field:focus { border-color: var(--oh-orange); box-shadow: 0 0 0 3px rgba(255,107,43,0.08); }
  .input-field::placeholder { color: #B5B5B5; }
  .input-error { border-color: #EF4444 !important; }
  .error-text { color: #EF4444; font-size: 12px; margin-top: 4px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

  .primary-btn { width: 100%; padding: 14px; background: var(--oh-orange); color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, transform 0.1s; }
  .primary-btn:hover:not(:disabled) { background: #E55C1E; }
  .primary-btn:active { transform: scale(0.98); }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .secondary-btn { width: 100%; padding: 12px; background: #fff; color: var(--oh-charcoal); border: 1.5px solid var(--oh-border); border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .secondary-btn:hover { border-color: var(--oh-gray); }

  /* ===== Login-specific ===== */
  .login-hero { padding: 48px 20px 24px; text-align: center; }
  .login-logo { font-family: 'Fraunces', serif; font-size: 36px; font-weight: 700; color: var(--oh-charcoal); letter-spacing: -1px; }
  .login-logo-accent { color: var(--oh-orange); }
  .login-tagline { font-size: 14px; color: var(--oh-gray); margin-top: 6px; }

  /* ===== RM contact cards ===== */
  .rm-card { background: var(--oh-orange-light); border: 1.5px solid var(--oh-orange); border-radius: 12px; padding: 16px; margin-top: 12px; text-align: center; }
  .rm-card-title { font-weight: 600; font-size: 13px; color: var(--oh-orange); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .rm-card-name { font-size: 14px; color: var(--oh-charcoal); font-weight: 500; }
  .rm-card-phone { font-size: 18px; font-weight: 700; color: var(--oh-orange); margin-top: 4px; display: inline-block; }
  .rm-card a { color: var(--oh-orange); text-decoration: none; }

  /* ===== Section titles & empty states ===== */
  .section-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: var(--oh-charcoal); padding: 16px 20px 12px; }
  .empty-state { text-align: center; padding: 48px 32px; color: var(--oh-gray); }
  .empty-state-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; }
  .empty-state p { font-size: 14px; line-height: 1.5; }

  /* ===== Dashboard: stats + inventory ===== */
  .dash-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 12px 20px 4px; }
  .dash-stat { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; padding: 14px 10px; text-align: center; box-shadow: var(--oh-shadow-sm); }
  .dash-stat-num { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; color: var(--oh-orange); line-height: 1; }
  .dash-stat-label { font-size: 11px; color: var(--oh-gray); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }

  .unit-card { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; margin: 0 20px 12px; box-shadow: var(--oh-shadow-sm); overflow: hidden; }
  .unit-card-body { padding: 14px 16px; }
  .unit-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .unit-card-society { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--oh-charcoal); }
  .unit-card-config { font-size: 12px; color: var(--oh-gray); margin-top: 2px; }
  .unit-card-price { font-size: 18px; font-weight: 700; color: var(--oh-charcoal); margin-top: 6px; }
  .unit-card-price span { font-size: 12px; color: var(--oh-gray); font-weight: 500; margin-left: 6px; }

  .badge { font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .badge-submitted { background: #EEF2FF; color: #6366F1; }
  .badge-offer { background: #FEF3C7; color: var(--oh-yellow); }
  .badge-closed { background: #D1FAE5; color: var(--oh-green); }

  /* ===== FAB ===== */
  .fab { position: fixed; bottom: 24px; right: calc(50% - 240px + 24px); width: 56px; height: 56px; border-radius: 50%; background: var(--oh-orange); color: #fff; border: none; font-size: 28px; font-weight: 400; cursor: pointer; box-shadow: 0 6px 20px rgba(255,107,43,0.3); transition: transform 0.15s; font-family: inherit; line-height: 1; }
  .fab:hover { transform: scale(1.08); }
  @media (max-width: 520px) { .fab { right: 20px; } }

  /* ===== Add Unit: progress bar + step label ===== */
  .progress-bar { display: flex; gap: 6px; padding: 14px 20px 0; }
  .progress-step { flex: 1; height: 4px; background: var(--oh-border); border-radius: 2px; transition: background 0.3s; }
  .progress-step.active { background: var(--oh-orange); }
  .progress-step.done { background: var(--oh-orange); }
  .step-label { padding: 12px 20px 4px; font-size: 13px; color: var(--oh-gray); }
  .step-label strong { color: var(--oh-charcoal); font-size: 14px; }

  /* ===== Society search dropdown ===== */
  .society-search-wrap { position: relative; }
  .society-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1.5px solid var(--oh-border); border-radius: 10px; max-height: 220px; overflow-y: auto; z-index: 10; box-shadow: var(--oh-shadow-lg); margin-top: 4px; }
  .society-option { padding: 11px 16px; font-size: 14px; cursor: pointer; color: var(--oh-charcoal); border-bottom: 1px solid #F5F5F5; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .society-option:hover { background: var(--oh-orange-light); }
  .society-option:last-child { border-bottom: none; }
  .society-sector { font-size: 11px; color: var(--oh-gray); white-space: nowrap; }
  .society-loading { padding: 12px 16px; font-size: 13px; color: var(--oh-gray); font-style: italic; }

  /* ===== Auto-fill hints ===== */
  .auto-fill-hint { font-size: 12px; color: var(--oh-green); font-weight: 500; margin-top: 4px; }
  .manual-hint { font-size: 11px; color: var(--oh-gray); font-style: italic; margin-top: 4px; }
  .optional-hint { font-size: 12px; color: var(--oh-gray); margin-top: 6px; line-height: 1.4; }

  /* ===== Duplicate card ===== */
  .dup-card { border-radius: 16px; overflow: hidden; border: 1px solid var(--oh-border); margin: 16px 0; }
  .dup-card-exact { border-color: var(--oh-red); }
  .dup-card-partial { border-color: var(--oh-orange); }
  .dup-card-banner { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 24px 20px; position: relative; }
  .dup-card-badge { display: inline-block; color: #fff; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 8px; letter-spacing: 0.3px; }
  .dup-card-badge-exact { background: var(--oh-red); }
  .dup-card-badge-partial { background: var(--oh-orange); }
  .dup-card-banner-text { color: rgba(255,255,255,0.7); font-size: 22px; font-family: 'Fraunces', serif; font-weight: 700; margin-top: 12px; letter-spacing: -0.5px; line-height: 1.2; }
  .dup-card-body { padding: 16px 18px; background: #fff; }
  .dup-card-name { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 700; color: var(--oh-charcoal); margin-bottom: 4px; }
  .dup-card-location { font-size: 13px; color: var(--oh-gray); margin-bottom: 12px; }
  .dup-card-message { font-size: 13px; color: var(--oh-charcoal); line-height: 1.5; padding: 12px; background: var(--oh-bg-warm); border-radius: 8px; margin-bottom: 12px; }
  .dup-card-details { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
  .dup-card-detail { padding: 8px 10px; background: var(--oh-bg-warm); border-radius: 6px; }
  .dup-card-detail-label { font-size: 10px; color: var(--oh-gray); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; }
  .dup-card-detail-value { font-size: 13px; color: var(--oh-charcoal); font-weight: 600; margin-top: 2px; }

  /* ===== Spinner ===== */
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 6px; }
  .spinner-dark { border-color: rgba(0,0,0,0.15); border-top-color: var(--oh-charcoal); }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ===== Loading placeholder ===== */
  .loading-block { text-align: center; padding: 40px 20px; color: var(--oh-gray); font-size: 13px; }
`;