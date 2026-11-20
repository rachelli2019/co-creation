import {useSessionDraft} from './useSessionDraft';
import { useEffect, useState } from 'react';
import { recallApi } from './recallApi';
import { surveyPages } from './surveyQuestions';
import { orderSurveyPages } from './surveyOrder';
import type { SurveyQuestion } from './surveyQuestions';
import { usePageThrough } from './previewMode';
import type { AIAccess } from './writingConfig';
type SurveyAnswer = string | number | number[];
export type SurveyAnswers = Record<string, SurveyAnswer>;
export interface RecallQuestion {id: string; category: string; question: string; choices: string[]}
export interface RecallSet {id: string; questions: RecallQuestion[]; simulated: boolean}
export type RecallState = {status: 'loading'} | {status: 'error'; message: string} | {status: 'ready'; data: RecallSet};
export interface RecallScore {generationId: string; answers: number[]; correct: boolean[]; score: number; total: number; bonusCents: number; simulated: boolean}
export interface PostTaskResponse {version: string; answers: SurveyAnswers; recall: RecallScore | {status: 'skipped_preview'}; pageThrough: boolean; surveySubmittedAt: string | null; pageOrder: string[]; questionOrder: string[]}

function Question({question: q, value, setValue, number}: {question: SurveyQuestion; value: SurveyAnswer | undefined; setValue: (value: SurveyAnswer) => void; number: number | string}) {
  const scalarValue = Array.isArray(value) ? '' : value ?? '';
  const selected = Array.isArray(value) ? value : [];
  return <fieldset className="border-b border-gray-200 pb-7 last:border-0">
    <legend className="font-medium text-gray-900 mb-3">{number}. {q.text}</legend>
    {q.description && <p className="text-sm text-gray-600 mb-3">{q.description}</p>}
    {q.kind === 'checklist' ? <div className="space-y-2">
      <p className="text-sm text-gray-600 mb-3">Select all that apply. Choose the first statement only if none of the others apply.</p>
      {q.choices?.map((choice, index) => <label key={choice} className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 ${selected.includes(index) ? 'border-indigo-600 bg-indigo-50' : 'border-gray-300'}`}>
        <input type="checkbox" className="mt-1" checked={selected.includes(index)} onChange={e => setValue(e.target.checked ? index === 0 ? [0] : [...selected.filter(n => n !== 0), index].sort((a, b) => a - b) : selected.filter(n => n !== index))} />
        <span>{choice}</span>
      </label>)}
    </div> : q.kind === 'text' ? <textarea aria-label={q.text} value={scalarValue} onChange={e => setValue(e.target.value)} className="w-full min-h-28 border rounded-lg p-3" /> :
      q.kind === 'choice' ? <div className={q.choiceLayout === 'vertical' ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {q.choices?.map(choice => <label key={choice} className={`cursor-pointer rounded-lg border p-3 ${q.choiceLayout === 'vertical' ? 'flex items-start gap-3 text-left' : 'flex-1 min-w-20 text-center'} ${value === choice ? 'border-indigo-600 bg-indigo-50' : 'border-gray-300'}`}>
          <input type="radio" name={q.id} value={choice} checked={value === choice} onChange={() => setValue(choice)} className={q.choiceLayout === 'vertical' ? 'mt-1 shrink-0' : undefined} /><span className={q.choiceLayout === 'vertical' ? 'text-sm text-gray-600' : 'block mt-2 text-sm text-gray-600'}>{choice}</span>
        </label>)}
      </div> : q.kind === 'credit' ? <div>
        <p className="text-sm text-gray-600 mb-3">Rate from 0 to 100, considering both your contributions and the AI writing assistant’s contributions.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-4"><span>0 = You deserve <strong>none</strong> of the credit</span><span>50 = Equal credit</span><span>100 = You deserve <strong>all</strong> the credit</span></div>
        <p className="mb-4 rounded-lg bg-indigo-50 p-4 text-sm text-gray-800"><strong>Bonus:</strong> Independent reviewers will evaluate your story and conversation with the AI writing assistant. You can earn up to <strong>$1</strong> based on how closely your answer matches their average rating. The closer the match, the higher your bonus.</p>
        <label className="flex gap-3 items-center">Your rating <input type="number" min="0" max="100" step="1" aria-label={q.text} value={scalarValue} onChange={e => setValue(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded-lg p-2 w-24" /><span>out of 100</span></label>
      </div> : <div className="flex flex-wrap gap-2">
        {Array.from({length: q.max! - q.min! + 1}, (_, i) => q.min! + i).map((n, i) => <label key={n} className={`flex-1 min-w-20 cursor-pointer rounded-lg border p-3 text-center ${value === n ? 'border-indigo-600 bg-indigo-50' : 'border-gray-300'}`}>
          <input type="radio" name={q.id} value={n} checked={value === n} onChange={() => setValue(n)} className="mr-2" />{n}
          {q.labels?.[i] && <span className="block mt-2 text-xs text-gray-600">{q.labels[i]}</span>}
        </label>)}
      </div>}
  </fieldset>;
}
export default function PostTaskSurvey({hasAI, aiAccess, recall, preview, sessionId, onRetryQuiz, onSubmit}: {
  hasAI: boolean; aiAccess: AIAccess; recall: RecallState; preview: boolean; sessionId: string | null;
  onRetryQuiz: () => void;
  onSubmit: (response: PostTaskResponse) => Promise<void>;
}) {
  const skip = usePageThrough();
  const splitStrategy = hasAI && aiAccess === 'both';
  const [localOrderSeed] = useState(() => crypto.randomUUID());
  const orderedPages = orderSurveyPages(surveyPages, sessionId ?? localOrderSeed);
  let questionNumber = 0;
  const pages = orderedPages.map(p => ({...p, questions: p.questions.filter(q => !q.aiOnly || hasAI).flatMap(q => {
    const number = ++questionNumber;
    if (q.id !== 'ai_strategy') return [{...q, number: String(number)}];
    const phases = aiAccess === 'both' ? ['rough', 'final'] : [aiAccess];
    return phases.map((phase, i) => ({...q,
      id: `ai_strategy_${phase}`,
      text: `What was your strategy in using the AI writing assistant during the ${phase} draft section?`,
      number: splitStrategy ? `${number}${i === 0 ? 'a' : 'b'}` : String(number),
    }));
  })})).filter(p => p.questions.length);
  const pageOrder = pages.map(p => p.id);
  const questionOrder = pages.flatMap(p => p.questions.map(q => q.id));
  const draftKey = !preview && sessionId ? `${sessionId}:survey` : null;
  const [page, setPage] = useSessionDraft(draftKey && `${draftKey}:page`, 0);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  const [answers, setAnswers] = useSessionDraft<SurveyAnswers>(draftKey && `${draftKey}:answers`, {});
  const [recallAnswers, setRecallAnswers] = useSessionDraft<Record<string, number>>(draftKey && `${draftKey}:quiz`, {});
  const [saving, setSaving] = useState(false);
  const [surveySubmittedAt, setSurveySubmittedAt] = useSessionDraft<string | null>(draftKey && `${draftKey}:submitted`, null);
  const [error, setError] = useState('');
  const isRecall = page === pages.length;
  const current = pages[page];
  const valid = isRecall ? recall.status === 'ready' && recall.data.questions.every(q => recallAnswers[q.id] !== undefined) : current.questions.every(q => {
    const v = answers[q.id];
    if (q.kind === 'checklist') return Array.isArray(v) && v.length > 0 && (!v.includes(0) || v.length === 1) && v.every(n => Number.isInteger(n) && n >= 0 && n < (q.choices?.length ?? 0));
    if (q.kind === 'choice') return typeof v === 'string' && q.choices?.includes(v);
    return q.kind === 'text' ? typeof v === 'string' && !!v.trim() : typeof v === 'number' && Number.isInteger(v) && v >= (q.kind === 'credit' ? 0 : q.min!) && v <= (q.kind === 'credit' ? 100 : q.max!);
  });
  const canContinue = valid || (isRecall && skip);
  async function next() {
    if (!canContinue) return;
    if (!isRecall && page < pages.length - 1) {setPage(p => p + 1); return;}
    if (saving) return;
    setSaving(true); setError('');
    try {
      if (!isRecall) {
        const submittedAt = new Date().toISOString();
        await recallApi({action: 'save_record', kind: 'survey', preview, sessionId, payload: {version: '20', pageOrder, questionOrder, answers, submittedAt, pageThrough: skip}});
        setSurveySubmittedAt(submittedAt);
        setPage(pages.length);
        return;
      }
      const scored = skip && !valid ? {status: 'skipped_preview' as const} : await recallApi({action: 'score', preview, sessionId, id: recall.status === 'ready' ? recall.data.id : '', answers: recall.status === 'ready' ? recall.data.questions.map(q => recallAnswers[q.id]) : []}) as RecallScore;
      await onSubmit({version: '20', pageOrder, questionOrder, answers, recall: scored, pageThrough: skip, surveySubmittedAt});
    } catch (e) {setError(e instanceof Error ? e.message : 'Unable to save. Please try again.');}
    finally {setSaving(false);}
  }
  return <div className="min-h-screen bg-gray-50 py-8 px-4"><main className="max-w-3xl mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow">
    {!isRecall && <p className="text-sm text-gray-500 mb-2">Page {page + 1} of {pages.length}</p>}
    <h1 className="text-2xl font-semibold mb-3">{isRecall ? 'Quiz' : 'Survey'}</h1>
    <p className="text-gray-600 mb-8">{isRecall ? 'Answer these questions from memory. Choose one answer for each question.' : current.intro || 'Please answer the following questions about your experience.'}</p>
    {isRecall && <p className="mb-6 rounded-lg bg-indigo-50 p-4 text-sm text-gray-800"><strong>Bonus:</strong> You will earn an extra <strong>$0.10 for each correct answer</strong>, up to <strong>$0.50</strong> for all five questions.</p>}
    <div className="space-y-7">
      {!isRecall && current.questions.map(q => <Question key={q.id} question={q} number={q.number} value={answers[q.id]} setValue={v => setAnswers(a => ({...a, [q.id]: v}))} />)}
      {isRecall && recall.status === 'loading' && <p role="status">Preparing your story questions… Please wait a moment.</p>}
      {isRecall && recall.status === 'error' && <div><p role="alert" className="text-red-700">{recall.message}</p><button className="mt-3 border rounded-lg px-4 py-2" onClick={onRetryQuiz}>Retry preparing quiz</button></div>}
      {isRecall && recall.status === 'ready' && <>
        {recall.data.simulated && <p className="p-3 rounded bg-amber-50 text-sm">Local preview: these are example questions to test the layout, not a factual assessment of your story.</p>}
        {recall.data.questions.map((q, i) => <fieldset key={q.id} className="border-b pb-6"><legend className="font-medium mb-3">{i + 1}. {q.question}</legend>
          <div className="space-y-2">{q.choices.map((choice, n) => <label key={n} className="flex items-start gap-3 border rounded-lg p-3 cursor-pointer"><input type="radio" className="mt-1" name={q.id} checked={recallAnswers[q.id] === n} onChange={() => setRecallAnswers(a => ({...a, [q.id]: n}))} /><span>{choice}</span></label>)}</div>
        </fieldset>)}
      </>}
    </div>
    {error && <p role="alert" className="text-red-700 mt-6">{error}</p>}
    <div className="flex justify-between items-center mt-8 gap-4">
      <button hidden={isRecall} disabled={page === 0 || saving} className="border rounded-lg px-4 py-2 disabled:opacity-40" onClick={() => setPage(p => p - 1)}>Back</button>
      <button disabled={!canContinue || saving} className="bg-black text-white rounded-lg px-5 py-2 disabled:bg-gray-300" onClick={next}>{saving ? 'Saving…' : isRecall ? 'Submit quiz' : page === pages.length - 1 ? 'Submit survey' : 'Continue'}</button>
    </div>
    {!canContinue && <p className="text-sm text-gray-500 mt-3">Please answer every question on this page to continue.</p>}
  </main></div>;
}
