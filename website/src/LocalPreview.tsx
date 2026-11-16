import { useState } from 'react';
import { PreviewMode } from './previewMode';
import StudyApp from './App';
import { accessLabels, parseAIAccess } from './writingConfig';
import type { AIAccess } from './writingConfig';

export default function LocalPreview() {
  const [access, setAccess] = useState<AIAccess>(() => parseAIAccess(import.meta.env.VITE_WRITING_AI_ACCESS));
  const [skipTimers, setSkipTimers] = useState(!import.meta.env.DEV);
  const [run, setRun] = useState(0);
  const [startAt, setStartAt] = useState<1 | 4>(1);
  return <PreviewMode.Provider value={skipTimers}>
    <div className="bg-amber-50 border-b border-amber-300 p-4 pr-32 text-sm">
      <strong>{import.meta.env.DEV ? 'Local study test' : 'Study preview'}</strong> · Same study screens. Page-through mode also disables focus and fullscreen checks. AI writing assistant replies are simulated; no database writes.
      <div className="flex flex-wrap gap-3 items-center mt-2">
        <label htmlFor="ai-access">AI writing assistant access</label>
        <select id="ai-access" className="border rounded p-2 bg-white" value={access}
          onChange={e => {setAccess(e.target.value as AIAccess); setRun(n => n + 1);}}>
          {Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="border rounded px-3 py-2" onClick={() => {setStartAt(1); setRun(n => n + 1);}}>Restart full study</button>
        <button className="border rounded px-3 py-2" onClick={() => {setStartAt(4); setRun(n => n + 1);}}>Test writing section directly</button>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={skipTimers} onChange={e => setSkipTimers(e.target.checked)} />Page through UI (skip waits and required answers)</label>
        <span>Changing the setting restarts this test. Test participant: AI-DIV.</span>
      </div>
    </div>
    <StudyApp key={`${run}-${skipTimers}`} preview access={access} startAt={startAt} />
  </PreviewMode.Provider>;
}
