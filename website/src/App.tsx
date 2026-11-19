import {useSessionDraft, readDraft, writeDraft} from './useSessionDraft';
import { previewBrainstorm, outlineText } from './previewBrainstorm';
import React, { useEffect, useRef, useState } from "react";
import { ComplianceGate } from "./ComplianceGate";
import { useWritingAttention } from "./useWritingAttention"; 
import { usePageThrough, previewEnabled } from './previewMode';
import PostTaskSurvey from './PostTaskSurvey';
import { recallApi } from './recallApi';
import type { RecallState, PostTaskResponse } from './PostTaskSurvey';
import { studyApi } from './studyApi';
import { startStudy } from './StudyAccess';
import { PHASE_SECONDS, aiEnabled, parseAIAccess, accessLabels } from './writingConfig';
import type { AIAccess, WritingPhase } from './writingConfig';
const STUDY_AI_ACCESS = parseAIAccess(import.meta.env.VITE_WRITING_AI_ACCESS);


/*
  Prolific User Study Skeleton (TypeScript/React, single-file)
  -----------------------------------------------------------
  Features:
  - 4 sequential views: Instructions → Brainstorm → Editor → Survey
  - 2×2 randomized groups with balancing: (AI vs SELF) × (Divergent vs Convergent)
  - Tracks Prolific ID from URL (?PROLIFIC_PID=...)
  - Persists assignment and progress in localStorage (placeholder for a real backend)
  - Editor view supports optional AI Chat panel (split 50/50 when AI group)
  - Keystroke logging scaffold & paste prevention hook in editor
  - Minimal Tailwind-based styling (works in this canvas preview)

  How to plug a backend:
  - Replace LocalStats with API calls in StatsService.
  - Replace LocalStorageAssignment with your server-based assignment lock.
  - POST events (keystrokes, timestamps, content) from each view for audit.

  Group keys: "AI-DIV", "AI-CONV", "SELF-DIV", "SELF-CONV"
*/

// Short timers are opt-in and cannot be enabled in production builds.
const DEV_MODE = import.meta.env.DEV && import.meta.env.VITE_FAST_PREVIEW === 'true';

type GroupKey = "AI-DIV" | "AI-CONV" | "SELF-DIV" | "SELF-CONV";

// Temporarily exclude AI-CONV to balance group sizes

// const GROUPS: GroupKey[] = ["AI-DIV", "AI-CONV", "SELF-DIV", "SELF-CONV"]; // Full randomization

// ---- Utilities ----



const todayISO = () => new Date().toISOString();

// Database access is server-only; participants never receive database credentials.
async function banParticipant(_prolificId: string) {
  await studyApi({action: 'ban'});
}

// ---- Snapshot Tracking System ----
const snapshotBuffer: {session_id:string;timestamp:string;phase:string;textbox:string;text:string}[] = [];
let flushTimer: number | undefined;
let flushing: Promise<void> | undefined;
function flushSnapshots(): Promise<void> {
  if (flushing) return flushing.then(() => flushSnapshots());
  const batch = snapshotBuffer.splice(0, 5);
  if (!batch.length) return Promise.resolve();
  flushing = studyApi({action: 'snapshots', items: batch}).then(() => undefined).catch(error => {
    snapshotBuffer.unshift(...batch);
    throw error;
  }).finally(() => {flushing = undefined;});
  return flushing.then(() => snapshotBuffer.length ? flushSnapshots() : undefined);
}
function scheduleSnapshots() {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flushSnapshots().catch(() => {
      // Keep failed snapshots in memory and retry while the study stays open.
      flushTimer = window.setTimeout(() => {flushTimer = undefined; scheduleSnapshots();}, 5000);
    });
  }, 1000);
}
function saveSnapshot(session_id: string, phase: 'brainstorm'|'writing', textbox: 'main'|'chat', text: string) {
  snapshotBuffer.push({session_id,timestamp:new Date().toISOString(),phase,textbox,text});
  scheduleSnapshots();
}

// ---- Placeholder Stats Service (replace with your backend) ----
class LocalStats {
  static COUNTS_KEY = "study_group_counts_v1";
  static COMPLETED_KEY = "study_completed_ids_v1";

  static getCounts(): Record<GroupKey, number> {
    const raw = localStorage.getItem(LocalStats.COUNTS_KEY);
    if (!raw) return { "AI-DIV": 0, "AI-CONV": 0, "SELF-DIV": 0, "SELF-CONV": 0 };
    try {
      const parsed = JSON.parse(raw);
      return { "AI-DIV": 0, "AI-CONV": 0, "SELF-DIV": 0, "SELF-CONV": 0, ...parsed };
    } catch {
      return { "AI-DIV": 0, "AI-CONV": 0, "SELF-DIV": 0, "SELF-CONV": 0 };
    }
  }

  static increment(group: GroupKey) {
    const counts = LocalStats.getCounts();
    counts[group] = (counts[group] || 0) + 1;
    localStorage.setItem(LocalStats.COUNTS_KEY, JSON.stringify(counts));
  }

  static markCompleted(prolificId: string) {
    const raw = localStorage.getItem(LocalStats.COMPLETED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!arr.includes(prolificId)) {
      arr.push(prolificId);
      localStorage.setItem(LocalStats.COMPLETED_KEY, JSON.stringify(arr));
    }
  }

  static isCompleted(prolificId: string) {
    const raw = localStorage.getItem(LocalStats.COMPLETED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    return arr.includes(prolificId);
  }
}

// ---- Assignment Persistence (placeholder) ----
// ---- Check participant status and handle re-entry ----
// ---- Study Flow State ----

type Step = 1 | 2 | 3 | 4 | 4.1 | 5; // 1=Instructions, 2=Brainstorm, 3=Editor, 4=Survey

interface SessionMeta {
  prolificId: string;
  group: GroupKey;
  startedAt: string;
  aiAccess?: AIAccess;
  testSession?: boolean;
  localPreview?: boolean;
}

// ---- Shared Containers ----
const Shell: React.FC<{ title: string; children: React.ReactNode; footer?: React.ReactNode; onPreviewNext?: () => void }>=({ title, children, footer, onPreviewNext }) => {
  const skip = usePageThrough();
  return (
  <div className="min-h-screen bg-gray-50 text-gray-900">
    {DEV_MODE && (
      <div className="bg-red-100 border-b-2 border-red-500 text-red-700 px-4 py-2 text-center font-semibold">
        🚧 DEVELOPMENT MODE - Shortened timers
      </div>
    )}
    <div className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>
      <main className="bg-white rounded-2xl shadow p-6">{children}</main>
      {skip && onPreviewNext && <div className="mt-4"><button className="px-4 py-2 border border-amber-500 rounded-lg bg-amber-50" onClick={onPreviewNext}>Preview: next screen</button></div>}
      {footer && <footer className="mt-6 flex justify-end">{footer}</footer>}
    </div>
  </div>
);
};

// ---- View 1: Instructions ----
const InstructionsView: React.FC<{ meta: SessionMeta; sessionId?: string | null; onNext: () => void }>=({ meta, sessionId, onNext }) => {
  const skip = usePageThrough();
  const [ack, setAck] = useState(false);
  const [showAICheck, setShowAICheck] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showError, setShowError] = useState(false);
  const [showFinalError, setShowFinalError] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(DEV_MODE ? 0 : 20); // 15 second timer

  const correctAnswer = meta.group.includes("SELF") ? "zero_tolerance" : "ai_when_provided";

  // Timer effect
  React.useEffect(() => {
    if (!skip && !DEV_MODE && timeRemaining > 0) {
      const timer = setTimeout(() => setTimeRemaining(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeRemaining, skip]);

  const handleNext = async () => {
    if (timeRemaining > 0) return;
    
    if (!showAICheck) {
      setShowAICheck(true);
      return;
    }

    if (selectedOption === correctAnswer) {
      onNext();
    } else {
      if (attempts < 1) {
        setAttempts(prev => prev + 1);
        setShowError(true);
        if (!DEV_MODE) {
        setTimeout(() => setShowError(false), 5000);
      } else {
          setShowError(false); // Immediately hide error in dev mode
        }
      } else {
        // Failed all attempts - ban participant
        if (!meta.localPreview) await banParticipant(meta.prolificId);
        setShowFinalError(true);
      }
    }
  };

  return (
    <Shell
      onPreviewNext={() => showAICheck ? onNext() : setShowAICheck(true)}
      title="Instructions"
      footer={
        showFinalError ? null : (
          <div className="flex flex-col items-center gap-3">
            {!showAICheck && timeRemaining > 0 && (
              <div className="text-sm text-gray-500">
                Please read the instructions carefully. You can proceed in {timeRemaining} seconds.
              </div>
            )}
            <button
              onClick={handleNext}
              disabled={!ack || timeRemaining > 0 || (showAICheck && !selectedOption)}
              className={`px-4 py-2 rounded-xl ${
                !ack || timeRemaining > 0 || (showAICheck && !selectedOption)
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-black text-white'
              }`}
            >
              {showAICheck ? "Continue" : "Begin Study"}
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {DEV_MODE && (
          <div className="text-sm text-gray-600">
            Participant: <span className="font-mono">{meta.prolificId}</span> · Group: <span className="font-mono">{meta.group}</span>
            {sessionId && (
              <> · Session: <span className="font-mono text-xs">{sessionId}</span></>
            )}
          </div>
        )}
        <p className="leading-relaxed">
          Welcome! You'll complete a short creative writing task for a research study. {meta.group.includes("SELF") ? 
            "Our goal is to understand how people write stories without the use of an AI writing assistant, in particular how people brainstorm, write first drafts, and refine their stories."
            : "Our goal is to understand how people write stories with the use of an AI writing assistant, in particular how it might contribute to less diverse stories."
          } Please read the instructions carefully.
        </p>
        
        {/* Instructions */}
        <div className={`rounded-lg border p-4 ${showError ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
          <h3 className="font-semibold mb-2">Instructions:</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Be thoughtful and authentic in your responses!</li>
            <li><span className="font-bold">Stay on the session.</span> Keep this tab open until you finish. Refreshing this tab restores your progress, but does not pause the timers.</li>
            {meta.group.includes("SELF") ? (
              <li><span className="font-bold">Do not use external AI tools</span> (e.g., Google, ChatGPT). We will be monitoring for prohibited AI usage using keystroke data, attention checks, and your final submission. <span className="font-bold text-red-500">If you are caught using AI, we will return your submission.</span></li>
            ) : (
              <li>You are provided an in-app AI writing assistant to aid in your creative writing task; in fact you are <span className="font-bold">required to use the AI writing assistant when prompted.</span> However, oftentimes the AI writing assistant will not achieve the quality you desire. We encourage you to use the AI writing assistant as a stepping stone and as a helper, but <span className="font-bold">ultimately you are responsible for your own story.</span> Please do not use external AI tools that we do not provide to you.</li>
            )}
          </ul>
        </div>

        {/* Acknowledgment */}
        <label className="inline-flex items-center gap-2 mt-4">
          <input type="checkbox" className="w-4 h-4" checked={ack} onChange={(e)=>setAck(e.target.checked)} />
          <span>I have read and understand the instructions.</span>
        </label>

        {/* Attention Check */}
        {showAICheck && (
          <div className="mt-8 border-t pt-6">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-4">Attention Check</h2>
              <p className="mb-6">Based on the instructions above, what is the policy regarding AI usage in this study?</p>
              
              <div className="flex flex-col gap-3 max-w-xl mx-auto">
                <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="ai_policy"
                    value="zero_tolerance"
                    checked={selectedOption === "zero_tolerance"}
                    onChange={(e) => setSelectedOption(e.target.value)}
                  />
                  <span>Zero tolerance - No AI usage allowed at any point</span>
                </label>
                
                <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="ai_policy"
                    value="ai_when_provided"
                    checked={selectedOption === "ai_when_provided"}
                    onChange={(e) => setSelectedOption(e.target.value)}
                  />
                  <span>AI usage is only allowed when specifically provided by the study</span>
                </label>
                
                <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="ai_policy"
                    value="ai_allowed"
                    checked={selectedOption === "ai_allowed"}
                    onChange={(e) => setSelectedOption(e.target.value)}
                  />
                  <span>Any AI usage is allowed throughout the study</span>
                </label>
              </div>

              {showError && (
                <div className="mt-4 p-4 bg-red-100 border-2 border-red-400 rounded-lg text-red-700">
                  <p className="font-bold">⚠️ Incorrect Answer</p>
                  <p>Please review the instructions above carefully and try again. You have one more attempt.</p>
                </div>
              )}

              {showFinalError && (
                <div className="mt-4 p-4 bg-red-100 border-2 border-red-500 rounded-lg">
                  <p className="text-red-700 font-bold text-lg mb-2">⚠️ Attention Check Failed</p>
                  <p className="text-red-600">
                    You have failed to correctly identify the AI usage policy after multiple attempts.
                    This indicates that you may not have read the instructions carefully enough.
                  </p>
                  <p className="text-red-600 mt-2">
                    Unfortunately, we cannot proceed with the study if participants do not understand the key requirements.
                  </p>
                  <p className="text-red-600 mt-3">
                    Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline font-semibold">click this link</a> to go back to Prolific and return the study.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
};

// ---- View 2: Brainstorm ----
const BrainstormView: React.FC<{ onNext: () => void; meta: SessionMeta; value: string; setValue: (s: string)=>void; sessionId?: string | null }>=({ onNext, meta, value, setValue, sessionId }) => {
  const skip = usePageThrough();
  const draftKey = !meta.localPreview && sessionId ? `${sessionId}:brainstorm` : null;
  const [brainstormDeadline] = useSessionDraft(draftKey && `${draftKey}:deadline`, () => Date.now() + (DEV_MODE ? 0 : 300000));
  useEffect(() => {writeDraft(draftKey && `${draftKey}:deadline`, brainstormDeadline);}, [draftKey, brainstormDeadline]);
  const [timeRemaining, setTimeRemaining] = React.useState(() => Math.max(0, Math.ceil((brainstormDeadline - Date.now()) / 1000))); // 5 minutes in seconds
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [showReminder, setShowReminder] = React.useState<false | '2min' | '30sec'>(false);

  // Brainstorm field states
  const [quick_ideas, set_quick_ideas] = useSessionDraft(draftKey && `${draftKey}:quick_ideas`, '')
  const [main_char, set_main_char] = useSessionDraft(draftKey && `${draftKey}:main_char`, '')
  const [setting, set_setting] = useSessionDraft(draftKey && `${draftKey}:setting`, '')
  const [conflict, set_conflict] = useSessionDraft(draftKey && `${draftKey}:conflict`, '')
  const [resolution, set_resolution] = useSessionDraft(draftKey && `${draftKey}:resolution`, '')
  const [plot, set_plot] = useSessionDraft(draftKey && `${draftKey}:plot`, '')
  
  // Ref to track current brainstorm value without re-renders
  const valueRef = React.useRef(value);
  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Timer countdown effect
  React.useEffect(() => {
    if (!skip && !DEV_MODE && timeRemaining > 0) {
      const timer = setTimeout(() => {
        setTimeRemaining(() => {
          const newTime = Math.max(0, Math.ceil((brainstormDeadline - Date.now()) / 1000));
          // Show reminder at 2:00 and 0:30
          if (newTime === 120) {
            setShowReminder('2min');
            setTimeout(() => setShowReminder(false), 10000);
          } else if (newTime === 30) {
            setShowReminder('30sec');
            setTimeout(() => setShowReminder(false), 10000);
          }
          return newTime;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [timeRemaining, skip]); // Only depend on timeRemaining
  
  // Auto-advance when timer expires
  React.useEffect(() => {
    if (!skip && !DEV_MODE && timeRemaining === 0) {
      // Save brainstorm data when time runs out
      const brainstormData = JSON.stringify({
        quick_ideas,
        main_char,
        setting,
        conflict,
        resolution,
        plot
      });
      setValue(brainstormData);
      onNext(); // Force proceed when time is up (only in production)
    }
  }, [timeRemaining, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs to track current brainstorm values without triggering re-renders
  const brainstormRefs = React.useRef({
    quick_ideas,
    main_char,
    setting,
    conflict,
    resolution,
    plot
  });

  // Keep refs in sync with state
  React.useEffect(() => {
    brainstormRefs.current = {
      quick_ideas,
      main_char,
      setting,
      conflict,
      resolution,
      plot
    };
  }, [quick_ideas, main_char, setting, conflict, resolution, plot]);

  // Periodic snapshot tracking for brainstorm phase - save as JSON
  React.useEffect(() => {
    if (!sessionId) return;
    
    const SNAPSHOT_INTERVAL = 5000; // 5 seconds
    const lastSavedRef = { text: '' };
    
    const snapshotTimer = setInterval(() => {
      // Compile all brainstorm fields into JSON from refs
      const brainstormData = JSON.stringify(brainstormRefs.current);
      
      if (brainstormData !== lastSavedRef.text) {
        saveSnapshot(sessionId, 'brainstorm', 'main', brainstormData);
        lastSavedRef.text = brainstormData;
      }
    }, SNAPSHOT_INTERVAL);
    
    // Save final snapshot on unmount
    return () => {
      clearInterval(snapshotTimer);
      const brainstormData = JSON.stringify(brainstormRefs.current);
      
      if (brainstormData !== lastSavedRef.text) {
        saveSnapshot(sessionId, 'brainstorm', 'main', brainstormData);
      }
    };
  }, [sessionId]); // Only depend on sessionId

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate total word count across all fields
  const totalWords = React.useMemo(() => {
    const allText = [main_char, setting, conflict, resolution, plot].join(' ');
    return allText.trim().split(/\s+/).filter(word => word.length > 0).length;
  }, [main_char, setting, conflict, resolution, plot]);

  const handleNext = () => {
    if (!showConfirmation) {
      setShowConfirmation(true);
      return;
    }
    
    // Compile brainstorm data as JSON
    const brainstormData = JSON.stringify({
      quick_ideas,
      main_char,
      setting,
      conflict,
      resolution,
      plot
    });
    setValue(brainstormData);
    onNext();
  };

  return (
    <Shell
      title="Step 1 · Brainstorm"
      onPreviewNext={() => {setValue(JSON.stringify({quick_ideas, main_char, setting, conflict, resolution, plot})); onNext();}}
      footer={
        <div className="flex flex-col items-center gap-4">
          {showReminder && (
            <div className="bg-yellow-100 border-2 border-yellow-400 text-yellow-700 px-6 py-3 rounded-lg text-base font-semibold animate-pulse">
              {showReminder === '2min'
                ? "⏰ 2 minutes remaining! Start wrapping up your brainstorming."
                : "⚠️ Only 30 seconds left! Finish your thoughts quickly!"}
            </div>
          )}
          {showConfirmation ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-gray-600">Are you sure you're done brainstorming?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    // Compile brainstorm data as JSON
                    const brainstormData = JSON.stringify({
                      quick_ideas,
                      main_char,
                      setting,
                      conflict,
                      resolution,
                      plot
                    });
                    setValue(brainstormData);
                    onNext();
                  }} 
                  className="px-4 py-2 rounded-xl bg-black text-white"
                >
                  Yes, proceed to writing
                </button>
                <button 
                  onClick={() => setShowConfirmation(false)} 
                  className="px-4 py-2 rounded-xl border border-gray-300"
                >
                  No, continue brainstorming
                </button>
              </div>
            </div>
          ) : (
            <>
              {(timeRemaining > 240 || totalWords < 20) && (
                <div className="text-sm text-gray-600 text-center">
                  {timeRemaining > 240 && (
                    <div>Please spend at least 60 seconds brainstorming ({300 - timeRemaining} / 60 seconds)</div>
                  )}
                  {totalWords < 20 && (
                    <div>Please write at least 20 words in your outline ({totalWords} / 20 words)</div>
                  )}
                </div>
              )}
            <button 
              onClick={handleNext} 
                disabled={timeRemaining > 240 || totalWords < 20}
                className={`px-4 py-2 rounded-xl ${
                  timeRemaining > 240 || totalWords < 20
                    ? 'bg-gray-300 cursor-not-allowed text-gray-600'
                    : 'bg-black text-white'
                }`}
                title={
                  timeRemaining > 240 
                    ? `Please wait ${timeRemaining - 240} more seconds`
                    : totalWords < 20
                      ? `Need ${20 - totalWords} more words`
                      : ''
                }
            >
              Go to Writing
            </button>
            </>
          )}
        </div>
      }
    >
      {/* Timer - Fixed to top-right */}
      <div className="fixed top-4 right-4 z-40">
        <div 
          className={`px-4 py-2 rounded-lg font-bold text-base shadow-lg ${
            timeRemaining <= 30 
              ? 'bg-red-100 text-red-700 border-2 border-red-500' 
              : timeRemaining <= 120 
                ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500'
                : 'bg-blue-100 text-blue-700 border-2 border-blue-500'
          }`}
        >
          ⏱️ {formatTime(timeRemaining)}
        </div>
      </div>
      
      {/* Story Guidelines Box */}
      <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl">
        <h3 className="font-bold text-blue-900 mb-2 text-base">📖 Story Guidelines</h3>
        <p className="text-sm text-blue-900 mb-2">
          To help spark ideas and make your story easier to shape, we've added a few gentle guidelines to focus your creativity:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-blue-800">
          <li>Write the story from a <span className="font-bold">first-person</span> point of view.</li>
          <li>The story should take place over <span className="font-bold">no more than one day</span>.</li>
          <li>The story should center on a <span className="font-bold">decision or dilemma</span>.</li>
        </ul>
      </div>

      <p className="mb-4 text-sm text-gray-600">Outline your story plan below. Use as many of the boxes as you find necessary. Remember, your goal is to <span className="font-semibold">{meta.group.includes("DIV")?"win the short story competition with your originality":"get the highest grade possible"}</span>! Remember, the story should be <span className="font-semibold">250-350 words.</span></p>

{/* Quick Ideas Section */}
<div className="mb-6">
<h2 className="text-xl font-bold mb-3 text-gray-800">Quick Ideas</h2>
      <textarea
value={quick_ideas}
onChange={(e) => set_quick_ideas(e.target.value)}

rows={3}
        className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="Jot down as many ideas for a story you have."
/>
</div>

{/* Outline Section */}
<div>
<h2 className="text-xl font-bold mb-4 text-gray-800">Outline</h2>
<div className="flex flex-col gap-4">

<div>
<label className="block mb-1 text-sm font-medium text-gray-700">Main Character</label>
<p className="mb-3 text-sm text-gray-600">Who is your main character? What are their traits?
Additionally, what is your character's goal in the story? What do they want?</p>
<textarea
value={main_char}
onChange={(e) => set_main_char(e.target.value)}

rows={3}
className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="Who is your main character?"
/>
</div>

<div>
<label className="block mb-1 text-sm font-medium text-gray-700">Setting</label>
<p className="mb-3 text-sm text-gray-600">Where does this story take place? When does this story take place? What time period does the
story occur over (1 year? 1 day? 20 minutes?)</p>
<textarea
value={setting}
onChange={(e) => set_setting(e.target.value)}

rows={3}
className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="Where and when does the story take place?"
/>
</div>

<div>
<label className="block mb-1 text-sm font-medium text-gray-700">Conflict</label>
<p className="mb-3 text-sm text-gray-600">What is the main conflict of this story? How does this conflict
prevent the character from getting what they want? </p>
<textarea
value={conflict}
onChange={(e) => set_conflict(e.target.value)}

rows={3}
className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="What problem drives the story?"
/>
</div>

<div>
<label className="block mb-1 text-sm font-medium text-gray-700">Resolution</label>
<p className="mb-3 text-sm text-gray-600">How does the story end? Does the main character achieve their goal? Why or why not? </p>
<textarea
value={resolution}
onChange={(e) => set_resolution(e.target.value)}

rows={3}
className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="How is the conflict resolved?"
/>
</div>

<div>
<label className="block mb-1 text-sm font-medium text-gray-700">Plot</label>
<p className="mb-3 text-sm text-gray-600">Now, write out the events of the story. How does the story
get from beginning to end? What happens? How is the resolution reached?</p>
<textarea
value={plot}
onChange={(e) => set_plot(e.target.value)}

rows={3}
className="w-full border rounded-xl p-3 focus:outline-none focus:ring"
placeholder="Summarize the main events or structure."
/>
</div>

</div> {/* End Outline section */}
</div> {/* End Outline wrapper */}
    </Shell>
  );
};

// ---- New View: Prompt ----
const PromptView: React.FC<{ meta: SessionMeta; onNext: () => void }> = ({ meta, onNext }) => {
  const isDiv = meta.group.includes("DIV");
  const skip = usePageThrough();
  const [timeRemaining, setTimeRemaining] = React.useState(DEV_MODE ? 0 : 20);
  const [showAttentionCheck, setShowAttentionCheck] = React.useState(false);
  const [selectedOption, setSelectedOption] = React.useState<string | null>(null);
  const [showWarning, setShowWarning] = React.useState(false);
  const correctAnswer = isDiv ? "originality" : "grade";

  React.useEffect(() => {
    if (!skip && !DEV_MODE && timeRemaining > 0) {
      const timer = setTimeout(() => setTimeRemaining(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeRemaining, skip]);

  const handleProceed = async () => {
    if (timeRemaining > 0) return;
    if (!showAttentionCheck) {
      setShowAttentionCheck(true);
      return;
    }
    if (selectedOption) {
      if (selectedOption === correctAnswer) {
        onNext();
      } else {
        // Failed attention check - ban participant
        if (!meta.localPreview) await banParticipant(meta.prolificId);
        setShowWarning(true);
      }
    }
  };

  const promptText = isDiv
    ? (
      <>
        <p className="text-lg mb-4 font-semibold">You are participating in a short story competition.</p>
        <p className="mb-2">There are thousands of submissions, so <span className="font-bold">your goal is to stand out</span> as much as possible. 
          Find your voice and be as creative as possible! The short story should be 250-350 words.</p>
        <p className="mt-4 text-red-600">In other words, your <u>bonus</u> will be determined based on <span className="font-bold">originality and uniqueness.</span></p>
        <table className="w-full my-4 border-collapse">
          <thead>
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-100">Top % Originality</th>
              <th className="border border-gray-300 p-2 bg-gray-100">Bonus</th>
            </tr>
          </thead>
          <tbody>
          <tr>
              <td className="border border-gray-300 p-2">Top 2%</td>
              <td className="border border-gray-300 p-2">$7.00</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2">Top 2-10%</td>
              <td className="border border-gray-300 p-2">$4.00</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2">Top 10-25%</td>
              <td className="border border-gray-300 p-2">$2.00</td>
            </tr>

          </tbody>
        </table>
        <div className="my-10"></div>
        <p className="mb-2 text-gray-500 italic">
          In the next step, you will be given at most 5 minutes to brainstorm and outline your story plan. Then, you will have 10 minutes for a rough draft and 10 minutes for a final draft. Your rough draft carries into the final section. AI writing assistant access: {accessLabels[meta.group.startsWith("AI") ? (meta.aiAccess ?? STUDY_AI_ACCESS) : "neither"]}. You do not need to use the entire allotted time. After multiple periods of inactivity, we will flag your submission for manual review.
        </p>
      </>
    )
    : (
      <>
        <p className="text-lg mb-4 font-semibold">You are starting an Intro to Writing class.</p>
        <p className="mb-2">Your first assignment is to create a 250-350 word short story. 
          Your goal is to get an A by submitting a high-quality piece of work.</p>
        
        <div className="my-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl">
          <h3 className="font-bold text-blue-900 mb-3 text-base">Grading Rubric</h3>
          <p className="text-sm text-blue-900 mb-3">Your story will be evaluated on two aspects:</p>
          
          <div className="bg-white rounded-lg overflow-hidden mb-3">
            <table className="w-full">
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="p-3 font-semibold text-blue-900 bg-gray-50 align-top w-1/3">
                    1. Organization<br/>
                    <span className="text-xs font-normal text-gray-600">(Narrative Flow)</span>
                  </td>
                  <td className="p-3 pl-6">
                    <ul className="text-xs text-gray-700 space-y-2 text-left">
                      <li><span className="font-semibold">(4 pt) Excellent:</span> Clear beginning, middle, and end with smooth transitions</li>
                      <li><span className="font-semibold">(3 pt) Competent:</span> Logical flow with minor structural issues</li>
                      <li><span className="font-semibold">(2 pt) Basic:</span> Some organization but lacks coherence</li>
                      <li><span className="font-semibold">(1 pt) Does not meet expectations:</span> Disorganized or unclear structure</li>
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-blue-900 bg-gray-50 align-top w-1/3">
                    2. Technique<br/>
                    <span className="text-xs font-normal text-gray-600">(Grammar, Spelling, Punctuation)</span>
                  </td>
                  <td className="p-3 pl-6">
                    <ul className="text-xs text-gray-700 space-y-2 text-left">
                      <li><span className="font-semibold">(4 pt) Excellent:</span> No errors; demonstrates mastery</li>
                      <li><span className="font-semibold">(3 pt) Competent:</span> Few minor errors that don't impede understanding</li>
                      <li><span className="font-semibold">(2 pt) Basic:</span> Several errors that occasionally distract</li>
                      <li><span className="font-semibold">(1 pt) Does not meet expectations:</span> Frequent errors that impede understanding</li>
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-blue-900 bg-gray-50 align-top w-1/3">
                    Creativity<br/>
                  </td>
                  <td className="p-3 pl-6">
                    <p className="text-sm text-blue-900 text-left">
                      <span className="font-semibold">Note:</span> You are <span className="font-bold">not graded on creativity or your voice</span>. While creativity and uniqueness are often contributors to good pieces of writing, for now we are only asking for a technically well-written story.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <p className="mt-4 text-red-600">Your <u>bonus</u> will be determined based on <span className="font-bold">the grade you receive:</span></p>
        <table className="w-full my-4 border-collapse">
          <thead>
            <tr>
            <th className="border border-gray-300 p-2 bg-gray-100">Point Range</th>
              <th className="border border-gray-300 p-2 bg-gray-100">Grade</th>
              <th className="border border-gray-300 p-2 bg-gray-100">Bonus</th>
            </tr>
          </thead>
          <tbody>
          <tr>
              <td className="border border-gray-300 p-2">8 points</td>
              <td className="border border-gray-300 p-2">A</td>
              <td className="border border-gray-300 p-2">$2.50</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2">6-7 points</td>
              <td className="border border-gray-300 p-2">B</td>
              <td className="border border-gray-300 p-2">$1.00</td>
            </tr>
            <tr>
              <td className="border border-gray-300 p-2">5 points or lower</td>
              <td className="border border-gray-300 p-2">C or lower</td>
              <td className="border border-gray-300 p-2">None</td>
            </tr>

          </tbody>
        </table>
        <div className="my-10"></div>
        <p className="mb-2 text-gray-500 italic">
          In the next step, you will be given at most 5 minutes to brainstorm and outline your story plan. Then, you will have 10 minutes for a rough draft and 10 minutes for a final draft. Your rough draft carries into the final section. AI writing assistant access: {accessLabels[meta.group.startsWith("AI") ? (meta.aiAccess ?? STUDY_AI_ACCESS) : "neither"]}. You do not need to use the entire allotted time. After 30 seconds of inactivity, we will flag your submission for manual review.
        </p>
        
      </>
    );

  return (
    <Shell
      title="Prompt"
      onPreviewNext={() => showAttentionCheck ? onNext() : setShowAttentionCheck(true)}
      footer={
        <div className="flex flex-col items-center gap-4">
          {showWarning ? (
            <div className="text-center">
              <div className="bg-red-100 border-2 border-red-500 rounded-lg p-4">
                <p className="text-red-700 font-bold text-lg mb-2">⚠️ Warning: Attention Check Failed</p>
                <p className="text-red-600">
                  Your answer indicates that you did not read the prompt carefully. 
                  This is a serious concern as careful reading is essential for this task.
                </p>
                <p className="text-red-600 mt-2">
                  Unfortunately, we cannot proceed with the study. You have been removed from participation.
                </p>
                <p className="text-red-600 mt-3">
                  Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline font-semibold">click this link</a> to go back to Prolific and return the study.
                </p>
              </div>
            </div>
          ) : !showAttentionCheck ? (
            <>
              <div className="text-sm text-gray-500">
                Please read the prompt carefully. You can proceed in {timeRemaining} seconds.
              </div>
              <button
                onClick={handleProceed}
                className={`px-4 py-2 rounded-xl ${
                  timeRemaining > 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-black text-white'
                }`}
                disabled={timeRemaining > 0}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div className="text-center mb-4">
                <p className="font-semibold mb-2">Based on the prompt, what is your bonus determined by?</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="bonus"
                      value={isDiv ? "grade" : "originality"}
                      checked={selectedOption === (isDiv ? "grade" : "originality")}
                      onChange={(e) => setSelectedOption(e.target.value)}
                    />
                    {isDiv ? "The grade I receive" : "Originality and uniqueness"}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="bonus"
                      value={isDiv ? "originality" : "grade"}
                      checked={selectedOption === (isDiv ? "originality" : "grade")}
                      onChange={(e) => setSelectedOption(e.target.value)}
                    />
                    {isDiv ? "Originality and uniqueness": "The grade I receive"}
                  </label>
                </div>
              </div>
              <button
                onClick={handleProceed}
                className={`px-4 py-2 rounded-xl ${
                  !selectedOption ? 'bg-gray-300 cursor-not-allowed' : 'bg-black text-white'
                }`}
                disabled={!selectedOption}
              >
                Begin Brainstorm
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="prose max-w-none text-center">{promptText}</div>
    </Shell>
  );
};

// ---- Editor: AI Chat (placeholder) ----
const AIChatPanel: React.FC<{ 
  messages: {role:"user"|"assistant"; content:string}[], 
  onSend: (m:string)=>void,
  draft: string,
  setDraft: (s:string)=>void,
  isLoading?: boolean,
  queryCount?: number,
  maxQueries?: number;
  onUseText: (text: string) => void;
}>=({ messages, onSend, draft, setDraft, isLoading = false, queryCount = 0, maxQueries = 15, onUseText })=>{
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    let previousWidth = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = input.getBoundingClientRect().width;
      if (width === previousWidth) return;
      previousWidth = width;
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);

  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);
  
  const handleSendClick = () => {
    if (draft.trim() && !isLoading && queryCount < maxQueries) {
      onSend(draft.trim());
      setDraft("");
    }
  };

  const isLimitReached = queryCount >= maxQueries;
  
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">AI writing assistant</div>
      </div>
      <div ref={chatContainerRef} className="flex-1 min-h-20 px-1 py-3 overflow-y-auto space-y-5">
        {messages.length===0 && (
          <div className="flex flex-col items-center justify-center px-3 py-5 text-center">
            <p className="text-lg font-medium text-gray-700">Let’s work on your story.</p>
            <p className="mt-1 max-w-sm text-sm leading-5 text-gray-500">Ask for ideas, a first draft, or help revising.</p>
          </div>
        )}
        {messages.map((m, i)=> (
          <div key={i} className={"p-3 text-sm leading-relaxed break-words " + (m.role==="assistant"?"mr-3 rounded-2xl border border-blue-100 bg-blue-50":"ml-6 rounded-2xl bg-gray-100")}>
            <div className="text-xs uppercase tracking-wide opacity-60">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.content}</div>
            {m.role === 'assistant' && <button className="mt-3 text-sm border border-blue-200 rounded-lg px-3 py-1" onClick={() => onUseText(m.content)}>Add to draft</button>}
          </div>
        ))}
        {isLoading && (
          <div className="mr-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">assistant</div>
            <div className="flex items-center gap-2 text-gray-600">
              <div className="flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>●</span>
      </div>
              <span className="text-sm">The AI writing assistant is thinking...</span>
            </div>
          </div>
        )}
        {isLimitReached && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <div className="text-sm font-semibold text-red-800 mb-1">Query Limit Reached</div>
            <div className="text-sm text-red-700">
              You've used all {maxQueries} queries to the AI writing assistant for this session. You can continue writing and editing your story in the main editor.
            </div>
          </div>
        )}
      </div>
      
      <div className="relative mt-3 shrink-0 rounded-3xl border border-gray-300 bg-gray-50 p-3 shadow-sm focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-300">
        <textarea
          ref={promptRef}
          className="block w-full resize-none overflow-y-auto bg-transparent pl-1 pr-12 py-2 text-sm leading-6 outline-none min-h-10 max-h-[min(240px,35vh)]"
          id="ai-prompt"
          aria-label="Message the AI writing assistant"
          placeholder={isLimitReached ? "Query limit reached" : "Message the AI writing assistant…"}
          value={draft}
          onChange={(e)=>setDraft(e.target.value)}
          rows={1}
          disabled={isLoading || isLimitReached}
        />
        <div className="absolute bottom-3 right-3">
          <button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white disabled:bg-gray-200 disabled:text-gray-400"
            onClick={handleSendClick}
            disabled={!draft.trim() || isLoading || isLimitReached}
            aria-label={isLoading ? 'Sending message' : 'Send'}
            title={isLimitReached ? `Query limit reached (${maxQueries}/${maxQueries})` : 'Send message'}
          >
            {isLoading ? <span className="animate-pulse">…</span> : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-500">Enter starts a new line. Use the arrow to send.</p>

      {/* AI Prompting Tips - Collapsible */}
      <details className="mt-3 shrink-0 max-h-32 overflow-y-auto p-3 bg-gray-50 rounded-lg text-xs text-gray-700">
        <summary className="font-semibold cursor-pointer hover:text-gray-900">💡 Tips for prompting the AI writing assistant (click to expand)</summary>
        <ul className="mt-2 space-y-2 text-gray-600">
          <li className="ml-4">
            <div>"In 250-350 words, write a short story with the following elements:</div>
            <div className="ml-4 mt-1 space-y-1">
              <div>- Setting: [your setting]</div>
              <div>- Main character: [your main character]</div>
              <div>- Conflict: [your conflict]</div>
            </div>
            <div className="mt-1">Make sure to write in first person and unfold the story over a single day."</div>
          </li>
          <li className="ml-4">"Rewrite this paragraph in a more [dramatic/humorous/suspenseful] tone: [paragraph]"</li>
        </ul>
      </details>
    </div>
  );
};

type ChatMessage = {role: "user" | "assistant"; content: string};
export interface WritingRecord {
  roughDraft: string;
  roughCompletedAt: string;
  finalCompletedAt: string;
  aiAccess: AIAccess;
  phaseSeconds: number;
  roughTranscript: ChatMessage[];
  finalTranscript: ChatMessage[];
}
export const WritingStudy: React.FC<{
  meta: SessionMeta; brainstorm: string; sessionId?: string | null;
  access?: AIAccess; preview?: boolean;
  onNext: (text: string, messages: ChatMessage[], record: WritingRecord) => void;
}> = ({meta, brainstorm, sessionId, access = STUDY_AI_ACCESS, preview = false, onNext}) => {
  const draftKey = !preview && sessionId ? `${sessionId}:writing` : null;
  const [rough, setRough] = useSessionDraft<{text: string; messages: ChatMessage[]; completedAt: string} | null>(draftKey && `${draftKey}:rough`, null);
  const [roughSaved, setRoughSaved] = useSessionDraft(draftKey && `${draftKey}:saved`, false);
  const [saveError, setSaveError] = useState('');
  const [savingRough, setSavingRough] = useState(false);
  const phase = rough ? 'final' : 'rough';
  const effectiveAccess = meta.group.startsWith('AI') ? access : 'neither';
  async function saveRough(artifact: NonNullable<typeof rough>) {
    setSavingRough(true); setSaveError('');
    try {
      if (!preview) await studyApi({action: 'phase', sessionId, phase: 'rough'});
      await recallApi({action: 'save_record', kind: 'rough_draft', preview, sessionId, payload: {
        text: artifact.text, transcript: artifact.messages, completedAt: artifact.completedAt,
        aiAccess: effectiveAccess, phaseSeconds: DEV_MODE ? 30 : PHASE_SECONDS, brainstorm,
      }});
      setRoughSaved(true);
    } catch (error) { setSaveError(`Your rough draft could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}. Your text is kept on this page. Please retry to continue.`); }
    finally { setSavingRough(false); }
  }
  useEffect(() => {if (rough && !roughSaved) void saveRough(rough);}, []);
  if (rough && !roughSaved) return <Shell title="Saving your rough draft">
    {saveError ? <><p role="alert">{saveError}</p><button className="mt-4 border rounded-lg px-4 py-2" disabled={savingRough} onClick={() => saveRough(rough)}>Retry save</button></> : <p role="status">Saving… Your final-draft timer will start when saving is complete.</p>}
  </Shell>;
  return <EditorView key={phase} meta={meta} brainstorm={brainstorm} sessionId={sessionId}
    phase={phase} access={effectiveAccess} preview={preview} initialText={rough?.text ?? ''}
    initialMessages={effectiveAccess === 'both' ? rough?.messages ?? [] : []}
    previousQueries={rough?.messages.filter(m => m.role === 'user').length ?? 0}
    onNext={(text, messages) => {
      if (!rough) {
        const artifact = {text, messages, completedAt: todayISO()};
        setRough(artifact);
        void saveRough(artifact);
        window.scrollTo(0, 0);
      } else {
        if (!text.trim()) {window.alert('Write or add a story before continuing to the survey and quiz.'); return;}
        const finalMessages = effectiveAccess === 'both' ? messages.slice(rough.messages.length) : messages;
        onNext(text, [...rough.messages, ...finalMessages], {
          roughDraft: rough.text, roughCompletedAt: rough.completedAt, finalCompletedAt: todayISO(),
          aiAccess: effectiveAccess, phaseSeconds: DEV_MODE ? 30 : PHASE_SECONDS,
          roughTranscript: rough.messages, finalTranscript: finalMessages,
        });
      }
    }} />;
};

// ---- View 3: Editor ----
const EditorView: React.FC<{
  meta: SessionMeta;
  brainstorm: string;
  onNext: (finalText: string, aiTranscript: {role:"user"|"assistant"; content:string}[])=>void;
  sessionId?: string | null;
  phase: WritingPhase;
  access: AIAccess;
  preview: boolean;
  initialText: string;
  initialMessages: ChatMessage[];
  previousQueries: number;
}> = ({ meta, brainstorm, onNext, sessionId, phase, access, preview, initialText, initialMessages, previousQueries }) => {
  const skip = usePageThrough();
  const [phaseError, setPhaseError] = useState('');
  useEffect(() => {
    if (!preview) void studyApi({action: 'phase', sessionId, phase}).then(result => setDeadline(Date.parse(result.startedAt) + 600000)).catch(error => setPhaseError(error.message));
  }, [preview, sessionId, phase]);
  const draftKey = !preview && sessionId ? `${sessionId}:editor:${phase}` : null;
  const [text, setText] = useSessionDraft(draftKey && `${draftKey}:text`, initialText);
  const isAI = aiEnabled(meta.group, access, phase);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const [aiMessages, setAiMessages] = useSessionDraft<ChatMessage[]>(draftKey && `${draftKey}:messages`, initialMessages);
  const [chatDraft, setChatDraft] = useSessionDraft(draftKey && `${draftKey}:prompt`, ""); // Lift chat input state
  const [isAILoading, setIsAILoading] = useState(false); // Track if AI is responding
  const [aiQueryCount, setAiQueryCount] = useSessionDraft(draftKey && `${draftKey}:count`, previousQueries); // Track number of AI queries sent
  const MAX_AI_QUERIES = 15; // Maximum number of AI queries allowed per session
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const TOTAL_TIME = DEV_MODE ? 30 : PHASE_SECONDS;
  const MIN_TIME_REQUIRED = DEV_MODE ? 15 : 5 * 60;
  const [timeRemaining, setTimeRemaining] = useState(TOTAL_TIME);
  const [deadline, setDeadline] = useState(() => Date.now() + TOTAL_TIME * 1000);
  const [showReminder, setShowReminder] = useState<false | '5min' | '1min'>(false);
  const [wordCount, setWordCount] = useState(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [hasUsedAI, setHasUsedAI] = useSessionDraft(draftKey && `${draftKey}:used`, false); // Track if user has interacted with AI
  const [showEditorEnabledMessage, setShowEditorEnabledMessage] = useState(false); // Show the enabled message
  const [showBrainstormOutline, setShowBrainstormOutline] = useState(true); // Control brainstorm visibility
  const [showTimeExpiredWarning, setShowTimeExpiredWarning] = useState(false); // Show warning when time is up but word count invalid
  const [showWordCountWarning, setShowWordCountWarning] = useState<false | '10min' | '5min' | '2min'>(false); // Word count warnings at intervals
  const timeoutHandledRef = useRef(false); // Track if we've already handled timer expiration
  const [graceTimeRemaining, setGraceTimeRemaining] = useState<number | null>(null); // Grace period timer (3 minutes)
  const graceTimeoutHandledRef = useRef(false); // Track if we've handled grace period expiration
  
  // Update word count whenever text changes
  useEffect(() => {
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    setWordCount(words.length);
    
    // Clear regular word count warnings (but not grace period)
    const isValidWordCount = words.length >= 250 && words.length <= 385;
    if (isValidWordCount) {
      if (showWordCountWarning) {
        setShowWordCountWarning(false);
      }
    }
  }, [text, showWordCountWarning]);

  // Timer countdown effect
  React.useEffect(() => {
    if (!skip && timeRemaining > 0) {
      const timer = setTimeout(() => {
        setTimeRemaining(() => {
          const newTime = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
          
          // Show reminders at 5:00 and 1:00
          if (newTime === 300) {
            setShowReminder('5min');
            setTimeout(() => setShowReminder(false), 10000);
          } else if (newTime === 60) {
            setShowReminder('1min');
            setTimeout(() => setShowReminder(false), 10000);
          }
          
          // Show word count warnings at 10:00, 5:00, and 2:00 if word count is invalid
          const isWordCountInvalid = phase === 'final' && (wordCount < 250 || wordCount > 350);
          if (isWordCountInvalid) {
            if (newTime === 600) { // 10 minutes
              setShowWordCountWarning('10min');
              setTimeout(() => setShowWordCountWarning(false), 30000); // Show for 30 seconds
            } else if (newTime === 300) { // 5 minutes
              setShowWordCountWarning('5min');
              setTimeout(() => setShowWordCountWarning(false), 30000);
            } else if (newTime === 120) { // 2 minutes
              setShowWordCountWarning('2min');
              setTimeout(() => setShowWordCountWarning(false), 30000);
            }
          }
          
          return newTime;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [timeRemaining, wordCount, phase, deadline, skip]);

  // Handle timer expiration (separate effect to avoid re-triggering)
  React.useEffect(() => {
    if (!skip && timeRemaining === 0 && !timeoutHandledRef.current) {
      timeoutHandledRef.current = true; // Mark as handled
      requestController.current?.abort();
      if (phase === 'rough') { onNext(text, aiMessages); return; }
      // Only force proceed if word count is valid (at least 250 words, allow slightly over 350)
      if (wordCount >= 250 && wordCount <= 385) {
        onNext(text, aiMessages);
    } else {
        // If word count is invalid, show warning and start grace period
        setShowTimeExpiredWarning(true);
        setGraceTimeRemaining(Math.max(0, Math.ceil((deadline + (DEV_MODE ? 30000 : 180000) - Date.now()) / 1000))); // DEV: 30 seconds, PROD: 3 minutes grace period
      }
    }
  }, [timeRemaining, wordCount, text, aiMessages, onNext, phase, skip]);

  // Grace period timer countdown
  React.useEffect(() => {
    if (!skip && graceTimeRemaining !== null && graceTimeRemaining > 0) {
      const timer = setTimeout(() => {
        setGraceTimeRemaining(Math.max(0, Math.ceil((deadline + (DEV_MODE ? 30000 : 180000) - Date.now()) / 1000)));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [graceTimeRemaining, skip, deadline]);

  // Handle grace period expiration - force submit regardless of word count
  React.useEffect(() => {
    if (!skip && graceTimeRemaining === 0 && !graceTimeoutHandledRef.current) {
      graceTimeoutHandledRef.current = true;
      
      // Force submit regardless of word count
      onNext(text, aiMessages);
    }
  }, [graceTimeRemaining, wordCount, text, aiMessages, onNext, skip]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Refs to access current values without triggering re-renders
  const textRef = useRef(text);
  const chatDraftRef = useRef(chatDraft);
  
  // Keep refs in sync with state
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  
  useEffect(() => {
    chatDraftRef.current = chatDraft;
  }, [chatDraft]);
  
  // Periodic snapshot tracking for writing phase - saves both main text and chat input every N seconds
  useEffect(() => {
    if (!sessionId) return;
    
    const SNAPSHOT_INTERVAL = 5000; // 5 seconds
    const lastSavedRef = { mainText: '', chatText: '' };
    
    const snapshotTimer = setInterval(() => {
      const currentMainText = textRef.current;
      const currentChatText = chatDraftRef.current;
      
      // Save main text if changed
      if (currentMainText !== lastSavedRef.mainText) {
        saveSnapshot(sessionId, 'writing', 'main', currentMainText);
        lastSavedRef.mainText = currentMainText;
      }
      
      // Save chat text if changed (only for AI groups)
      if (isAI && currentChatText !== lastSavedRef.chatText) {
        saveSnapshot(sessionId, 'writing', 'chat', currentChatText);
        lastSavedRef.chatText = currentChatText;
      }
    }, SNAPSHOT_INTERVAL);
    
    // Save final snapshots on unmount
    return () => {
      clearInterval(snapshotTimer);
      const currentMainText = textRef.current;
      const currentChatText = chatDraftRef.current;
      
      if (currentMainText !== lastSavedRef.mainText) {
        saveSnapshot(sessionId, 'writing', 'main', currentMainText);
      }
      if (isAI && currentChatText !== lastSavedRef.chatText) {
        saveSnapshot(sessionId, 'writing', 'chat', currentChatText);
      }
    };
  }, [sessionId, isAI]); // Only depend on sessionId and isAI

  const sendToAI = async (message: string) => {
    // Check if query limit has been reached
    if (!isAI || isAILoading || (!skip && Date.now() >= deadline) || aiQueryCount >= MAX_AI_QUERIES) {
      console.warn('⚠️ AI query limit reached');
      return; // Don't send if limit reached
    }
    
    // Increment query count
    setAiQueryCount(prev => prev + 1);
    
    // Mark that user has interacted with AI
    if (!hasUsedAI) {
      setHasUsedAI(true);
      setShowEditorEnabledMessage(true);
      // Hide message after 30 seconds
      setTimeout(() => {
        setShowEditorEnabledMessage(false);
      }, 30000);
    }
    
    // Save snapshot of the chat prompt when user submits
    if (sessionId) {
      saveSnapshot(sessionId, 'writing', 'chat', message);
    }
    
    // Add user message to chat
    setAiMessages((msgs)=>[...msgs, { role:"user", content: message }]);
    
    // Set loading state
    setIsAILoading(true);
    
    if (preview) {
      setAiMessages(msgs => [...msgs, {role: 'assistant', content: '[Preview response — no model was called] Try developing the character’s dilemma, then revise for clarity and a strong ending.'}]);
      setIsAILoading(false);
      return;
    }
    // Call OpenAI API
    try {
      requestController.current = new AbortController();
      await studyApi({action: 'phase', sessionId, phase}, requestController.current.signal);
      const data = await studyApi({action: 'chat', sessionId, phase, message}, requestController.current.signal);
      const assistantMessage = data.content;
      
      setAiMessages((msgs)=>[...msgs, { role:"assistant", content: assistantMessage }]);
      
    } catch (error) {
      console.error('❌ OpenAI API error:', error);
      setAiMessages((msgs)=>[...msgs, { 
        role:"assistant", 
        content: `[Error communicating with the AI writing assistant: ${error instanceof Error ? error.message : 'Unknown error'}]`
      }]);
    } finally {
      // Always clear loading state
      setIsAILoading(false);
    }
  };

  const EditorBox = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Write Your Story{phaseError && <p role="alert" className="text-red-700 text-sm">{phaseError} Please reload or contact the researcher.</p>}</div>
        <div className="flex items-center gap-4">
          <div className={`text-sm ${
            wordCount < 250 || wordCount > 350 
              ? 'text-red-600 font-semibold' 
              : 'text-green-600 font-semibold'
          }`}>
            {wordCount} words
          </div>
          <div className="text-xs text-gray-500">{phase === "rough" ? "Final draft target: 250–350 words" : "Required length: 250–350 words"}</div>
        </div>
      </div>
      {isAI && !hasUsedAI && previousQueries === 0 && !DEV_MODE && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <p className="text-blue-900 font-semibold mb-1">📝 Please start with the AI writing assistant</p>
          <p className="text-blue-800">Use the AI writing assistant panel on the right to generate a first draft or story components before editing here.</p>
        </div>
      )}
      {isAI && hasUsedAI && showEditorEnabledMessage && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
          <p className="text-green-900 font-semibold mb-1">✅ Main editor now enabled</p>
          <p className="text-green-800">
            You can now edit, revise, or write your own story. Remember:
            <br/>• You're <span className="font-semibold">not required</span> to use the content generated by the AI writing assistant
            <br/>• You can continue using the AI writing assistant to edit, refine, or create new drafts with different tones
          </p>
        </div>
      )}
      {isAI && timeRemaining > 0 && <button className="self-start border rounded-lg px-3 py-1 mb-2 text-sm disabled:opacity-40" disabled={!text || isAILoading} onClick={() => {setChatDraft(current => [current.trimEnd(), text.trim()].filter(Boolean).join('\n')); document.getElementById('ai-prompt')?.focus();}}>Add draft to prompt</button>}
      <textarea
        ref={editorRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        className="w-full flex-1 min-h-0 resize-none overflow-y-auto border rounded-xl p-3 focus:outline-none focus:ring"
        placeholder={isAI && !hasUsedAI && previousQueries === 0 && !DEV_MODE ? "Please use the AI writing assistant first..." : "Write here... (250-350 words)"}
        spellCheck="true"
        disabled={isAI && !hasUsedAI && previousQueries === 0 && !DEV_MODE}
        style={isAI && !hasUsedAI && previousQueries === 0 && !DEV_MODE ? { backgroundColor: '#f9fafb', cursor: 'not-allowed' } : {}}
      />
      <div className="mt-3 flex justify-end items-center text-xs text-gray-500">
        <div>Use Ctrl+C / Ctrl+V (Cmd+C / Cmd+V on Mac) to copy and paste.</div>
      </div>
    </div>
  );

  return (
    <Shell
      onPreviewNext={() => onNext(text, aiMessages)}
      title={phase === "rough" ? "Step 2 · Rough draft" : "Step 3 · Final draft"}
      footer={
        <div className="flex flex-col items-center gap-4">
          {phase === 'rough' ? (
            <div className="text-sm text-gray-600 text-center">
              <p>Develop your rough draft. The final-draft section begins when this timer ends.</p>
            </div>
          ) : showConfirmation ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-gray-600">Are you sure you want to submit your story?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => onNext(text, aiMessages)} 
                  className="px-4 py-2 rounded-xl bg-black text-white"
                >
                  Yes, submit story
                </button>
                <button 
                  onClick={() => setShowConfirmation(false)} 
                  className="px-4 py-2 rounded-xl border border-gray-300"
                >
                  No, continue writing
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Show validation messages only if not in grace period or if word count is still < 250 */}
              {!graceTimeRemaining && (TOTAL_TIME - timeRemaining < MIN_TIME_REQUIRED || wordCount < 250 || wordCount > 350) && (
                <div className="text-sm text-gray-600 text-center">
                  {TOTAL_TIME - timeRemaining < MIN_TIME_REQUIRED && (
                    <div>Please spend at least {DEV_MODE ? '15 seconds' : '5 minutes'} writing ({TOTAL_TIME - timeRemaining} / {MIN_TIME_REQUIRED} seconds)</div>
                  )}
                  {wordCount < 250 && (
                    <div>Required: 250-350 words (currently {wordCount} words)</div>
                  )}
                  {wordCount > 350 && (
                    <div>Please reduce to 350 words or less (currently {wordCount} words)</div>
                  )}
                </div>
              )}
              {graceTimeRemaining && wordCount < 250 && (
                <div className="text-sm text-red-600 text-center font-semibold">
                  ⚠️ Need at least {250 - wordCount} more words to submit now
                </div>
              )}
            <button
              onClick={() => setShowConfirmation(true)}
              disabled={
                (TOTAL_TIME - timeRemaining < MIN_TIME_REQUIRED) ||
                (wordCount < 250) || 
                (graceTimeRemaining && wordCount > 385) ||
                (!graceTimeRemaining && wordCount > 350)
              }
              className={`px-4 py-2 rounded-xl ${
                (TOTAL_TIME - timeRemaining < MIN_TIME_REQUIRED) ||
                (wordCount < 250) || 
                (graceTimeRemaining && wordCount > 385) ||
                (!graceTimeRemaining && wordCount > 350)
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-black text-white'
              }`}
              title={
                TOTAL_TIME - timeRemaining < MIN_TIME_REQUIRED
                  ? `Please wait ${MIN_TIME_REQUIRED - (TOTAL_TIME - timeRemaining)} more seconds`
                  : wordCount < 250 
                    ? `Need ${250 - wordCount} more words` 
                    : (graceTimeRemaining && wordCount > 385)
                      ? `Story is too long (${wordCount} words). Grace period allows up to 385 words.`
                    : (!graceTimeRemaining && wordCount > 350)
                      ? `Reduce to 350 words or less` 
                    : ''
              }
            >
              Submit
            </button>
            </>
          )}
        </div>
      }
    >
      <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
        <p className="font-semibold">{phase === 'rough' ? 'Part 1 of 2 · Rough draft' : 'Part 2 of 2 · Final draft'} · 10 minutes</p>
        <p>{phase === 'rough' ? 'Write a rough draft of your story. Focus on developing and expressing your ideas, including the characters, plot, setting, conflict and resolution. Prioritize getting your ideas onto the page rather than perfecting the wording. By the end of this phase, you should have a complete rough draft.' : 'Revise your rough draft into a final version of the story. Reread what you have written and consider how effectively it communicates your intended ideas. Polish and refine wording and details in the story. By the end of this, you should have a complete final draft.'}</p>
        {phase === 'rough' && <p className="mt-3"><strong>You will then have an additional 10 minutes to polish and refine your rough draft into a final draft.</strong></p>}
        {isAI && (phase === 'rough' || access === 'final') && <p className="mt-4">You have access to an AI writing assistant to help you with the writing process.</p>}
      </div>
      {/* Timer and Warnings - Fixed to top-right */}
      <div className="fixed top-4 right-4 z-40 flex flex-col items-end gap-3 max-w-md">
        {/* Grace Period Warning - Highest priority */}
        {showTimeExpiredWarning && graceTimeRemaining !== null && graceTimeRemaining > 0 && (
          <div className={`p-4 border-2 rounded-xl shadow-2xl ${
            wordCount >= 250 && wordCount <= 385 
              ? 'bg-green-100 border-green-500 text-green-900'
              : 'bg-orange-100 border-orange-500 text-orange-900'
          }`}>
            <div className="text-lg font-bold mb-2">
              {wordCount >= 250 && wordCount <= 385 ? (
                <>✅ Ready to Submit!</>
              ) : (
                <>⏰ Time&apos;s Up! Grace Period</>
              )}
            </div>
            <div className="mb-2 text-sm">
              {wordCount >= 250 && wordCount <= 385 ? (
                <span className="text-green-800">Word count is valid. You can submit!</span>
              ) : (
                <span>Story must be <span className="font-bold">250-385 words</span>.</span>
              )}
            </div>
            <div className="mb-2 text-sm">
              {wordCount < 250 && (
                <span className="text-red-700 font-bold">⚠️ Need {250 - wordCount} more words!</span>
              )}
              {wordCount >= 250 && wordCount <= 385 && (
                <span className="text-green-700 font-bold">✓ {wordCount} words</span>
              )}
              {wordCount > 385 && (
                <span className="text-orange-700 font-bold">Remove {wordCount - 385} words</span>
              )}
            </div>
            <div className={`font-bold text-base ${
              wordCount >= 250 && wordCount <= 385 ? 'text-green-700' : 'text-red-700'
            }`}>
              ⏱️ Grace: {formatTime(graceTimeRemaining!)}
            </div>
            <div className="text-xs mt-1">
              {wordCount >= 250 && wordCount <= 385 ? (
                <span className="text-green-800">Submit anytime.</span>
              ) : (
                <span className={wordCount >= 250 && wordCount <= 385 ? 'text-green-800' : 'text-orange-800'}>
                  Auto-submit when timer expires.
                </span>
              )}
            </div>
          </div>
        )}
        
        {/* Word Count Warning - High priority (if no grace period) */}
        {showWordCountWarning && !showTimeExpiredWarning && (
          <div className="p-4 bg-red-100 border-2 border-red-600 text-red-900 rounded-xl shadow-2xl">
            <div className="text-lg font-bold mb-2 flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <span>
                {showWordCountWarning === '10min' && '10 min left!'}
                {showWordCountWarning === '5min' && '5 min left!'}
                {showWordCountWarning === '2min' && '2 min left!'}
              </span>
            </div>
            <div className="text-sm mb-2">
              Story MUST be <span className="font-bold">250-350 words</span>!
            </div>
            <div className="text-sm font-semibold">
              Current: <span className="text-base">{wordCount} words</span>
              {wordCount < 250 && <span className="text-red-700"> (Need {250 - wordCount} more)</span>}
              {wordCount > 350 && <span className="text-red-700"> (Remove {wordCount - 350})</span>}
            </div>
          </div>
        )}
        
        {/* Timer */}
        <div 
          className={`px-4 py-2 rounded-lg font-bold text-base shadow-lg ${
            timeRemaining <= 60 
              ? 'bg-red-100 text-red-700 border-2 border-red-500' 
              : timeRemaining <= 300 
                ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500'
                : 'bg-blue-100 text-blue-700 border-2 border-blue-500'
          }`}
        >
          ⏱️ {formatTime(timeRemaining)}
        </div>
        
        {/* Time reminder below timer */}
        {showReminder && !showTimeExpiredWarning && (
          <div className="px-4 py-2 rounded-lg text-sm font-semibold shadow-lg bg-yellow-100 border-2 border-yellow-400 text-yellow-700 animate-pulse">
            {showReminder === '5min' 
              ? "⏰ 5 min left! Wrap up."
              : "⚠️ 1 min left! Finish!"}
          </div>
        )}
      </div>
      {/* Story Guidelines (when grace period not active) */}
      {!showTimeExpiredWarning && (
        <>
          {/* Story Guidelines Box */}
          <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl">
            <h3 className="font-bold text-blue-900 mb-2 text-base">📖 Story Guidelines</h3>
            <p className="text-sm text-blue-900 mb-2">
              To help spark ideas and make your story easier to shape, we've added a few gentle guidelines to focus your creativity:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-blue-800">
              <li>Write the story from a <span className="font-bold">first-person</span> point of view.</li>
              <li>The story should take place over <span className="font-bold">no more than one day</span>.</li>
              <li>The story should center on a <span className="font-bold">decision or dilemma</span>.</li>
            </ul>
          </div>

          {meta.group === "AI-CONV" && (
            <>
              <div className="mb-6 p-4 bg-green-50 border-2 border-green-300 rounded-xl">
                <p className="text-sm text-green-900">
                  <span className="font-semibold">Remember:</span> There is <u>no penalty for content generated by the AI writing assistant or for the amount of effort you put in</u>. As long as the writing is free of technical errors and organizationally sound, you will likely receive a good grade. You do not need to use the entire allotted time!
                </p>
              </div>
              <hr className="mb-6 border-t-2 border-gray-300" />
            </>
          )}

          {meta.group === "SELF-CONV" && (
            <>
              <div className="mb-6 p-4 bg-green-50 border-2 border-green-300 rounded-xl">
                <p className="text-sm text-green-900">
                  <span className="font-semibold">Remember:</span> There is <u>no penalty for not using the entire allotted time</u>. As long as the writing is free of technical errors and organizationally sound, you will likely receive a good grade.
                </p>
              </div>
              <hr className="mb-6 border-t-2 border-gray-300" />
            </>
          )}
        </>
      )}

      {isAI && timeRemaining > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-[clamp(560px,75vh,720px)] min-w-0 border rounded-2xl p-4">{EditorBox}</div>
          <div className="h-[clamp(560px,75vh,720px)] min-w-0 border rounded-2xl p-4">
            <AIChatPanel 
              onUseText={value => setText(current => [current.trimEnd(), value.trim()].filter(Boolean).join('\n'))}
              messages={aiMessages} 
              onSend={sendToAI} 
              draft={chatDraft} 
              setDraft={setChatDraft} 
              isLoading={isAILoading}
              queryCount={aiQueryCount}
              maxQueries={MAX_AI_QUERIES}
            />
          </div>
        </div>
      ) : (
        <div className="h-[clamp(560px,75vh,720px)] border rounded-2xl p-4">{EditorBox}</div>
      )}
      {/* Brainstorm Outline - Visible by default with collapse option */}
      <div className="mt-6 border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Your Brainstorm Outline</h3>
          <button
            onClick={() => setShowBrainstormOutline(!showBrainstormOutline)}
            className="text-sm px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            {showBrainstormOutline ? '▼ Hide' : '▶ Show'}
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-2">The AI writing assistant cannot see your outline. Copy and paste it into the chat prompt, or select “Add outline to prompt” to share it.</p>
        {isAI && timeRemaining > 0 && <button className="border rounded-lg px-3 py-1 mb-3 text-sm" disabled={isAILoading} onClick={() => {setChatDraft(current => [current.trimEnd(), outlineText(brainstorm).trim()].filter(Boolean).join('\n')); document.getElementById('ai-prompt')?.focus();}}>Add outline to prompt</button>}
        {showBrainstormOutline && (() => {
          try {
            const brainstormData = JSON.parse(brainstorm || '{}');
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {brainstormData.quick_ideas && <div className="p-3 bg-gray-50 rounded-lg md:col-span-2"><h4 className="font-semibold text-gray-900 mb-1">Quick ideas</h4><div className="text-gray-700 whitespace-pre-wrap">{brainstormData.quick_ideas}</div></div>}
                {brainstormData.main_char && (
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="font-semibold text-blue-900 mb-1">Main Character</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{brainstormData.main_char}</div>
                  </div>
                )}
                {brainstormData.setting && (
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-semibold text-green-900 mb-1">Setting</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{brainstormData.setting}</div>
                  </div>
                )}
                {brainstormData.conflict && (
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <div className="font-semibold text-orange-900 mb-1">Conflict</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{brainstormData.conflict}</div>
                  </div>
                )}
                {brainstormData.resolution && (
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <div className="font-semibold text-purple-900 mb-1">Resolution</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{brainstormData.resolution}</div>
                  </div>
                )}
                {brainstormData.plot && (
                  <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
                    <div className="font-semibold text-gray-900 mb-1">Plot</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{brainstormData.plot}</div>
                  </div>
                )}
              </div>
            );
          } catch {
            // Fallback for old format (plain text)
            return <pre className="mt-2 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap text-sm">{brainstorm || "(no brainstorm)"}</pre>;
          }
        })()}
      </div>
    </Shell>
  );
};

// ---- Device Compatibility Check ----
function checkDeviceCompatibility(): { compatible: boolean; reason?: string } {
  // Check 1: Screen size (minimum 1024px width for laptop/desktop)
  const minWidth = 1024;
  const minHeight = 600;
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  
  if (screenWidth < minWidth || screenHeight < minHeight) {
    return { 
      compatible: false, 
      reason: `Screen size too small. This study requires a laptop or desktop with at least ${minWidth}x${minHeight} resolution. Your device: ${screenWidth}x${screenHeight}.` 
    };
  }
  
  // Check 2: Touch-only devices (tablets and phones typically only have touch)
  const isTouchOnly = ('ontouchstart' in window || navigator.maxTouchPoints > 0) 
    && !window.matchMedia('(pointer: fine)').matches;
  
  if (isTouchOnly) {
    return { 
      compatible: false, 
      reason: 'This study requires a laptop or desktop computer with a keyboard and mouse. Touch-only devices (tablets and phones) are not supported.' 
    };
  }
  
  // Check 3: User agent detection (fallback)
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
  
  if (isMobileUA) {
    return { 
      compatible: false, 
      reason: 'This study requires a laptop or desktop computer. Mobile devices and tablets are not supported.' 
    };
  }
  
  return { compatible: true };
}

// ---- Root App ----
const StudyApp: React.FC<{preview?: boolean; access?: AIAccess; startAt?: 1 | 4}> = ({
  preview = false, access = STUDY_AI_ACCESS, startAt = 1,
}) => {
  const localPreview = previewEnabled && preview;
  const skip = usePageThrough();
  const [recall, setRecall] = useState<RecallState>({status: "loading"});
  const recallStarted = useRef(false);
  const [previewSubmission, setPreviewSubmission] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<Step>(localPreview ? startAt : 1);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [completionCode, setCompletionCode] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null); // Track if participant is blocked
  const [deviceIncompatible, setDeviceIncompatible] = useState<string | null>(null); // Track device compatibility
  const [brainstorm, setBrainstorm] = useState(localPreview && startAt === 4 ? JSON.stringify(previewBrainstorm) : "");
  const [finalText, setFinalText] = useState("");
  const [aiTranscript, setAiTranscript] = useState<{role:"user"|"assistant"; content:string}[]>([]);
  const [attentionMeta, setAttentionMeta] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [totalViolations, setTotalViolations] = useState(0); // Track fullscreen violations

  useEffect(() => {
    if (loaded && sessionId && !localPreview) writeDraft(`${sessionId}:root`, {step, brainstorm, finalText, aiTranscript, attentionMeta, totalViolations, completionCode});
  }, [loaded, sessionId, localPreview, step, brainstorm, finalText, aiTranscript, attentionMeta, totalViolations, completionCode]);

  // Reattach to the saved generation after refresh, without making a duplicate model call.
  useEffect(() => {
    if (!loaded || localPreview || step !== 5 || !sessionId || recall.status === 'ready') return;
    let disposed = false;
    const poll = async () => {
      try {
        const result = await recallApi({action: 'status', sessionId});
        if (disposed) return;
        if (result.status === 'ready') setRecall({status: 'ready', data: result.data});
        else if (result.status === 'missing' || result.retryable) setRecall({status: 'error', message: 'Your story is saved on this page. Please retry preparing your quiz.'});
      } catch { /* Keep the current state during a temporary network interruption. */ }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {disposed = true; clearInterval(timer);};
  }, [loaded, localPreview, step, sessionId, recall.status]);
  async function retryQuiz() {
    setRecall({status: 'loading'});
    try {
      const data = await recallApi({action: 'generate', story: finalText, preview: localPreview, sessionId});
      setRecall({status: 'ready', data});
    } catch (error) {setRecall({status: 'error', message: error instanceof Error ? error.message : 'Please retry preparing your quiz.'});}
  }

  // Attention tracking for brainstorm (step 3) and editor (step 4)
  const attn = useWritingAttention(!skip && (step === 3 || step === 4), {
    graceMs: 5000,
    halfLifeMs: 20000,
    nudgeThreshold: 0.5,
    finalThreshold: 0.35,
    maxNudges: 5,
  });

  // Track if we've already banned for finalStrike or fullscreen violations
  const bannedForStrikeRef = useRef(false);
  const bannedForViolationsRef = useRef(false);
  
  // Ban user when finalStrike occurs
  useEffect(() => {
    if (attn.finalStrike && !bannedForStrikeRef.current && meta) {
      bannedForStrikeRef.current = true;
      if (!meta.localPreview) banParticipant(meta.prolificId);
      console.log('🚫 User banned due to attention strike');
    }
  }, [attn.finalStrike, meta]);

  // Ban user when fullscreen violations exceed 5
  useEffect(() => {
    if (totalViolations > 5 && !bannedForViolationsRef.current && meta) {
      bannedForViolationsRef.current = true;
      if (!meta.localPreview) banParticipant(meta.prolificId);
      console.log('🚫 User banned due to excessive fullscreen violations:', totalViolations);
      setBlocked('fullscreen_violations');
    }
  }, [totalViolations, meta]);

  // Boot: capture prolific id, assign group, and start Supabase session
  const initRef = useRef(false); // Prevent duplicate initialization
  
  useEffect(() => {
    // Guard against double-initialization (React Strict Mode in dev)
    if (initRef.current) {
      console.log('⚠️ Skipping duplicate initialization (React Strict Mode)');
      return;
    }
    initRef.current = true;
    
    const init = async () => {
      try {
        // Check device compatibility first
        const deviceCheck = checkDeviceCompatibility();
        if (!deviceCheck.compatible) {
          console.log('🚫 Device incompatible:', deviceCheck.reason);
          setDeviceIncompatible(deviceCheck.reason || 'Device not compatible');
          setLoaded(true);
          return;
        }
        
      if (localPreview) {
        setMeta({prolificId: 'LOCAL-PREVIEW', group: 'AI-DIV', startedAt: todayISO(), aiAccess: access, localPreview: true});
        setLoaded(true);
        return;
      }
      const started = await startStudy();
      setMeta({prolificId: started.prolificId, group: started.group, startedAt: todayISO(), aiAccess: started.aiAccess, testSession: started.testSession});
      const saved = readDraft<any>(`${started.sessionId}:root`, null);
      if (saved) {
        setStep(saved.step); setBrainstorm(saved.brainstorm); setFinalText(saved.finalText);
        setAiTranscript(saved.aiTranscript); setAttentionMeta(saved.attentionMeta);
        setTotalViolations(saved.totalViolations); setCompletionCode(saved.completionCode);
      }
      if (started.completed) {setStep(4.1); setCompletionCode(started.completionCode);}
      setSessionId(started.sessionId);
      setLoaded(true);
      } catch (error: any) {
        console.error('❌ Failed to initialize session:', error);
        
        // Check if participant is blocked
        if (error.message === 'already_completed' || error.message === 'writing_started' || error.message === 'banned' || error.message === 'already_started') {
          console.log('🚫 Participant blocked:', error.message);
          setBlocked(error.message);
          setLoaded(true);
        } else {
          // For any other error, halt the study with error message
          console.error('Error details:', error);
          setBlocked('initialization_error');
          setLoaded(true);
        }
      }
    };
    init();
  }, [localPreview, access]);

  const onFinishSurvey = async (survey: PostTaskResponse) => {
    if (!meta) return;
    if (localPreview) {
      setPreviewSubmission({meta, brainstorm, finalText, aiTranscript, attentionMeta, survey, finishedAt: todayISO()});
      setStep(4.1 as Step);
      return;
    }
    try {
      if (flushTimer) {clearTimeout(flushTimer); flushTimer = undefined;}
      await flushSnapshots();
      const saved = await studyApi({action: 'finish', sessionId, attentionMeta});
      setCompletionCode(saved.completionCode);

    // Persist locally and update balancing counts as a placeholder for server submission
    LocalStats.increment(meta.group);
    LocalStats.markCompleted(meta.prolificId);

    } catch (error) {
      console.error('❌ Failed to submit study data:', error);
      throw error; // Keep the survey visible if saving fails.
    }

    // Confirmation view (inline)
    setStep(4.1 as any); // pseudo-step for completion screen
  };

  const CompletionScreen = (
    <Shell title="All set!">
      <div className="prose max-w-none">
        <h2 className="text-xl font-semibold">Thanks for participating! 🎉</h2>
        {localPreview ? <p>Preview complete. No responses were sent to the study database or Prolific.</p> : meta?.testSession ? <p>Test complete. Your test responses have been saved. This is not a paid Prolific submission.</p> : <p>Your responses have been recorded. {completionCode && <>Return to Prolific <a href={`https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(completionCode)}`} className="text-blue-600 underline">using this link</a>. Your completion code is {completionCode}.</>}</p>}
        {localPreview && previewSubmission && <details className="mt-4"><summary>Inspect test submission</summary><pre className="mt-3 whitespace-pre-wrap text-sm">{JSON.stringify(previewSubmission, null, 2)}</pre></details>}
        {meta?.prolificId && (
          <p className="text-sm text-gray-600">Prolific ID: <span className="font-mono">{meta.prolificId}</span></p>
        )}
      </div>
    </Shell>
  );

  // Blocked participant screen
  const BlockedScreen = (
    <Shell title={
      blocked === 'banned' ? 'Access Denied' : 
      blocked === 'fullscreen_violations' ? 'Session Terminated' :
      blocked === 'supabase_error' ? 'Configuration Error' :
      blocked === 'initialization_error' ? 'System Error' :
      blocked === 'already_started' ? 'Session Already Started' :
      'Already Participated'
    }>
      <div className="prose max-w-none">
        {blocked === 'banned' ? (
          <>
            <h2 className="text-xl font-semibold text-red-600">Study Access Denied</h2>
            <p className="text-red-600">
              You have been removed from this study due to failing attention checks.
            </p>
            <p className="text-gray-600">
              Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline">click this link</a> to go back to Prolific and return the study.
            </p>
          </>
        ) : blocked === 'fullscreen_violations' ? (
          <>
            <h2 className="text-xl font-semibold text-red-600">Session Terminated: Excessive Fullscreen Violations</h2>
            <p className="text-red-600">
              You have been removed from this study due to repeated attempts to exit fullscreen mode.
            </p>
            <p className="text-gray-700 mt-3">
              This study requires fullscreen mode to maintain focus and ensure data quality. After multiple warnings, you exceeded the maximum allowed violations ({totalViolations} violations detected).
            </p>
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="font-semibold text-red-800 mb-2">What to do next:</p>
              <p className="text-sm text-red-700">
                Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline font-semibold">click this link</a> to go back to Prolific and return the study.
              </p>
            </div>
          </>
        ) : blocked === 'supabase_error' ? (
          <>
            <h2 className="text-xl font-semibold text-red-600">Study Temporarily Unavailable</h2>
            <p className="text-red-600">
              The study system is not properly configured. Data tracking is required for this study.
            </p>
            <p className="text-gray-600">
              Please contact the researcher, refresh the page, or try again later. If you decide to try later, <a href="https://app.prolific.com/submissions" className="text-blue-600 underline">click this link</a> to go back to Prolific and return the study.
            </p>
          </>
        ) : blocked === 'initialization_error' ? (
          <>
            <h2 className="text-xl font-semibold text-red-600">Unable to Start Study</h2>
            <p className="text-red-600">
              An error occurred while initializing your session.
            </p>
            <p className="text-gray-600">
              Please contact the researcher with your Prolific ID or try refreshing the page. If you decide to try later, <a href="https://app.prolific.com/submissions" className="text-blue-600 underline">click this link</a> to go back to Prolific and return the study.
            </p>
          </>
        ) : blocked === 'already_started' ? (
          <>
            <h2 className="text-xl font-semibold text-red-600">Session Already Started</h2>
            <p className="text-red-600">
              Our records show that you have already started this study session.
            </p>
            <p className="text-gray-700 mt-3">
              Once you begin the study, you cannot restart or rejoin if you leave the session. This policy ensures data integrity and prevents participants from seeing study materials multiple times.
            </p>
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="font-semibold text-red-800 mb-2">What to do next:</p>
              <p className="text-sm text-red-700">
                Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline font-semibold">click this link</a> to go back to Prolific and return the study.
              </p>
            </div>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm font-semibold">If you believe this is an error:</p>
              <p className="text-sm">Please contact the researcher with your Prolific ID.</p>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-red-600">Study Already Completed</h2>
            <p>
              Our records show that you have already {blocked === 'already_completed' ? 'completed' : 'started'} this study.
              Each participant can only complete the study once. <a href="https://app.prolific.com/submissions" className="text-blue-600 underline">Click this link</a> to go back to Prolific and return the study.
            </p>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm font-semibold">If you believe this is an error:</p>
              <p className="text-sm">Please contact the researcher with your Prolific ID.</p>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
  
  // Session invalidated screen (for attention strike during study)
  const InvalidatedScreen = (
    <Shell title="Session Invalidated">
      <div className="prose max-w-none text-center">
        <div className="mb-6">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold text-red-600 mb-4">Your Session Has Been Invalidated</h2>
        </div>
        <p className="text-red-600 mb-4">
          You have been removed from this study due to insufficient attention during the task.
        </p>
        <p className="text-gray-700 mb-6">
          Our system detected prolonged periods of inactivity that indicate you were not actively engaged with the writing task.
        </p>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="font-semibold text-red-800 mb-2">What to do next:</p>
          <p className="text-sm text-red-700">
            Please close this window and return the study on Prolific <a href="https://app.prolific.com/submissions" className="text-blue-600 underline">using this link</a>.
            Your participation data has been recorded as incomplete.
          </p>
        </div>
      </div>
    </Shell>
  );

  // Device incompatible screen
  const DeviceIncompatibleScreen = (
    <Shell title="Device Not Compatible">
      <div className="prose max-w-none text-center">
        <div className="mb-6">
          <div className="text-6xl mb-4">💻</div>
          <h2 className="text-2xl font-bold text-red-600 mb-4">Device Not Compatible</h2>
        </div>
        <p className="text-red-600 mb-4 font-semibold">
          {deviceIncompatible}
        </p>
        <p className="text-gray-700 mb-6">
          This study requires specific hardware capabilities for accurate data collection and optimal user experience.
        </p>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <p className="font-semibold text-blue-800 mb-2">Requirements:</p>
          <ul className="text-sm text-blue-700 text-left list-disc list-inside">
            <li>Laptop or desktop computer</li>
            <li>Physical keyboard and mouse</li>
            <li>Minimum screen resolution: 1024x600</li>
            <li>Not a tablet or mobile device</li>
          </ul>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="font-semibold text-red-800 mb-2">What to do next:</p>
          <p className="text-sm text-red-700">
            Please <a href="https://app.prolific.com/submissions" className="text-blue-600 underline font-semibold">click this link</a> to go back to Prolific and return the study.
          </p>
          <p className="text-sm text-gray-600 mt-3">
            If you have access to a compatible device, you may try again from that device.
          </p>
        </div>
      </div>
    </Shell>
  );

  if (!loaded) return <div className="p-6 text-gray-500">Loading…</div>;
  
  if (deviceIncompatible) return DeviceIncompatibleScreen;
  
  if (blocked) return BlockedScreen;
  
  // Show invalidated screen if attention strike occurred
  if (attn.finalStrike) return InvalidatedScreen;
  
  if (!meta) return <div className="p-6 text-gray-500">Loading…</div>;

  if ((step as any) === 4.1) return CompletionScreen;

  return (
    <div className="min-h-screen">
      {step === 1 && (
        <ComplianceGate 
          initialViolations={totalViolations}
          onViolation={(n) => {
            console.log("Violation", n);
            setTotalViolations(n);
          }}>
          <InstructionsView meta={meta} sessionId={sessionId} onNext={()=> setStep(2)} />
        </ComplianceGate>
      )}
      
      {step === 2 && (
        <ComplianceGate 
          initialViolations={totalViolations}
          onViolation={(n) => {
            console.log("Violation", n);
            setTotalViolations(n);
          }}>
          <PromptView meta={meta} onNext={() => setStep(3)} />
        </ComplianceGate>
      )}


{step === 3 && (
  <ComplianceGate 
    initialViolations={totalViolations}
    onViolation={(n) => {
      console.log("Violation", n);
      setTotalViolations(n);
    }}>
    {/* Attention warnings for brainstorm phase */}
    {attn.showFinalWarning && !attn.finalStrike && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-orange-500 text-white px-6 py-3 rounded-lg shadow-lg text-center max-w-md">
        <div className="font-bold">⚠️ Final Warning</div>
        <div className="text-sm">We need your full attention. Please stay focused or your session may be invalidated.</div>
      </div>
    )}
    
    {attn.showNudge && !attn.showFinalWarning && !attn.finalStrike && (
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-black text-white px-6 py-4 rounded-lg shadow-lg text-center">
        <div className="text-base font-semibold mb-1">👋 Still with us?</div>
        <div className="text-sm">A quick keystroke or scroll helps maintain your attention score.</div>
      </div>
    )}

    {/* Development mode attention score display */}
    {DEV_MODE && (
      <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white p-3 rounded-lg text-sm font-mono shadow-lg">
        <div className="text-xs text-gray-300 mb-1">Attention Score (Dev Mode)</div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                attn.score > 0.7 ? 'bg-green-500' : 
                attn.score > 0.5 ? 'bg-yellow-500' : 
                attn.score > 0.35 ? 'bg-orange-500' : 'bg-red-500'
              }`}
              style={{ width: `${attn.score * 100}%` }}
            />
          </div>
          <span className="text-xs">{(attn.score * 100).toFixed(0)}%</span>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Nudges: {attn.nudges} | Worst: {(attn.worstScore * 100).toFixed(0)}%
          {attn.showFinalWarning && <span className="text-orange-400"> | FINAL WARNING</span>}
          {attn.finalStrike && <span className="text-red-400"> | STRIKE</span>}
        </div>
      </div>
    )}
    
    <BrainstormView meta={meta} value={brainstorm} setValue={setBrainstorm} sessionId={sessionId} onNext={()=> setStep(4)} />
  </ComplianceGate>
)}



{step === 4 && (
  <ComplianceGate 
    initialViolations={totalViolations}
    onViolation={(n) => {
      console.log("Violation", n);
      setTotalViolations(n);
    }}>
    {/* Development mode attention score display */}
    {DEV_MODE && (
      <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white p-3 rounded-lg text-sm font-mono shadow-lg">
        <div className="text-xs text-gray-300 mb-1">Attention Score (Dev Mode)</div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                attn.score > 0.7 ? 'bg-green-500' : 
                attn.score > 0.4 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${attn.score * 100}%` }}
            />
          </div>
          <span className="text-xs">{(attn.score * 100).toFixed(1)}%</span>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Nudges: {attn.nudges} | Worst: {(attn.worstScore * 100).toFixed(1)}%
        </div>
        {attn.showFinalWarning && (
          <div className="text-xs text-amber-400 mt-1">⚠️ Final Warning Active</div>
        )}
        {attn.finalStrike && (
          <div className="text-xs text-red-400 mt-1">🚨 Final Strike!</div>
        )}
      </div>
    )}

    {/* attention banners/toasts */}
    {attn.showFinalWarning && !attn.finalStrike && (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 bg-amber-100 text-amber-900 border border-amber-300 px-4 py-2 rounded-lg text-sm shadow">
        Final warning: keep engaging (typing, moving the mouse). If your attention drops again, your submission may be flagged.
      </div>
    )}
    
    {attn.showNudge && !attn.finalStrike && (
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-black text-white px-6 py-4 rounded-lg shadow-lg text-center">
        <div className="text-base font-semibold mb-1">👋 Still with us?</div>
        <div className="text-sm">A quick keystroke or scroll helps maintain your attention score.</div>
      </div>
    )}

    {/* Your existing EditorView */}
    <WritingStudy
      preview={localPreview}
      access={meta.aiAccess ?? access}
      meta={meta}
      brainstorm={localPreview && !outlineText(brainstorm).trim() ? JSON.stringify(previewBrainstorm) : brainstorm}
      sessionId={sessionId}
      onNext={(t, a, writing) => {
        // record attention status in your payload
        setFinalText(t);
        setAiTranscript(a);
        // example: store to state to include at submit
        setAttentionMeta({
          writing,
          attentionScoreAtSubmit: attn.score,
          worstAttentionScore: attn.worstScore,
          nudges: attn.nudges,
          finalWarningShown: attn.showFinalWarning,
          finalStrike: attn.finalStrike, // <-- flag this if you want to invalidate/mark
          fullscreenViolations: totalViolations, // Include fullscreen violation count
        });
        if (!recallStarted.current) {
          recallStarted.current = true;
          setRecall({status: 'loading'});
          // The backend saves the final story before calling the model.
          // Do not await generation here: participants complete the survey in parallel.
          void recallApi({action: 'generate', story: t || (localPreview && skip ? 'Local layout preview story.' : ''), preview: localPreview, sessionId})
            .then(data => setRecall({status: 'ready', data}))
            .catch(error => setRecall({status: 'error', message: error instanceof Error ? error.message : 'Unable to prepare story questions.'}));
        }
        setStep(5);
      }}
    />
  </ComplianceGate>
)}

{step === 5 && (
  <ComplianceGate 
    initialViolations={totalViolations}
    onViolation={(n) => {
      console.log("Violation", n);
      setTotalViolations(n);
    }}>
    <PostTaskSurvey hasAI={meta.group.startsWith("AI") && (meta.aiAccess ?? access) !== "neither"} aiAccess={meta.aiAccess ?? access} recall={recall} onRetryQuiz={retryQuiz} preview={localPreview} sessionId={sessionId} onSubmit={onFinishSurvey} />
  </ComplianceGate>
)}

    </div>
  );
};

export default StudyApp;
