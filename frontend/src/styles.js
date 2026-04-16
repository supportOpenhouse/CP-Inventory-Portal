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
    --oh-shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
    --oh-shadow-lg: 0 4px 16px rgba(0,0,0,0.08);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body, html, #root { height: 100%; background: var(--oh-bg-warm); font-family: 'DM Sans', sans-serif; color: var(--oh-charcoal); -webkit-font-smoothing: antialiased; }

  .app-shell { max-width: 480px; margin: 0 auto; background: #fff; min-height: 100vh; position: relative; box-shadow: var(--oh-shadow-lg); }

  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; color: #fff; }
  .header-brand { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .header-brand-accent { color: var(--oh-orange); }
  .header-user { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .header-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--oh-orange); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
  .logout-btn { background: rgba(255,255,255,0.12); color: #fff; border: none; padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .logout-btn:hover { background: rgba(255,255,255,0.2); }

  /* Form cards & inputs */
  .form-section { padding: 0 20px 20px; }
  .form-card { background: #fff; border: 1px solid var(--oh-border); border-radius: 12px; padding: 16px; margin-top: 16px; box-shadow: var(--oh-shadow-sm); }
  .form-card-title { font-size: 13px; font-weight: 600; color: var(--oh-charcoal); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
  .input-label { font-size: 12px; color: var(--oh-gray); font-weight: 500; margin-bottom: 6px; }
  .input-field, .select-field { width: 100%; padding: 11px 14px; border: 1.5px solid var(--oh-border); border-radius: 10px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; color: var(--oh-charcoal); background: #fff; transition: border-color 0.15s, box-shadow 0.15s; }
  .input-field:focus, .select-field:focus { border-color: var(--oh-orange); box-shadow: 0 0 0 3px rgba(255,107,43,0.08); }
  .input-field::placeholder { color: #B5B5B5; }
  .input-error { border-color: #EF4444 !important; }
  .error-text { color: #EF4444; font-size: 12px; margin-top: 4px; }

  .primary-btn { width: 100%; padding: 14px; background: var(--oh-orange); color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, transform 0.1s; }
  .primary-btn:hover:not(:disabled) { background: #E55C1E; }
  .primary-btn:active { transform: scale(0.98); }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Login-specific */
  .login-hero { padding: 48px 20px 24px; text-align: center; }
  .login-logo { font-family: 'Fraunces', serif; font-size: 36px; font-weight: 700; color: var(--oh-charcoal); letter-spacing: -1px; }
  .login-logo-accent { color: var(--oh-orange); }
  .login-tagline { font-size: 14px; color: var(--oh-gray); margin-top: 6px; }

  /* RM contact cards (shown on "not registered") */
  .rm-card { background: var(--oh-orange-light); border: 1.5px solid var(--oh-orange); border-radius: 12px; padding: 16px; margin-top: 12px; text-align: center; }
  .rm-card-title { font-weight: 600; font-size: 13px; color: var(--oh-orange); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .rm-card-name { font-size: 14px; color: var(--oh-charcoal); font-weight: 500; }
  .rm-card-phone { font-size: 18px; font-weight: 700; color: var(--oh-orange); margin-top: 4px; }
  .rm-card a { color: var(--oh-orange); text-decoration: none; }

  /* Section titles */
  .section-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: var(--oh-charcoal); padding: 16px 20px 12px; }

  /* Empty state */
  .empty-state { text-align: center; padding: 48px 32px; color: var(--oh-gray); }
  .empty-state-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; }
  .empty-state p { font-size: 14px; line-height: 1.5; }

  /* Loading spinner */
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
