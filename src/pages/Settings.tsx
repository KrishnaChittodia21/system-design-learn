import { resetProgress, setSettings, useProgress } from '../lib/progress';

export default function SettingsPage() {
  const p = useProgress();
  const s = p.settings;
  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <div className="card form">
        <label>
          <span>
            Pass mark: <strong>{s.passMark}%</strong>
          </span>
          <input type="range" min={50} max={100} step={5} value={s.passMark} onChange={(e) => setSettings({ passMark: Number(e.target.value) })} />
          <span className="muted small">Applies to future attempts. Exams you already passed stay passed.</span>
        </label>
        <label>
          <span>
            Default time per exam question: <strong>{s.secondsPerQuestion}s</strong>
          </span>
          <input
            type="range"
            min={30}
            max={300}
            step={15}
            value={s.secondsPerQuestion}
            onChange={(e) => setSettings({ secondsPerQuestion: Number(e.target.value) })}
          />
          <span className="muted small">Sets the default exam duration. You can still override it before each exam.</span>
        </label>
        <label>
          <span>
            Default mock-interview length: <strong>{s.mockMinutes} min</strong>
          </span>
          <input type="range" min={15} max={90} step={5} value={s.mockMinutes} onChange={(e) => setSettings({ mockMinutes: Number(e.target.value) })} />
        </label>
        <div className="field">
          <span>Study-first lock</span>
          <div className="row gap-s wrap">
            {(
              [
                ['off', 'Off'],
                ['exam', 'Lock exam'],
                ['exam-interview', 'Lock exam + interview Qs'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" className={`chip ${s.studyLock === v ? 'on' : ''}`} onClick={() => setSettings({ studyLock: v })}>
                {label}
              </button>
            ))}
          </div>
          <span className="muted small">
            Practice unlocks once every Learn section of the topic is marked read. Topics you have already passed are never re-locked.
          </span>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.shuffle} onChange={(e) => setSettings({ shuffle: e.target.checked })} /> Shuffle questions
          and options by default
        </label>
        <div className="field">
          <span>Theme</span>
          <div className="row gap-s">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} type="button" className={`chip ${s.theme === t ? 'on' : ''}`} onClick={() => setSettings({ theme: t })}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card danger">
        <h3>Reset progress</h3>
        <p className="muted small">Clears exam results, read markers, ratings and drafts. Settings are kept.</p>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => {
            if (window.confirm('Reset all progress? This cannot be undone.')) resetProgress();
          }}
        >
          Reset all progress
        </button>
      </div>
    </div>
  );
}
