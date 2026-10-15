import { useTip } from './hooks';
import { ChartTip, TipRow } from './tooltip';

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
  /** text color for an inline label on this fill */
  ink: string;
}

/**
 * One 100% stacked bar (ordered segments, 2px surface gaps). A segment gets an inline label only when it is
 * wide enough to hold it; the legend, tooltip and table carry the rest.
 */
export function StackedBar({ segments }: { segments: Segment[] }) {
  const { ref, tip, bind } = useTip();
  const total = segments.reduce((a, s) => a + s.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="dv-plot dv-stack" ref={ref}>
      <div className="dv-stack-bar">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const share = (s.value / total) * 100;
            return (
              <div
                key={s.id}
                className="dv-stack-seg dv-mark"
                style={{ flexGrow: s.value, flexBasis: 0, background: s.color, color: s.ink }}
                tabIndex={0}
                role="img"
                aria-label={`${s.label}: ${s.value} (${pct(s.value)}%)`}
                {...bind(<TipRow value={`${s.value} · ${pct(s.value)}%`} label={s.label} color={s.color} />)}
              >
                {share >= 14 && <span className="dv-stack-label">{pct(s.value)}%</span>}
              </div>
            );
          })}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}
