import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** "Next up" bar at the end of a tab: one clear action to keep moving along the study path. */
export function NextUp({ lead, label, to, onClick }: { lead: ReactNode; label: string; to?: string; onClick?: () => void }) {
  return (
    <div className="next-up glass-flat">
      <div className="next-up-text">
        <div className="eyebrow">Next up</div>
        <div className="next-up-lead">{lead}</div>
      </div>
      {to ? (
        <Link className="btn btn-primary" to={to}>
          {label} <ArrowRight size={16} aria-hidden />
        </Link>
      ) : (
        <button className="btn btn-primary" type="button" onClick={onClick}>
          {label} <ArrowRight size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
