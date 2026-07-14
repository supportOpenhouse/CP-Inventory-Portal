/**
 * Terms & Privacy links to the Openhouse public site. Shared by the login page
 * and the CP profile so the URLs live in exactly one place.
 *   prefix — leading text before the links (pass "" for a bare "Terms & Privacy
 *            Policy." footer). Defaults to the login "agree" line.
 */
export const TERMS_URL = 'https://www.openhouse.in/terms/';
export const PRIVACY_URL = 'https://www.openhouse.in/privacy-policy/';

export default function LegalLinks({ prefix = 'By continuing you agree to our', className = '' }) {
  return (
    <div className={`legal-links muted${className ? ` ${className}` : ''}`}>
      {prefix ? `${prefix} ` : ''}
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">Terms</a>
      {' & '}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
    </div>
  );
}
