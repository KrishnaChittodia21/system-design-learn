import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** "Next up" footer at the end of a tab: one clear action to keep moving along the study path. */
export function NextUp({ lead, label, to, onClick }: { lead: ReactNode; label: string; to?: string; onClick?: () => void }) {
  return (
    <div className="card next-up">
      <div>{lead}</div>
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
