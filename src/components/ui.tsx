import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import EditorModule from 'react-simple-code-editor';

// react-simple-code-editor is CommonJS; depending on the bundler interop the
// default import is either the component or a module object wrapping it.
const Editor = ((EditorModule as unknown as { default?: typeof EditorModule }).default ?? EditorModule) as typeof EditorModule;
import type { CodeSnippet, Difficulty, FollowUp } from '../types';
import { highlight, normalizeLang } from '../lib/highlight';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children: c }) {
            const match = /language-(\w+)/.exec(className ?? '');
            const text = String(c).replace(/\n$/, '');
            if (match || text.includes('\n')) {
              return <CodeBlock snippet={{ language: match?.[1] ?? 'text', code: text }} />;
            }
            return <code className="inline-code">{c}</code>;
          },
          pre({ children: c }) {
            return <>{c}</>;
          },
          table({ children: c }) {
            return (
              <div className="table-wrap">
                <table>{c}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function CodeBlock({ snippet, compact }: { snippet: CodeSnippet; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const lang = normalizeLang(snippet.language);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <figure className={`code ${compact ? 'code-compact' : ''}`}>
      <figcaption>
        <span className="code-title">{snippet.title ?? ''}</span>
        <span className="code-lang">{lang}</span>
        <button className="btn-ghost btn-xs" onClick={copy} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre className={`language-${lang}`}>
        <code dangerouslySetInnerHTML={{ __html: highlight(snippet.code, lang) }} />
      </pre>
    </figure>
  );
}

export function CodeEditor({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
}) {
  return (
    <div className="editor">
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={(c) => highlight(c, language)}
        padding={14}
        tabSize={2}
        insertSpaces
        textareaClassName="editor-textarea"
        className={`language-${normalizeLang(language)}`}
        style={{ fontFamily: 'var(--mono)', fontSize: 13, minHeight: 220 }}
      />
    </div>
  );
}

export function Diagram({ text }: { text: string }) {
  return <pre className="diagram">{text}</pre>;
}

export function DifficultyBadge({ d }: { d: Difficulty }) {
  return <span className={`badge badge-${d}`}>{d}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProgressBar({ value, tone }: { value: number; tone?: 'good' | 'warn' }) {
  return (
    <div className="pbar">
      <div className={`pbar-fill ${tone ? `pbar-${tone}` : ''}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Reveal({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`reveal ${open ? 'open' : ''}`}>
      <button type="button" className="reveal-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span> {label}
      </button>
      {open && <div className="reveal-body">{children}</div>}
    </div>
  );
}

/** Interviewer follow-ups, revealed one at a time like a real interview. */
export function FollowUps({ items, startOpen = 1 }: { items?: FollowUp[]; startOpen?: number }) {
  const [shown, setShown] = useState(Math.min(startOpen, items?.length ?? 0));
  if (!items?.length) return null;
  return (
    <div className="followups">
      <div className="label">🎙 Interviewer follows up</div>
      {items.slice(0, shown).map((f, i) => (
        <div key={i} className="followup">
          <div className="fq">↳ {f.q}</div>
          <Reveal label="Show answer">
            <Markdown>{f.a}</Markdown>
          </Reveal>
        </div>
      ))}
      {shown < items.length && (
        <button className="btn-ghost" type="button" onClick={() => setShown((s) => s + 1)}>
          + Next follow-up ({shown}/{items.length})
        </button>
      )}
    </div>
  );
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
