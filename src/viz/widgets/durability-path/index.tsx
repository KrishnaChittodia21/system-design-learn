import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import {
  CRASHES,
  CRASH_NAME,
  DRIVE_NAME,
  LOCS,
  LOC_NAME,
  STRATEGY_NAME,
  locSurvives,
  simulate,
  survives,
  type Crash,
  type Drive,
  type Loc,
  type Params,
  type Strategy,
} from './sim';
import './durability-path.css';

type CrashPick = 'none' | Crash;

function lostOn(loc: Loc, drive: Drive): string {
  const l = CRASHES.filter((c) => !locSurvives(loc, c, drive)).map((c) => CRASH_NAME[c].toLowerCase());
  return l.length ? `lost on ${l.join(', ')}` : 'durable';
}

export default function DurabilityPathViz() {
  const [params, setParams] = useState<Params>({ strategy: 'buffered', drive: 'consumer' });
  const [crash, setCrash] = useState<CrashPick>('none');
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { drive } = params;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <div className="dp-ctl">
          <Choice<Strategy>
            label="Commit with"
            value={params.strategy}
            options={(Object.keys(STRATEGY_NAME) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_NAME[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, strategy: v }))}
          />
          <Choice<Drive>
            label="Drive"
            value={params.drive}
            options={[
              { value: 'consumer', label: 'Consumer SSD' },
              { value: 'plp', label: 'Enterprise (PLP)' },
              { value: 'lying', label: 'Lying drive' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, drive: v }))}
          />
          <Choice<CrashPick>
            label="Pull the plug now"
            value={crash}
            options={[{ value: 'none', label: 'No crash' }, ...CRASHES.map((c) => ({ value: c, label: CRASH_NAME[c] }))]}
            onChange={setCrash}
          />
        </div>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> copy of the record
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> dirty (not written back)
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> wiped by the crash
          <span>{DRIVE_NAME[drive]}</span>
        </>
      }
    >
      <div className="dp-wrap">
        <div className="dp-event">
          <code className="dp-call">{f.event}</code>
          {f.cost && <span className="dp-cost">{f.cost}</span>}
          <span className={`dp-ack ${f.acked ? 'is-acked' : ''}`}>{f.acked ? 'client told “committed”' : 'not acknowledged yet'}</span>
        </div>
        <ol className="dp-pipe" aria-label="Durability path">
          {LOCS.map((loc) => {
            const has = f.where.includes(loc);
            const wiped = crash !== 'none' && !locSurvives(loc, crash, drive);
            const hopFrom = f.hop?.[0] === loc;
            const hopTo = f.hop?.[1] === loc;
            return (
              <li key={loc} className={`dp-stop ${hopTo ? 'is-to' : ''} ${hopFrom ? 'is-from' : ''} ${wiped ? 'is-wiped' : ''}`}>
                <span className="dp-name">{LOC_NAME[loc]}</span>
                <span className="dp-vol">{lostOn(loc, drive)}</span>
                <span className="dp-slot">
                  {has ? (
                    <span className={`dp-rec ${loc === 'cache' && f.dirty ? 'is-dirty' : ''} ${wiped ? 'is-lost' : ''}`}>
                      {wiped ? 'record lost' : loc === 'cache' && f.dirty ? 'record · dirty' : 'record'}
                    </span>
                  ) : (
                    <span className="dp-empty">—</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <table className="dp-verdict">
          <caption>If this happens right now…</caption>
          <thead>
            <tr>
              {CRASHES.map((c) => (
                <th key={c} scope="col" className={crash === c ? 'is-picked' : ''}>
                  {CRASH_NAME[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {CRASHES.map((c) => {
                const ok = survives(f.where, c, drive);
                const bad = !ok && f.acked;
                return (
                  <td key={c} className={`${ok ? 'is-ok' : bad ? 'is-bad' : 'is-lost'} ${crash === c ? 'is-picked' : ''}`}>
                    {ok ? 'survives' : bad ? 'acked commit LOST' : 'lost (never acked)'}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}
