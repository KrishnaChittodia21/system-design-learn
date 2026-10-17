import { Check, Compass, Lightbulb, Monitor, Moon, Sun } from 'lucide-react';
import { resetProgress, setSettings, useProgress } from '../lib/progress';
import { saveUiPrefs, useUiPrefs } from '../lib/uiPrefs';
import { openTour } from '../lib/guide';
import { ACCENTS } from '../lib/theme';

const THEMES = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
] as const;

export default function SettingsPage() {
  const p = useProgress();
  const s = p.settings;
  const prefs = useUiPrefs();
  const tipsOn = prefs.coachTips !== false;
  const dismissed = Object.keys(prefs.dismissedTips ?? {}).length;
  return (
    <div className="page narrow settings-page">
      <div className="eyebrow">Settings</div>
      <h1>Exam, study and display settings</h1>
      <p className="lead">Saved in this browser together with your progress.</p>
      <h2 className="settings-group">Exams</h2>
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
        <label className="check">
          <input type="checkbox" checked={s.shuffle} onChange={(e) => setSettings({ shuffle: e.target.checked })} /> Shuffle questions
          and options by default
        </label>
      </div>
      <h2 className="settings-group">Study</h2>
      <div className="card form">
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
      </div>
      <h2 className="settings-group">Appearance</h2>
      <div className="card form">
        <div className="field">
          <span id="theme-label">Theme</span>
          <div className="segmented" role="group" aria-labelledby="theme-label">
            {THEMES.map(({ id, label, Icon }) => (
              <button key={id} type="button" className={s.theme === id ? 'on' : ''} aria-pressed={s.theme === id} onClick={() => setSettings({ theme: id })}>
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <span className="muted small">System follows your device. The top bar's sun/moon button switches between light and dark.</span>
        </div>
        <div className="field">
          <span id="accent-label">Ink</span>
          <div className="ink-picker" role="group" aria-labelledby="accent-label">
            {ACCENTS.map((a) => {
              const on = (s.accent ?? 'indigo') === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`ink-swatch ${on ? 'on' : ''}`}
                  data-value={a.id}
                  aria-pressed={on}
                  onClick={() => setSettings({ accent: a.id })}
                >
                  <span className="ink-sample" aria-hidden>
                    Aa
                  </span>
                  <span className="ink-label">
                    {on && <Check size={13} strokeWidth={3} aria-hidden />}
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="muted small">The pen colour for links, buttons and highlights. Passed, in progress and wrong keep their own colours.</span>
        </div>
      </div>
      <h2 className="settings-group">Guide</h2>
      <div className="card form">
        <label className="check">
          <input type="checkbox" checked={tipsOn} onChange={(e) => saveUiPrefs({ coachTips: e.target.checked })} />
          <Lightbulb size={15} aria-hidden /> Show coach tips (a short tip the first time you open each kind of tab)
        </label>
        <div className="row gap-s wrap">
          <button type="button" className="btn" onClick={openTour}>
            <Compass size={16} aria-hidden /> Replay the welcome tour
          </button>
          {dismissed > 0 && (
            <button type="button" className="btn-ghost" onClick={() => saveUiPrefs({ dismissedTips: {}, coachTips: true })}>
              Show the {dismissed} dismissed tip{dismissed === 1 ? '' : 's'} again
            </button>
          )}
        </div>
        <dl className="shortcuts" aria-label="Keyboard shortcuts">
          <div>
            <dt>
              <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd>
            </dt>
            <dd>Search topics, sections and pages, and jump there</dd>
          </div>
          <div>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Filter the syllabus (on lesson pages)</dd>
          </div>
          <div>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>Open the guide</dd>
          </div>
        </dl>
      </div>
      <h2 className="settings-group">Data</h2>
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
