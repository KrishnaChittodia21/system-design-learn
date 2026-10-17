import { Link } from 'react-router-dom';
import { BrandMark, Wordmark } from './BrandMark';
import { TOPICS } from '../content';

/** Footer at the end of every page: brand + promise on the left, quick links, then the fine print. */
export function Footer() {
  return (
    <footer className="nb-footer">
      <div className="nb-footer-row">
        <div className="nb-footer-brand">
          <Link to="/" className="nb-brand" aria-label="SysDesign.prep, today">
            <BrandMark size={26} />
            <Wordmark />
          </Link>
          <p>{TOPICS.length} topics, timed exams and real company questions. Progress stays in this browser.</p>
        </div>
        <nav className="nb-footer-links" aria-label="Footer">
          <Link to="/contents">Contents</Link>
          <Link to="/companies">Companies</Link>
          <Link to="/weak-areas">Weak areas</Link>
          <Link to="/achievements">Achievements</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </div>
      <div className="nb-footer-fine">
        <span>© 2026 System Design Interview Prep</span>
        <span className="mono">
          Press <kbd>⌘K</kbd> to search · <kbd>?</kbd> for the guide
        </span>
      </div>
    </footer>
  );
}
