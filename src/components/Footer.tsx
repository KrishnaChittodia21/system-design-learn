import { Link } from 'react-router-dom';
import { Diamond } from 'lucide-react';

/** Site footer at the end of every page: brand on the left, copyright on the right. */
export function Footer() {
  return (
    <footer className="site-footer">
      <Link to="/" className="brand footer-brand">
        <span className="brand-tile" aria-hidden>
          <Diamond size={15} strokeWidth={2.5} />
        </span>
        System Design
      </Link>
      <span className="footer-copy">© 2026 System Design Interview Prep</span>
    </footer>
  );
}
