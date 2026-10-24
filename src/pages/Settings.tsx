import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Compass, GraduationCap, Keyboard, Lightbulb, Monitor, Moon, Palette, RotateCcw, Sun, BookOpen, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { resetProgress, setSettings, useProgress } from '../lib/progress';
import { saveUiPrefs, useUiPrefs } from '../lib/uiPrefs';
import { openTour } from '../lib/guide';
import { ACCENTS } from '../lib/theme';
import { showToast } from '../lib/toast';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const THEMES = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
] as const;

const LOCKS = [
  { id: 'off', label: 'Off', hint: 'Practise anything at any time.' },
  { id: 'exam', label: 'Lock exam', hint: 'The exam opens once every Learn section is read.' },
  { id: 'exam-interview', label: 'Lock exam + interview Qs', hint: 'Both wait until every Learn section is read.' },
] as const;

/** A titled glass panel: heading column on the left (stacks on phones), controls on the right. */
function Panel({ id, icon, tone, title, blurb, danger, children }: { id: string; icon: ReactNode; tone: string; title: string; blurb: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className={`set-panel card ${danger ? 'danger' : ''}`} aria-labelledby={id}>
      <div className="set-panel-head">
        <span className={`set-ic ${tone}`} aria-hidden>
          {icon}
        </span>
        <div>
          <h2 id={id} className="set-title">
            {title}
          </h2>
          <p className="set-blurb">{blurb}</p>
        </div>
      </div>
      <div className="set-panel-body">{children}</div>
    </section>
  );
}

/** A labelled slider with its value as a chip and the filled part of the track drawn in the gradient. */
function Range({ label, value, unit, min, max, step, onChange, note }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void; note?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="set-row set-range">
      <span className="set-row-top">
        <span className="set-label">{label}</span>
        <span className="set-value mono">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--fill': `${fill}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="set-scale mono" aria-hidden>
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </span>
      {note && <span className="set-note">{note}</span>}
    </label>
  );
}

/** A checkbox drawn as a switch (keeps native checkbox semantics; announced as a switch). */
function Switch({ checked, onChange, children, note }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; note?: string }) {
  return (
    <label className="set-row set-switch-row">
      <span className="set-switch-text">
        <span className="set-label">{children}</span>
        {note && <span className="set-note">{note}</span>}
      </span>
      <input type="checkbox" role="switch" className="set-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function SettingsPage() {
  const p = useProgress();
  const s = p.settings;
  const prefs = useUiPrefs();
  const tipsOn = prefs.coachTips !== false;
  const dismissed = Object.keys(prefs.dismissedTips ?? {}).length;
  const [confirming, setConfirming] = useState(false);
  // focus moves into the confirmation when it opens, and back to the reset button when it closes
  const returnFocus = useRef(false);
  const focusOnMount = useCallback((el: HTMLButtonElement | null) => el?.focus(), []);
  const resetRef = useCallback((el: HTMLButtonElement | null) => {
    if (el && returnFocus.current) {
      returnFocus.current = false;
      el.focus();
    }
  }, []);
  const closeConfirm = () => {
    returnFocus.current = true;
    setConfirming(false);
  };

  return (
    <div className="page settings-page">
      <header className="set-head">
        <span className="eyebrow">Settings</span>
        <h1>Exam, study and display settings</h1>
        <p className="lede">Saved in this browser together with your progress.</p>
      </header>

      <Panel id="set-exams" icon={<GraduationCap size={18} />} tone="blue" title="Exams" blurb="How exams are marked and timed.">
        <Range
          label="Pass mark"
          value={s.passMark}
          unit="%"
          min={50}
          max={100}
          step={5}
          onChange={(v) => setSettings({ passMark: v })}
          note="Applies to future attempts. Exams you already passed stay passed."
        />
        <Range
          label="Default time per exam question"
          value={s.secondsPerQuestion}
          unit="s"
          min={30}
          max={300}
          step={15}
          onChange={(v) => setSettings({ secondsPerQuestion: v })}
          note="Sets the default exam duration. You can still override it before each exam."
        />
        <Range label="Default mock-interview length" value={s.mockMinutes} unit=" min" min={15} max={90} step={5} onChange={(v) => setSettings({ mockMinutes: v })} />
        <Switch checked={s.shuffle} onChange={(v) => setSettings({ shuffle: v })}>
          Shuffle questions and options by default
        </Switch>
      </Panel>

      <Panel id="set-study" icon={<BookOpen size={18} />} tone="cyan" title="Study" blurb="Read first, then practise.">
        <div className="set-row">
          <span className="set-label" id="lock-label">
            Study-first lock
          </span>
          <div className="set-options" role="group" aria-labelledby="lock-label">
            {LOCKS.map((o) => {
              const on = s.studyLock === o.id;
              return (
                <button key={o.id} type="button" className={`set-option ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setSettings({ studyLock: o.id })}>
                  <span className="set-option-mark" aria-hidden>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="set-option-text">
                    <strong>{o.label}</strong>
                    <span>{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span className="set-note">Topics you have already passed are never re-locked.</span>
        </div>
      </Panel>

      <Panel id="set-look" icon={<Palette size={18} />} tone="mag" title="Appearance" blurb="Theme and accent colour.">
        <div className="set-row">
          <span className="set-label" id="theme-label">
            Theme
          </span>
          <div className="segmented set-seg" role="group" aria-labelledby="theme-label">
            {THEMES.map(({ id, label, Icon }) => (
              <button key={id} type="button" className={s.theme === id ? 'on' : ''} aria-pressed={s.theme === id} onClick={() => setSettings({ theme: id })}>
                {s.theme === id && <motion.span layoutId="theme-seg-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <span className="set-note">System follows your device. The top bar's sun/moon button switches between light and dark.</span>
        </div>
        <div className="set-row">
          <span className="set-label" id="accent-label">
            Accent
          </span>
          <div className="ink-picker" role="group" aria-labelledby="accent-label">
            {ACCENTS.map((a) => {
              const on = (s.accent ?? 'indigo') === a.id;
              return (
                <button key={a.id} type="button" className={`ink-swatch ${on ? 'on' : ''}`} data-value={a.id} aria-pressed={on} onClick={() => setSettings({ accent: a.id })}>
                  <span className="ink-sample" aria-hidden>
                    Aa
                  </span>
                  <span className="ink-label">
                    {a.label}
                    {on && <Check size={13} strokeWidth={3} aria-hidden />}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="set-note">The colour for links, buttons, highlights and gradients. Passed, in progress and wrong keep their own colours.</span>
        </div>
      </Panel>

      <Panel id="set-guide" icon={<Lightbulb size={18} />} tone="amber" title="Guide" blurb="Tips, the tour and shortcuts.">
        <Switch checked={tipsOn} onChange={(v) => saveUiPrefs({ coachTips: v })} note="A short tip the first time you open each kind of tab.">
          Show coach tips
        </Switch>
        <div className="set-row set-actions">
          <button type="button" className="btn" onClick={openTour}>
            <Compass size={16} aria-hidden /> Replay the welcome tour
          </button>
          {dismissed > 0 && (
            <button type="button" className="btn-ghost" onClick={() => saveUiPrefs({ dismissedTips: {}, coachTips: true })}>
              Show the {dismissed} dismissed tip{dismissed === 1 ? '' : 's'} again
            </button>
          )}
        </div>
        <div className="set-row">
          <span className="set-label">
            <Keyboard size={15} aria-hidden className="set-label-ic" /> Keyboard shortcuts
          </span>
          <dl className="shortcuts" aria-label="Keyboard shortcuts">
            <div>
              <dt>
                <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>K</kbd>
              </dt>
              <dd>Search topics, sections and pages, and jump there</dd>
            </div>
            <div>
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>Filter the syllabus (when its drawer is open on a lesson page)</dd>
            </div>
            <div>
              <dt>
                <kbd>?</kbd>
              </dt>
              <dd>Open the guide</dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel id="set-data" icon={<TriangleAlert size={18} />} tone="rose" title="Data" blurb="Everything lives in this browser." danger>
        <div className="set-row">
          <span className="set-label">Reset progress</span>
          <span className="set-note">Clears exam results, read markers, ratings, drafts and earned achievements. Settings are kept.</span>
          <AnimatePresence mode="wait" initial={false}>
            {confirming ? (
              <motion.div
                key="confirm"
                className="set-confirm"
                role="alertdialog"
                aria-labelledby="reset-q"
                aria-describedby="reset-d"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onKeyDown={(e) => e.key === 'Escape' && closeConfirm()}
              >
                <strong id="reset-q">Reset all progress?</strong>
                <span id="reset-d" className="set-note">
                  This cannot be undone.
                </span>
                <div className="set-actions">
                  <button ref={focusOnMount} type="button" className="btn" onClick={closeConfirm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      resetProgress();
                      closeConfirm();
                      showToast('Progress reset', 'A clean slate. Settings were kept.', 3000, 'gentle');
                    }}
                  >
                    <RotateCcw size={15} aria-hidden /> Yes, reset everything
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="ask" className="set-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                <button ref={resetRef} className="btn btn-danger-soft" type="button" onClick={() => setConfirming(true)}>
                  <RotateCcw size={15} aria-hidden /> Reset all progress
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Panel>
    </div>
  );
}
