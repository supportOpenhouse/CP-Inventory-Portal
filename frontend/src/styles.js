/**
 * Shared CSS and design tokens, extracted from the original JSX prototype.
 * Imported once at app root; all screens pick up the classes.
 *
 * 2026-04-17: typography scale-up + logo image support.
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
  body, html, #root { height: 100%; background: var(--oh-bg-warm); font-family: 'DM Sans', sans-serif; color: var(--oh-charcoal); -webkit-font-smoothing: antialiased; font-size: 16px; }

  .app-shell { max-width: 480px; margin: 0 auto; background: #fff; min-height: 100vh; position: relative; box-shadow: var(--oh-shadow-lg); padding-bottom: 90px; }

  /* ===== Header ===== */
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; color: #fff; }
  .header-logo-img { height: 28px; display: block; }
  .header-brand { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .header-brand-accent { color: var(--oh-orange); }
  .header-user { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .header-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--oh-orange); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
  .logout-btn { background: rgba(255,255,255,0.12); color: #fff; border: none; padding: 8px 12px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
  .logout-btn:hover { background: rgba(255,255,255,0.2); }
  .back-btn { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; padding: 0; }
  .header-title { font-size: 16px; font-weight: 600; }
  .header-meta { font-size: 14px; color: rgba(255,255,255,0.55); font-weight: 500; }

  /* ===== Form cards & inputs ===== */
  .form-section { padding: 0 20px 20px; animation: slideUp 0.25s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .form-card { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; padding: 18px; margin-top: 16px; box-shadow: var(--oh-shadow-sm); }
  .form-card-title { font-size: 14px; font-weight: 600; color: var(--oh-charcoal); margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.3px; }
  .input-label { font-size: 13px; color: var(--oh-gray); font-weight: 500; margin-bottom: 6px; }
  .input-field, .select-field { width: 100%; padding: 13px 14px; border: 1.5px solid var(--oh-border); border-radius: 10px; font-size: 15px; font-family: 'DM Sans', sans-serif; outline: none; color: var(--oh-charcoal); background: #fff; transition: border-color 0.15s, box-shadow 0.15s; }
  .input-field:focus, .select-field:focus { border-color: var(--oh-orange); box-shadow: 0 0 0 3px rgba(255,107,43,0.08); }
  .input-field::placeholder { color: #B5B5B5; }
  .input-error { border-color: #EF4444 !important; }
  .error-text { color: #EF4444; font-size: 13px; margin-top: 4px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

  .primary-btn { width: 100%; padding: 15px; background: var(--oh-orange); color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, transform 0.1s; }
  .primary-btn:hover:not(:disabled) { background: #E55C1E; }
  .primary-btn:active { transform: scale(0.98); }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .secondary-btn { width: 100%; padding: 13px; background: #fff; color: var(--oh-charcoal); border: 1.5px solid var(--oh-border); border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .secondary-btn:hover { border-color: var(--oh-gray); }

  /* ===== Login-specific ===== */
  .login-hero { padding: 56px 20px 28px; text-align: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); }
  .login-logo-img { height: 48px; display: block; margin: 0 auto; }
  .login-logo { font-family: 'Fraunces', serif; font-size: 42px; font-weight: 700; color: #fff; letter-spacing: -1px; }
  .login-logo-accent { color: var(--oh-orange); }
  .login-tagline { font-size: 15px; color: rgba(255,255,255,0.7); margin-top: 10px; letter-spacing: 0.3px; }

  /* ===== RM contact cards ===== */
  .rm-card { background: var(--oh-orange-light); border: 1.5px solid var(--oh-orange); border-radius: 12px; padding: 18px; margin-top: 12px; text-align: center; }
  .rm-card-title { font-weight: 600; font-size: 14px; color: var(--oh-orange); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .rm-card-name { font-size: 15px; color: var(--oh-charcoal); font-weight: 500; }
  .rm-card-phone { font-size: 20px; font-weight: 700; color: var(--oh-orange); margin-top: 6px; display: inline-block; }
  .rm-card a { color: var(--oh-orange); text-decoration: none; }

  /* ===== Section titles & empty states ===== */
  .section-title { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 600; color: var(--oh-charcoal); padding: 18px 20px 12px; }
  .empty-state { text-align: center; padding: 56px 32px; color: var(--oh-gray); }
  .empty-state-icon { font-size: 52px; margin-bottom: 12px; opacity: 0.3; }
  .empty-state p { font-size: 15px; line-height: 1.5; }

  /* ===== Dashboard: stats + inventory ===== */
  .dash-meta { padding: 14px 20px 6px; font-size: 14px; color: var(--oh-gray); font-weight: 500; }
  .dash-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; padding: 12px 20px 4px; }
  .dash-stat { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; padding: 16px 10px; text-align: center; box-shadow: var(--oh-shadow-sm); }
  .dash-stat-num { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 700; color: var(--oh-orange); line-height: 1; }
  .dash-stat-label { font-size: 12px; color: var(--oh-gray); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }

  .unit-card { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; margin: 0 20px 12px; box-shadow: var(--oh-shadow-sm); overflow: hidden; }
  .unit-card-body { padding: 16px 18px; }
  .unit-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .unit-card-society { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: var(--oh-charcoal); }
  .unit-card-config { font-size: 13px; color: var(--oh-gray); margin-top: 3px; }
  .unit-card-price { font-size: 20px; font-weight: 700; color: var(--oh-charcoal); margin-top: 8px; }
  .unit-card-price span { font-size: 13px; color: var(--oh-gray); font-weight: 500; margin-left: 6px; }

  .badge { font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .badge-submitted { background: #EEF2FF; color: #6366F1; }
  .badge-offer { background: #FEF3C7; color: var(--oh-yellow); }
  .badge-closed { background: #D1FAE5; color: var(--oh-green); }

  /* ===== FAB (add unit) ===== */
  .fab { position: fixed; bottom: 24px; right: calc(50% - 240px + 24px); width: 60px; height: 60px; border-radius: 50%; background: var(--oh-orange); color: #fff; border: none; font-size: 30px; font-weight: 400; cursor: pointer; box-shadow: 0 6px 20px rgba(255,107,43,0.3); transition: transform 0.15s; font-family: inherit; line-height: 1; z-index: 40; }
  .fab:hover { transform: scale(1.08); }
  @media (max-width: 520px) { .fab { right: 20px; } }

  /* ===== Add Unit: progress bar + step label ===== */
  .progress-bar { display: flex; gap: 6px; padding: 14px 20px 0; }
  .progress-step { flex: 1; height: 4px; background: var(--oh-border); border-radius: 2px; transition: background 0.3s; }
  .progress-step.active { background: var(--oh-orange); }
  .progress-step.done { background: var(--oh-orange); }
  .step-label { padding: 12px 20px 4px; font-size: 14px; color: var(--oh-gray); }
  .step-label strong { color: var(--oh-charcoal); font-size: 16px; }

  /* ===== Society search dropdown ===== */
  .society-search-wrap { position: relative; }
  .society-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1.5px solid var(--oh-border); border-radius: 10px; max-height: 240px; overflow-y: auto; z-index: 10; box-shadow: var(--oh-shadow-lg); margin-top: 4px; }
  .society-option { padding: 13px 16px; font-size: 15px; cursor: pointer; color: var(--oh-charcoal); border-bottom: 1px solid #F5F5F5; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .society-option:hover { background: var(--oh-orange-light); }
  .society-option:last-child { border-bottom: none; }
  .society-sector { font-size: 12px; color: var(--oh-gray); white-space: nowrap; }
  .society-loading { padding: 14px 16px; font-size: 14px; color: var(--oh-gray); font-style: italic; }

  /* ===== Hints ===== */
  .auto-fill-hint { font-size: 13px; color: var(--oh-green); font-weight: 500; margin-top: 4px; }
  .manual-hint { font-size: 12px; color: var(--oh-gray); font-style: italic; margin-top: 4px; }
  .optional-hint { font-size: 13px; color: var(--oh-gray); margin-top: 8px; line-height: 1.4; }

  /* ===== Duplicate card ===== */
  .dup-card { border-radius: 16px; overflow: hidden; border: 1px solid var(--oh-border); margin: 16px 0; }
  .dup-card-exact { border-color: var(--oh-red); }
  .dup-card-partial { border-color: var(--oh-orange); }
  .dup-card-banner { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 28px 22px; position: relative; }
  .dup-card-badge { display: inline-block; color: #fff; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 8px; letter-spacing: 0.3px; }
  .dup-card-badge-exact { background: var(--oh-red); }
  .dup-card-badge-partial { background: var(--oh-orange); }
  .dup-card-banner-text { color: rgba(255,255,255,0.75); font-size: 24px; font-family: 'Fraunces', serif; font-weight: 700; margin-top: 14px; letter-spacing: -0.5px; line-height: 1.2; white-space: pre-line; }
  .dup-card-body { padding: 18px 20px; background: #fff; }
  .dup-card-name { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 700; color: var(--oh-charcoal); margin-bottom: 4px; }
  .dup-card-location { font-size: 14px; color: var(--oh-gray); margin-bottom: 14px; }
  .dup-card-message { font-size: 14px; color: var(--oh-charcoal); line-height: 1.5; padding: 14px; background: var(--oh-bg-warm); border-radius: 8px; margin-bottom: 14px; }

  /* ===== Spinner ===== */
  .spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 6px; }
  .spinner-dark { border-color: rgba(0,0,0,0.15); border-top-color: var(--oh-charcoal); }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ===== Loading placeholder ===== */
  .loading-block { text-align: center; padding: 44px 20px; color: var(--oh-gray); font-size: 14px; }

  /* ===== Chatbot ===== */
  .chatbot-fab { position: fixed; bottom: 24px; left: calc(50% - 240px + 24px); width: 52px; height: 52px; border-radius: 50%; background: #fff; color: var(--oh-charcoal); border: 1.5px solid var(--oh-border); font-size: 24px; cursor: pointer; box-shadow: var(--oh-shadow-lg); transition: transform 0.15s, border-color 0.15s; font-family: inherit; display: flex; align-items: center; justify-content: center; z-index: 50; }
  .chatbot-fab:hover { transform: scale(1.08); border-color: var(--oh-orange); }
  @media (max-width: 520px) { .chatbot-fab { left: 20px; } }

  .chatbot-panel { position: fixed; bottom: 24px; left: calc(50% - 240px + 20px); width: 340px; max-width: calc(100vw - 40px); max-height: min(600px, calc(100vh - 48px)); background: #fff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; z-index: 51; animation: chatbotSlideIn 0.2s ease; }
  @media (max-width: 520px) { .chatbot-panel { left: 20px; right: 20px; width: auto; } }
  @keyframes chatbotSlideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

  .chatbot-header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 16px 18px; display: flex; justify-content: space-between; align-items: center; }
  .chatbot-body { flex: 1; overflow-y: auto; padding: 8px 0; }
  .chatbot-footer { padding: 14px 16px; border-top: 1px solid var(--oh-border); background: var(--oh-bg-warm); }

  .chatbot-faq-item { border-bottom: 1px solid #F5F5F5; }
  .chatbot-faq-item:last-child { border-bottom: none; }
  .chatbot-faq-question { width: 100%; padding: 13px 16px; background: none; border: none; font-family: inherit; font-size: 14px; font-weight: 500; color: var(--oh-charcoal); text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .chatbot-faq-question:hover { background: var(--oh-orange-light); }
  .chatbot-faq-answer { padding: 0 16px 14px; font-size: 13px; color: var(--oh-gray); line-height: 1.6; animation: slideUp 0.2s ease; }

  /* ===== PWA install banner ===== */
  .install-banner { position: fixed; bottom: 0; left: 0; right: 0; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 200; box-shadow: 0 -4px 16px rgba(0,0,0,0.18); animation: installSlideUp 0.3s ease; padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
  @keyframes installSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .install-banner-text { flex: 1; min-width: 0; }
  .install-banner-primary { background: var(--oh-orange); color: #fff; border: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
  .install-banner-primary:hover { background: #E55C1E; }
  .install-banner-secondary { background: rgba(255,255,255,0.12); color: #fff; border: none; padding: 9px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; white-space: nowrap; }
  .install-banner-secondary:hover { background: rgba(255,255,255,0.2); }
`;