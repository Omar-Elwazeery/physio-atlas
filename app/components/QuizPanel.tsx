'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Flame, GraduationCap } from 'lucide-react';
import { REGIONS } from '../lib/catalog';
import {
  boxCounts, buildPool, candidateKeys, clearProgress, loadPrefs, loadProgress, nextQuestion, QUESTION_TYPES, recordAnswer, savePrefs, saveProgress,
  TYPE_LABEL, type Progress, type Question, type QuestionType, type QuizFilter,
} from '../lib/quiz';
import type { QuizStage } from '../lib/atlasState';
import type { Region, Structure } from '../lib/types';

interface Props {
  /** The panel stays mounted (hidden) on other tabs so the question and the session score survive a tab switch. */
  active: boolean;
  structures: Map<string, Structure>;
  /** Tell the viewer what the question needs (highlight, locked selection, isolation). */
  stage: (s: QuizStage) => void;
  /** Question answered: select the structure so the info panel shows it. */
  reveal: (id: string, isolate: boolean) => void;
  focus: (ids: string[]) => void;
  resetView: () => void;
  /** A pending `locate` question receives clicks on the model through this; the handler returns true when it used the click. */
  registerClick: (fn: ((id: string | null) => boolean) | null) => void;
}

type Answer = { kind: 'option'; index: number } | { kind: 'click'; id: string };
interface Result { answer: Answer; correct: boolean }
interface Session { answered: number; correct: number; streak: number; best: number }

const NO_SESSION: Session = { answered: 0, correct: 0, streak: 0, best: 0 };
const rng = () => Math.random();

export default function QuizPanel({ active, structures, stage, reveal, focus, resetView, registerClick }: Props) {
  const pool = useMemo(() => buildPool(structures.values()), [structures]);
  const [filter, setFilter] = useState<QuizFilter>(() => loadPrefs());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [session, setSession] = useState<Session>(NO_SESSION);
  const [q, setQ] = useState<Question | null>(() => nextQuestion(pool, filter, progress, rng));
  const [res, setRes] = useState<Result | null>(null);
  const [showList, setShowList] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const promptId = useId();
  const promptRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);

  const ask = useCallback((f: QuizFilter, p: Progress, avoid: string | null) => {
    setQ(nextQuestion(pool, f, p, rng, avoid));
    setRes(null);
    setShowList(false);
    asked.current = true;
  }, [pool]);

  // ---- viewer: highlight / lock for the pending question, reveal once answered ------------------------------
  useEffect(() => {
    if (!active) return;
    if (!q) { stage({ highlight: null, locked: false, isolate: false }); return; }
    const isolate = q.type === 'identify';
    if (res) { reveal(q.reveal, isolate); return; }
    stage({ highlight: q.highlight, locked: true, isolate });
    if (q.highlight) focus([q.highlight]);
    else if (q.type === 'locate') resetView();
  }, [active, q, res, stage, reveal, focus, resetView]);

  const submit = useCallback((answer: Answer) => {
    if (!q || res) return;
    let correct: boolean;
    if (answer.kind === 'option') correct = answer.index === q.answer;
    else { const s = structures.get(answer.id); correct = !!s && s.kind === 'muscle' && s.key === q.clickKey; }
    const next = recordAnswer(progress, q.key, correct);
    setProgress(next);
    setSaveFailed(!saveProgress(next));
    setSession((s) => { const streak = correct ? s.streak + 1 : 0; return { answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0), streak, best: Math.max(s.best, streak) }; });
    setRes({ answer, correct });
    focus([q.reveal]);
  }, [q, res, progress, structures, focus]);

  // a click on the model answers a pending locate question
  useEffect(() => {
    if (!active || !q || res || q.type !== 'locate') { registerClick(null); return; }
    registerClick((id) => { if (id) submit({ kind: 'click', id }); return true; });
    return () => registerClick(null);
  }, [active, q, res, submit, registerClick]);

  const next = useCallback(() => ask(filter, progress, q?.key ?? null), [ask, filter, progress, q]);

  // Enter on the "Next" button (focused after answering) is handled natively; this covers the other cases
  const optionsVisible = !!q && (q.type !== 'locate' || showList || !!res);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!res && optionsVisible && q && /^[1-4]$/.test(e.key)) { e.preventDefault(); submit({ kind: 'option', index: +e.key - 1 }); }
      else if (res && e.key === 'Enter' && !(t && /^(BUTTON|A)$/.test(t.tagName))) { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, q, res, optionsVisible, submit, next]);

  // focus: the Next button after answering, the new question's prompt afterwards (not on first load)
  useEffect(() => { if (active && res) nextRef.current?.focus({ preventScroll: true }); }, [active, res]);
  useEffect(() => { if (active && q && !res && asked.current) promptRef.current?.focus({ preventScroll: true }); }, [active, q, res]);

  // dev-only hook for visual checks (the answer is exposed, like the other __physio helpers)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__physioQuiz = { question: () => q, progress: () => progress, filter: () => filter };
  }, [q, progress, filter]);

  // ---- filters ----------------------------------------------------------------------------------------------
  const change = (f: QuizFilter) => { setFilter(f); savePrefs(f); ask(f, progress, null); };
  const toggleType = (t: QuestionType) => {
    const types = filter.types.includes(t) ? filter.types.filter((x) => x !== t) : QUESTION_TYPES.filter((x) => filter.types.includes(x) || x === t);
    if (types.length) change({ ...filter, types });
  };
  const toggleRegion = (r: Region) => {
    const cur = filter.regions.length ? filter.regions : REGIONS;
    const regions = REGIONS.filter((x) => (x === r ? !cur.includes(x) : cur.includes(x)));
    if (regions.length) change({ ...filter, regions: regions.length === REGIONS.length ? [] : regions });
  };
  const resetAll = () => {
    clearProgress();
    const fresh: Progress = { v: 1, tick: 0, cards: {} };
    setProgress(fresh); setSession(NO_SESSION); setConfirmReset(false); setSaveFailed(false);
    ask(filter, fresh, null);
  };

  const keys = useMemo(() => candidateKeys(pool, filter), [pool, filter]);
  const boxes = useMemo(() => boxCounts(keys, progress), [keys, progress]);
  const pct = session.answered ? Math.round((session.correct / session.answered) * 100) : null;

  const labelOfClick = res?.answer.kind === 'click' ? structures.get(res.answer.id)?.label ?? '' : '';
  const verdict = res ? (res.correct ? 'Correct.' : 'Not quite.') : '';
  const live = res && q ? `${verdict} ${res.correct ? '' : `The answer is ${q.options[q.answer].label}. `}${q.explanation}` : '';

  return (
    <div className="panel quiz-panel" hidden={!active}>
      <section aria-label="Session score">
        <h2>This session</h2>
        <dl className="quiz-stats">
          <div><dt>Answered</dt><dd>{session.answered}</dd></div>
          <div><dt>Correct</dt><dd>{pct === null ? '–' : `${pct}%`}</dd></div>
          <div><dt><Flame size={11} aria-hidden /> Streak</dt><dd>{session.streak}{session.best > session.streak ? <small> best {session.best}</small> : null}</dd></div>
        </dl>
      </section>

      {q ? (
        <section className="quiz-card" aria-label="Question">
          <p className="quiz-meta">{TYPE_LABEL[q.type]} · {q.region}</p>
          <h3 id={promptId} ref={promptRef} tabIndex={-1} className="quiz-prompt">{q.prompt}</h3>

          {q.type === 'locate' && !res && (
            <>
              <p className="hint">Click it on the 3D model. Deep muscles can sit behind others: rotate the model, or answer from a list instead.</p>
              <button type="button" className="link" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
                {showList ? 'Hide the list' : 'Answer from a list instead'}
              </button>
            </>
          )}
          {q.type === 'identify' && !res && <p className="hint">The structure is highlighted in the 3D view. Its name stays hidden until you answer.</p>}

          {optionsVisible && (
            <div role="group" aria-labelledby={promptId} className="quiz-options">
              {q.options.map((o, i) => {
                const picked = res?.answer.kind === 'option' && res.answer.index === i;
                const isAnswer = i === q.answer;
                const state = !res ? '' : isAnswer ? 'correct' : picked ? 'wrong' : 'dim';
                return (
                  <button key={o.id} type="button" className={`quiz-option ${state}`} aria-keyshortcuts={String(i + 1)} aria-disabled={!!res || undefined}
                    onClick={() => submit({ kind: 'option', index: i })}>
                    <span className="quiz-key" aria-hidden>{i + 1}</span>
                    <span className="quiz-label">{o.label}</span>
                    {res && isAnswer && <span className="sr-only"> (correct answer)</span>}
                    {res && picked && !isAnswer && <span className="sr-only"> (your answer, incorrect)</span>}
                  </button>
                );
              })}
            </div>
          )}

          {res && (
            <div className={`quiz-feedback ${res.correct ? 'correct' : 'wrong'}`}>
              <b>{res.correct ? 'Correct' : 'Not quite'}</b>
              {!res.correct && <span>{labelOfClick ? ` You clicked ${labelOfClick}. ` : ' '}The answer is <b>{q.options[q.answer].label}</b>.</span>}
              <p>{q.explanation}</p>
              <p className="hint">Shown in the 3D view and the panel on the right. Press Enter for the next question.</p>
            </div>
          )}

          {res ? (
            <button ref={nextRef} type="button" className="lesson-button quiz-next" aria-keyshortcuts="Enter" onClick={next}>Next question <ArrowRight size={16} aria-hidden /></button>
          ) : (
            <button type="button" className="link" onClick={next}>Skip this question</button>
          )}
          {!res && <p className="hint">Keys 1 to 4 answer{q.type === 'locate' && !showList ? ' once the list is open' : ''}. Selecting, searching and hovering are switched off until you answer, so the model cannot give the answer away.</p>}
        </section>
      ) : (
        <section aria-label="Question">
          <p className="hint">No questions match these filters. Turn on another question type or region.</p>
        </section>
      )}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</p>

      <section aria-label="Quiz filters">
        <h2>Question types</h2>
        <div className="chips">
          {QUESTION_TYPES.map((t) => (
            <button key={t} type="button" className={`chip ${filter.types.includes(t) ? 'on' : ''}`} aria-pressed={filter.types.includes(t)} onClick={() => toggleType(t)}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
        <h2>Regions</h2>
        <div className="chips">
          {REGIONS.map((r) => {
            const on = !filter.regions.length || filter.regions.includes(r);
            return <button key={r} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleRegion(r)}>{r}</button>;
          })}
        </div>
      </section>

      <section aria-label="Saved progress">
        <h2>Progress</h2>
        <p className="hint">
          {keys.length} questions match: {boxes[0]} new, {boxes[1] + boxes[2]} still learning, {boxes[3] + boxes[4] + boxes[5]} well known.
          Missed questions come back sooner; correct ones return less and less often.
        </p>
        {saveFailed && <p className="hint">Progress could not be saved in this browser, so it will last only until you close the page.</p>}
        {confirmReset ? (
          <div className="chips" role="group" aria-label="Confirm reset">
            <button type="button" className="chip warn" onClick={resetAll}>Yes, erase my progress</button>
            <button type="button" className="chip" onClick={() => setConfirmReset(false)}>Keep it</button>
          </div>
        ) : (
          <button type="button" className="chip warn quiz-reset" onClick={() => setConfirmReset(true)}>Reset progress</button>
        )}
      </section>
    </div>
  );
}

/** Right-hand column of the quiz tab while no structure is shown. */
export function QuizWelcome() {
  return (
    <aside className="info-panel" aria-label="About the quiz">
      <div className="info-kicker"><GraduationCap size={13} /> Quiz</div>
      <div className="info-title-row">
        <div><h1>Test yourself</h1><em>from the same data as the atlas</em></div>
      </div>
      <p className="description">Name a highlighted muscle, bone or joint structure, match a muscle to its nerve, its attachments or a movement it drives, or find it on the model.</p>
      <div className="rule" />
      <h2>How it works</h2>
      <dl className="key-facts">
        <div><dt><span>◇</span> Answer</dt><dd>Click an option or press 1 to 4. After you answer the structure is shown here with its full details.</dd></div>
        <div><dt><span>⌁</span> Repeat</dt><dd>Questions you miss come back sooner. Your progress is kept in this browser only.</dd></div>
        <div><dt><span>⌖</span> Focus</dt><dd>Use the type and region chips on the left to practise one area at a time.</dd></div>
      </dl>
    </aside>
  );
}
