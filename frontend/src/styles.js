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
  .required-star { color: #DC2626; margin-left: 3px; font-weight: 700; }

  /* ===== Soft duplicate warning (partial match, non-blocking) ===== */
  .dup-warning-card {
    background: #FFF9EC;
    border: 1.5px solid #F5B90B;
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 16px;
  }
  .dup-warning-title {
    font-size: 14px;
    font-weight: 700;
    color: #8A6100;
    margin-bottom: 8px;
  }
  .dup-warning-message {
    font-size: 13px;
    color: #5B4100;
    line-height: 1.5;
    margin-bottom: 12px;
  }
  .dup-warning-actions {
    display: flex;
    gap: 10px;
  }
  .dup-warning-actions .secondary-btn,
  .dup-warning-actions .primary-btn {
    flex: 1;
    padding: 10px 14px;
    font-size: 13px;
  }
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

  /* ===== Register Inventory pill (was .fab circle) =====
     Sits bottom-right of the centered 480px container. Leaves space on the left
     for the .wa-fab circle (52px wide + 16px gap = 68px reserved). Height 52px
     exactly matches .wa-fab for a clean aligned footer row. */
  .register-btn { position: fixed; bottom: 24px; left: calc(50% - 240px + 92px); right: calc(50% - 240px + 24px); height: 52px; padding: 0 18px; border-radius: 26px; background: var(--oh-orange); color: #fff; border: none; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(255,107,43,0.3); transition: transform 0.15s; font-family: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 8px; z-index: 40; white-space: nowrap; }
  .register-btn:hover { transform: scale(1.03); }
  .register-btn .plus { font-size: 22px; font-weight: 400; line-height: 1; }
  @media (max-width: 520px) { .register-btn { left: 88px; right: 20px; } }

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

  /* WhatsApp RM button — same position as old .chatbot-fab (bottom-left, opposite the orange +FAB) */
  .wa-fab { position: fixed; bottom: 24px; left: calc(50% - 240px + 24px); width: 52px; height: 52px; border-radius: 50%; background: #25D366; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(37, 211, 102, 0.4); cursor: pointer; z-index: 50; text-decoration: none; transition: transform 0.15s; }
  .wa-fab:hover { transform: scale(1.08); }
  @media (max-width: 520px) { .wa-fab { left: 20px; } }

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

  /* ===== Skeleton shimmer ===== */
  .skeleton-shimmer { display: block; background: linear-gradient(90deg, #F3F2EE 0%, #EAE8E3 50%, #F3F2EE 100%); background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* ===== New badge variant ===== */
  .badge-rejected { background: #FEE2E2; color: #D64045; }

  /* ===== Admin: top bar ===== */
  .admin-root { min-height: 100vh; background: #F8F7F4; font-family: 'DM Sans', sans-serif; color: #222; }
  .admin-topbar { background: #222; padding: 0 28px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .admin-topbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .admin-logo-img { height: 26px; display: block; }
  .admin-topbar-sub { font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 0.3px; }
  .admin-topbar-right { display: flex; align-items: center; gap: 12px; }
  .admin-topbar-env { font-size: 11px; color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 4px; font-weight: 500; }
  .admin-topbar-user { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.85); font-size: 13px; }
  .admin-topbar-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--oh-orange); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; }
  .logout-btn { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.15); width: 30px; height: 30px; border-radius: 6px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; font-family: inherit; }
  .logout-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }

  /* ===== Admin: toolbar ===== */
  .admin-toolbar { padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid #E8E6E0; background: #fff; }
  .admin-toolbar-left { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; min-width: 0; }
  .admin-toolbar-right { display: flex; align-items: center; gap: 12px; }
  .city-tabs { display: flex; gap: 4px; background: #F3F2EE; border-radius: 8px; padding: 3px; }
  .city-tab { padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: #888; transition: all 0.15s; font-family: inherit; }
  .city-tab.active { background: #222; color: #fff; }
  .city-tab:hover:not(.active) { color: #222; }
  .admin-scope-pill { padding: 6px 12px; background: #F3F2EE; border-radius: 6px; font-size: 12px; color: #666; font-weight: 500; }
  .search-form { display: flex; align-items: stretch; gap: 6px; }
  .search-box { padding: 8px 14px; border: 1px solid #E8E6E0; border-radius: 8px; font-size: 13px; width: 240px; outline: none; font-family: inherit; color: #222; background: #FAFAF8; }
  .search-box:focus { border-color: var(--oh-orange); box-shadow: 0 0 0 2px rgba(255,107,43,0.08); }
  .search-box::placeholder { color: #B5B5B5; }
  .search-btn { padding: 0 14px; border: 1px solid var(--oh-orange); border-radius: 8px; background: var(--oh-orange); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: background 0.15s, border-color 0.15s; }
  .search-btn:hover:not(:disabled) { background: #E55A1F; border-color: #E55A1F; }
  .search-btn:disabled { opacity: 0.45; cursor: default; }
  .view-toggle { display: flex; gap: 2px; background: #F3F2EE; border-radius: 6px; padding: 2px; }
  .view-btn { padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: #888; font-family: inherit; }
  .view-btn.active { background: #fff; color: #222; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .export-btn { padding: 7px 14px; background: #fff; border: 1px solid #E8E6E0; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; color: #222; font-family: inherit; white-space: nowrap; }
  .export-btn:hover:not(:disabled) { border-color: var(--oh-orange); color: var(--oh-orange); }
  .export-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ===== Admin: stats row ===== */
  .admin-stats { display: flex; gap: 12px; padding: 16px 28px 0; flex-wrap: wrap; }
  .stat-card { background: #fff; border: 1px solid #E8E6E0; border-radius: 10px; padding: 14px 18px; min-width: 110px; }
  .stat-num { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 700; line-height: 1; }
  .stat-label { font-size: 11px; color: #999; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 500; }

  /* ===== Admin: board view ===== */
  .admin-board { display: flex; gap: 14px; padding: 20px 28px 40px; overflow-x: auto; min-height: calc(100vh - 200px); align-items: flex-start; }
  .board-column { min-width: 280px; max-width: 280px; flex-shrink: 0; }
  .col-header { display: flex; align-items: center; gap: 8px; padding: 0 4px 12px; }
  .col-dot { width: 10px; height: 10px; border-radius: 50%; }
  .col-title { font-size: 13px; font-weight: 600; color: #222; }
  .col-count { font-size: 11px; color: #999; background: #F3F2EE; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
  .col-empty { font-size: 12px; color: #CCC; text-align: center; padding: 20px; }
  .board-card { background: #fff; border: 1px solid #E8E6E0; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; cursor: pointer; transition: all 0.15s; position: relative; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
  .board-card:hover { border-color: #CCC; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transform: translateY(-1px); }
  .board-card.active { border-color: var(--oh-orange); box-shadow: 0 0 0 2px rgba(255,107,43,0.12); }

  /* Weak-match rows (low-confidence society match during import) */
  .board-card.weak-match { border-color: #FCA5A5; background: #FFF8F8; }
  .board-card.weak-match:hover { border-color: #DC2626; }
  .board-card.weak-match.active { border-color: #DC2626; box-shadow: 0 0 0 2px rgba(220,38,38,0.15); }
  .admin-table tbody tr.weak-match { background: #FFF8F8; }
  .admin-table tbody tr.weak-match:hover { background: #FEE2E2; }
  .admin-table tbody tr.weak-match.active { background: #FECACA; }

  /* Rejected column visual emphasis — the stage dot gets a red shadow,
     count badge goes red, status pill in table pops */
  .board-column.is-rejected .col-dot { box-shadow: 0 0 0 3px rgba(220,38,38,0.15); }
  .board-column.is-rejected .col-count { background: #FEE2E2; color: #DC2626; font-weight: 700; }
  .status-pill.is-rejected { background: #FEE2E2 !important; color: #DC2626 !important; font-weight: 700; }

  /* ----- Card layout (board view only) -----
     Header is a flex row: society name flexes on the left, the city + public_id
     stack sits on the right. Tower/floor lives on its own meta line below.
     Chips, schedule pill, divider, then a 2-column price grid (Asking + Acq)
     followed by a footer row with submitted date and the on-behalf chip.
     This replaces the old absolutely-positioned corner + cramped bottom row,
     which clipped the date / "via X" chip when all fields were populated. */
  .board-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .board-card-society { font-size: 14px; font-weight: 700; color: #222; line-height: 1.3; flex: 1; min-width: 0; word-break: break-word; }
  .board-card-corner { text-align: right; flex-shrink: 0; line-height: 1.25; }
  .board-card-city-text { font-size: 10px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
  .board-card-pubid-text { font-size: 10px; font-weight: 600; color: #BBB; font-family: ui-monospace, monospace; letter-spacing: 0.3px; margin-top: 2px; white-space: nowrap; }
  .board-card-flag { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #D64045; margin-left: 6px; vertical-align: 1px; }

  .board-card-meta { font-size: 12px; color: #888; margin-top: 4px; }

  .board-card-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .board-chip { font-size: 10px; padding: 3px 8px; border-radius: 4px; font-weight: 600; letter-spacing: 0.2px; line-height: 1.5; }
  .board-chip-sqft { background: #F3F2EE; color: #555; }
  .board-chip-collated { background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
  .board-chip-submissions { background: #EDE9FE; color: #5B21B6; border: 1px solid #C4B5FD; }
  .board-chip-weak { background: #FEE2E2; color: #B91C1C; border: 1px solid #FCA5A5; }

  .board-card-schedule { margin-top: 10px; padding: 6px 10px; background: #ECFDF5; border: 1px solid #6EE7B7; border-radius: 8px; font-size: 11px; font-weight: 600; color: #047857; line-height: 1.4; }

  .board-card-divider { margin-top: 12px; border-top: 1px solid #F0EEE9; }
  .board-card-prices { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; row-gap: 6px; }
  .board-card-prices.solo { grid-template-columns: 1fr; }
  .board-card-price-label { font-size: 9.5px; font-weight: 700; color: #999; letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 2px; }
  .board-card-price-value { font-size: 15px; font-weight: 700; line-height: 1.2; white-space: nowrap; }
  .board-card-price-value.asking { color: var(--oh-orange); }
  .board-card-price-value.acq { color: #16A34A; }
  .board-card-price-value.acq-suggested { color: #16A34A; opacity: 0.85; }

  .board-card-footer { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .board-card-date { font-size: 11px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .board-card-onbehalf { font-size: 10px; font-weight: 700; padding: 2px 8px; background: var(--oh-orange-light); color: var(--oh-orange); border-radius: 4px; letter-spacing: 0.2px; white-space: nowrap; }

  .board-card-skel { height: 120px; background: #fff; border: 1px solid #E8E6E0; border-radius: 12px; margin-bottom: 10px; position: relative; overflow: hidden; }
  .board-card-skel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(234,232,227,0.6) 50%, transparent 100%); animation: shimmer 1.4s ease-in-out infinite; }

  /* ----- Ageing — card-level borders ----- */
  /* Under-7-day countdown: soft pulsing halo, no border (kept clean while
     the strip + bar carry the visual weight). Skipped when an inline style
     overlay (perfect-match red / withdrawn yellow / partial-match purple)
     is already painting the card. */
  .board-card.is-aging-soon { background: #FFFBFB; box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.08); animation: aging-soon-pulse 2.4s ease-in-out infinite; }
  @keyframes aging-soon-pulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.10), 0 0 0 0 rgba(239, 68, 68, 0.18); }
    50%      { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.18), 0 0 0 6px rgba(239, 68, 68, 0.00); }
  }
  /* Overdue (>7 days): dashed red border around the whole card. */
  .board-card.is-aging-overdue { background: #FFF5F5; border: 2.5px dashed #B91C1C; box-shadow: 0 0 0 1px #FCA5A5, 0 2px 6px rgba(185, 28, 28, 0.12); }

  /* ----- Ageing / reminder timer strip (under-7-days countdown) -----
     Pinned to the bottom of the board card via negative margins that pull
     past the 14px / 16px card padding. .aging-strip-inline overrides
     those negatives for cards that can't tolerate them (mobile CP view). */
  .aging-strip { margin: 10px -16px -14px; padding: 8px 14px 10px; background: linear-gradient(180deg, #FFF5F5 0%, #FFECEC 100%); border-top: 1px dashed #FCA5A5; border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; }
  .aging-strip.aging-strip-inline { margin: 10px 0 0; border-radius: 10px; border-top: none; border: 1px dashed #FCA5A5; }
  .aging-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .aging-label { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: #B91C1C; letter-spacing: 0.3px; text-transform: uppercase; }
  .aging-label .clock-icon { color: #DC2626; animation: clock-tick 1s steps(60, end) infinite; transform-origin: 50% 50%; }
  @keyframes clock-tick { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .aging-days { font-size: 11px; font-weight: 700; color: #DC2626; font-variant-numeric: tabular-nums; }
  .aging-days .num { font-size: 13px; }
  .aging-bar-track { position: relative; height: 6px; background: #FCE7E7; border-radius: 999px; overflow: hidden; }
  .aging-bar-fill { position: absolute; top: 0; left: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, #FCA5A5 0%, #EF4444 60%, #B91C1C 100%); background-size: 200% 100%; animation: aging-shimmer 1.8s linear infinite; }
  @keyframes aging-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }

  /* ----- Ageing — overdue (>7 days). Renders as a pill, not a strip. ----- */
  .aging-overdue-pill { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; padding: 4px 10px; background: #B91C1C; color: #fff; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; box-shadow: 0 1px 2px rgba(185, 28, 28, 0.3); }
  .aging-overdue-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: overdue-blink 1.2s ease-in-out infinite; }
  @keyframes overdue-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

  /* ===== Admin: table view ===== */
  .admin-table-wrap { padding: 20px 28px 40px; }
  .admin-table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; border-radius: 10px; border: 1px solid #E8E6E0; }
  .admin-table thead th { text-align: left; padding: 12px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #999; font-weight: 600; border-bottom: 2px solid #E8E6E0; background: #FAFAF8; position: sticky; top: 56px; z-index: 5; box-shadow: 0 1px 0 #E8E6E0; }
  .admin-table thead th:first-child { border-top-left-radius: 10px; }
  .admin-table thead th:last-child { border-top-right-radius: 10px; }
  .admin-table tbody td { padding: 14px; border-bottom: 1px solid #F3F2EE; vertical-align: top; }
  .admin-table tbody tr { cursor: pointer; transition: background 0.1s; }
  .admin-table tbody tr:hover { background: #FAFAF8; }
  .admin-table tbody tr.active { background: #FFF4EC; }
  .admin-table tbody tr:last-child td { border-bottom: none; }
  .admin-table-loading { padding: 60px 28px; text-align: center; color: #999; font-size: 14px; }
  .status-pill { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }

  /* ===== Admin: right detail panel ===== */
  .panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 200; animation: fadeIn 0.15s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .admin-panel { position: fixed; top: 0; right: 0; width: 520px; max-width: 100vw; height: 100vh; background: #fff; z-index: 201; box-shadow: -8px 0 32px rgba(0,0,0,0.1); display: flex; flex-direction: column; animation: slideIn 0.2s ease; }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .admin-panel-header { padding: 20px 24px; border-bottom: 1px solid #E8E6E0; display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .admin-panel-title { font-size: 18px; font-weight: 700; font-family: 'Fraunces', serif; color: #222; }
  .admin-panel-sub { font-size: 13px; color: #888; margin-top: 3px; }
  .panel-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 2px; flex-shrink: 0; }
  .panel-close:hover { color: #222; }
  .admin-panel-body { flex: 1; overflow-y: auto; }
  .admin-panel-section { padding: 16px 24px; border-bottom: 1px solid #F3F2EE; }
  .admin-panel-section:last-child { border-bottom: none; }
  .admin-panel-section-title { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #222; }
  .admin-panel-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #999; font-weight: 600; margin-bottom: 4px; }
  .admin-panel-val { font-size: 14px; color: #222; font-weight: 500; }
  .admin-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .status-select { padding: 8px 12px; border: 1px solid #E8E6E0; border-radius: 6px; font-size: 13px; font-weight: 500; background: #FAFAF8; cursor: pointer; outline: none; font-family: inherit; color: #222; width: 100%; }
  .status-select:focus { border-color: var(--oh-orange); }
  .missing-flag { color: #D64045; font-size: 12px; font-weight: 500; }

  /* ===== Admin: events timeline ===== */
  .admin-events { display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; padding-bottom: 8px; }
  .admin-event { padding: 10px 12px; background: #FAFAF8; border-radius: 8px; border-left: 3px solid var(--oh-border); }
  .admin-event.is-system { border-left-color: #CBD5E1; opacity: 0.85; }
  .admin-event-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 12px; }
  .admin-event-head strong { color: #222; font-weight: 600; }
  .admin-event-role { font-size: 10px; text-transform: uppercase; background: var(--oh-orange-light); color: var(--oh-orange); padding: 1px 6px; border-radius: 3px; font-weight: 700; letter-spacing: 0.3px; }
  .admin-event-time { color: #BBB; margin-left: auto; font-size: 11px; }
  .admin-event-body { font-size: 13px; color: #555; line-height: 1.5; }
  .admin-event.is-system .admin-event-body { color: #888; }

  /* ===== Admin: comment input ===== */
  .admin-comment-input { display: flex; gap: 8px; padding: 12px 24px; border-top: 1px solid #E8E6E0; background: #FAFAF8; }
  .admin-comment-input input { flex: 1; padding: 10px 14px; border: 1px solid #E8E6E0; border-radius: 8px; font-size: 13px; outline: none; font-family: inherit; background: #fff; color: #222; }
  .admin-comment-input input:focus { border-color: var(--oh-orange); }
  .admin-comment-input button { padding: 10px 18px; background: var(--oh-orange); color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
  .admin-comment-input button:hover:not(:disabled) { background: #E55C1E; }
  .admin-comment-input button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ===== Turn 1: admin edit/delete/CP-history/filters ===== */

  /* Admin action bar (Edit, Archive buttons at top of panel) */
  .admin-panel-actions {
    display: flex;
    gap: 8px;
    padding: 10px 24px;
    border-bottom: 1px solid var(--oh-border);
    background: #FAFAFA;
  }
  .btn-secondary-sm {
    padding: 6px 12px; font-size: 13px; font-weight: 600;
    background: #fff; border: 1px solid var(--oh-border); border-radius: 6px;
    cursor: pointer; color: #333;
  }
  .btn-secondary-sm:hover { background: #f5f5f5; }
  .btn-secondary-sm:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary-sm {
    padding: 6px 14px; font-size: 13px; font-weight: 600;
    background: var(--oh-orange); color: #fff; border: 1px solid var(--oh-orange);
    border-radius: 6px; cursor: pointer;
  }
  .btn-primary-sm:hover { background: #E65A1C; }
  .btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger-sm {
    padding: 6px 12px; font-size: 13px; font-weight: 600;
    background: #fff; border: 1px solid #FCA5A5; border-radius: 6px;
    cursor: pointer; color: #DC2626;
  }
  .btn-danger-sm:hover { background: #FEE2E2; border-color: #DC2626; }
  .btn-danger-sm:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Edit mode form grid */
  .admin-edit-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 16px;
  }
  .admin-edit-full { grid-column: 1 / -1; }
  .admin-edit-input {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    border: 1px solid var(--oh-border);
    border-radius: 6px;
    margin-top: 4px;
    font-family: inherit;
  }
  .admin-edit-input:focus {
    outline: none;
    border-color: var(--oh-orange);
    box-shadow: 0 0 0 3px rgba(255,107,43,0.12);
  }

  /* Link-styled button (for clicking CP name -> open history) */
  .link-btn {
    background: none; border: none; padding: 0;
    color: var(--oh-orange); font-weight: 600; cursor: pointer;
    font-size: inherit; text-align: left;
  }
  .link-btn:hover { text-decoration: underline; }

  /* Filter bar */
  .filter-toggle {
    padding: 8px 14px;
    background: #fff;
    border: 1px solid var(--oh-border);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: #444;
  }
  .filter-toggle:hover { background: #f5f5f5; }
  .filter-toggle.active { background: #222; color: #fff; border-color: #222; }
  .filter-toggle.has-active { border-color: var(--oh-orange); color: var(--oh-orange); }
  .filter-toggle.active.has-active { background: var(--oh-orange); color: #fff; border-color: var(--oh-orange); }

  .admin-filter-bar {
    display: flex;
    gap: 16px;
    padding: 12px 28px;
    background: #FAFAFA;
    border-bottom: 1px solid var(--oh-border);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .filter-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .filter-field label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    font-weight: 600;
  }
  .filter-field select, .filter-field input {
    padding: 7px 10px;
    font-size: 13px;
    border: 1px solid var(--oh-border);
    border-radius: 6px;
    background: #fff;
    font-family: inherit;
    min-width: 140px;
  }

  /* CP history drawer */
  .admin-panel-cp {
    /* Reuse admin-panel but maybe slightly wider */
  }
  .cp-stats-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .cp-stat {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .cp-stat-dot {
    width: 8px; height: 8px; border-radius: 50%;
  }
  .cp-stat-count {
    font-weight: 700;
    font-size: 15px;
  }
  .cp-stat-label {
    color: #666;
  }

  .cp-history-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
    padding: 12px;
    margin-bottom: 8px;
    background: #FAFAFA;
    border: 1px solid var(--oh-border);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    gap: 12px;
  }
  .cp-history-row:hover {
    background: #fff;
    border-color: var(--oh-orange);
    box-shadow: 0 0 0 2px rgba(255,107,43,0.08);
  }
  .cp-history-main {
    flex: 1;
    min-width: 0;
  }
  .cp-history-title {
    font-weight: 600;
    font-size: 14px;
    color: #222;
  }
  .cp-history-meta {
    font-size: 12px;
    color: #777;
    margin-top: 3px;
  }
  .cp-history-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }
  .cp-history-price {
    font-size: 13px;
    font-weight: 700;
    color: var(--oh-orange);
  }
  .cp-history-time {
    font-size: 11px;
    color: #999;
  }

  @media (max-width: 520px) {
    .admin-edit-grid { grid-template-columns: 1fr; }
    .admin-filter-bar { padding: 12px 16px; gap: 10px; }
    .filter-field select, .filter-field input { min-width: 110px; }
    .admin-panel-actions { padding: 8px 18px; }
  }

  /* ===== Turn 2: photos, bulk select, notes, assignment ===== */

  /* Photo grid in DetailPanel */
  .admin-photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  .admin-photo-thumb {
    position: relative;
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--oh-border);
    background: #f0f0f0;
  }
  .admin-photo-thumb img {
    width: 100%; height: 100%;
    object-fit: cover;
    cursor: zoom-in;
    display: block;
  }
  .admin-photo-remove {
    position: absolute;
    top: 4px; right: 4px;
    width: 20px; height: 20px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    color: #fff;
    border: none;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .admin-photo-remove:hover { background: #DC2626; }

  /* Photo lightbox */
  .photo-lightbox {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
  }
  .photo-lightbox img {
    max-width: 95vw;
    max-height: 95vh;
    object-fit: contain;
    border-radius: 8px;
  }
  .photo-lightbox-close {
    position: absolute;
    top: 20px; right: 20px;
    width: 40px; height: 40px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    color: #fff;
    border: none;
    font-size: 18px;
    cursor: pointer;
  }
  .photo-lightbox-close:hover { background: rgba(255,255,255,0.3); }

  /* Bulk selection */
  .board-card-checkbox {
    position: absolute;
    top: 8px; right: 8px;
    width: 18px; height: 18px;
    cursor: pointer;
  }
  .board-card.bulk-selected {
    border-color: var(--oh-orange);
    background: #FFF3ED;
    box-shadow: 0 0 0 2px rgba(255,107,43,0.18);
  }
  .admin-table tbody tr.bulk-selected {
    background: #FFF3ED;
  }

  .bulk-action-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 28px;
    background: #FFF8F4;
    border-bottom: 1px solid var(--oh-orange);
    font-size: 13px;
    font-weight: 600;
    color: #333;
    flex-wrap: wrap;
  }

  /* CP notes thread */
  .cp-note {
    background: #FFF8F4;
    border: 1px solid #FFE3D1;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .cp-note-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 4px;
  }
  .cp-note-body {
    font-size: 13px;
    color: #333;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .cp-note-delete {
    margin-left: auto;
    background: none;
    border: none;
    color: #999;
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .cp-note-delete:hover { color: #DC2626; background: #FEE2E2; }

  @media (max-width: 520px) {
    .bulk-action-bar { padding: 10px 14px; gap: 6px; font-size: 12px; }
    .admin-photo-grid { grid-template-columns: repeat(3, 1fr); }
  }

  /* ===== OTP input (6-box) ===== */
  .otp-input-row {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin: 8px 0;
  }
  .otp-digit {
    width: 44px;
    height: 54px;
    font-size: 22px;
    font-weight: 700;
    text-align: center;
    border: 1.5px solid var(--oh-border);
    border-radius: 10px;
    background: #fff;
    font-family: inherit;
    color: #222;
    padding: 0;
    -moz-appearance: textfield;
  }
  .otp-digit::-webkit-outer-spin-button,
  .otp-digit::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .otp-digit:focus {
    outline: none;
    border-color: var(--oh-orange);
    box-shadow: 0 0 0 3px rgba(255,107,43,0.15);
  }
  .otp-digit:disabled { background: #F5F5F5; color: #999; }

  @media (max-width: 420px) {
    .otp-input-row { gap: 7px; }
    .otp-digit { width: 40px; height: 48px; font-size: 20px; }
  }

  /* ===== Mobile polish (< 520px) ===== */
  @media (max-width: 520px) {
    .chatbot-fab { left: 18px; bottom: 88px; }
    .chatbot-panel { left: 12px; right: 12px; width: auto; bottom: 88px; }
    .dash-stats { padding: 12px 16px 4px; gap: 8px; }
    .dash-stat { padding: 12px 6px; }
    .dash-stat-num { font-size: 22px; }
    .unit-card { margin: 0 16px 10px; }
    .section-title { padding: 16px 16px 10px; font-size: 18px; }
    .form-section { padding: 0 16px 20px; }
    .admin-topbar { padding: 0 16px; }
    .admin-toolbar { padding: 12px 16px; gap: 10px; }
    .admin-board { padding: 16px; gap: 12px; }
    .admin-stats { padding: 12px 16px 0; gap: 8px; }
    .stat-card { min-width: 90px; padding: 12px; }
    .stat-num { font-size: 22px; }
    .search-form { flex: 1; min-width: 0; }
    .search-box { width: 100%; min-width: 0; flex: 1; }
    .admin-panel { width: 100vw; }
    .admin-panel-section { padding: 14px 18px; }
    .admin-detail-grid { gap: 10px; }
    .admin-comment-input { padding: 10px 18px; }
  }

  /* iPhone notch / safe area */
  @supports (padding: env(safe-area-inset-bottom)) {
    .app-shell { padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
  }
`;