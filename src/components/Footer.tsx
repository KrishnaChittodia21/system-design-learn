import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';

/** Footer at the end of every page: brand on the left, copyright on the right (as in QA Learn). */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-row">
        <Link to="/" className="brand footer-brand">
          <BrandMark size={24} />
          <span className="brand-name">System Design</span>
        </Link>
        <span className="footer-copy">© 2026 System Design Interview Prep</span>
      </div>
    </footer>
  );
}
