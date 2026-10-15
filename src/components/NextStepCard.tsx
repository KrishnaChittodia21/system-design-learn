import { motion } from 'motion/react';
import { ArrowRight, History, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NextStep } from '../lib/nextStep';

/** The dashboard's one obvious action, plus "continue where you left off" and a weak-area revision. */
export function NextStepCard({ step, resume }: { step: NextStep; resume?: { href: string; label: string } | null }) {
  return (
    <motion.section
      className="card next-step"
      aria-labelledby="next-step-title"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="next-step-main">
        <div className="eyebrow">
          <Sparkles size={14} aria-hidden /> Your next step
        </div>
        <h2 id="next-step-title">{step.title}</h2>
        <p className="muted">{step.detail}</p>
        <div className="row wrap gap-s">
          <Link className="btn btn-primary btn-lg" to={step.href}>
            {step.kind === 'start' ? 'Start' : step.kind === 'read' ? 'Read it' : 'Go'} <ArrowRight size={18} aria-hidden />
          </Link>
          {step.secondary && (
            <Link className="btn" to={step.secondary.href}>
              <Target size={16} aria-hidden /> or {step.secondary.title.charAt(0).toLowerCase() + step.secondary.title.slice(1)}
            </Link>
          )}
        </div>
      </div>
      {resume && (
        <Link className="next-step-resume" to={resume.href}>
          <History size={18} aria-hidden />
          <span>
            <span className="small muted">Continue where you left off</span>
            <span className="next-step-resume-label">{resume.label}</span>
          </span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      )}
    </motion.section>
  );
}
