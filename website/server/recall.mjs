import { randomUUID } from 'node:crypto';
import { RECALL_PROMPT, RECALL_PROMPT_VERSION, RECALL_CATEGORIES, RECALL_FORMAT_INSTRUCTIONS } from './recall-prompt.mjs';

export const questionSchema = {
  type: 'object', additionalProperties: false, required: ['questions'], properties: {
    questions: {type: 'array', minItems: 5, maxItems: 5, items: {
      type: 'object', additionalProperties: false,
      required: ['category', 'question', 'choices', 'correctIndex', 'evidence'],
      properties: {
        category: {type: 'string', enum: RECALL_CATEGORIES}, question: {type: 'string'},
        choices: {type: 'array', minItems: 4, maxItems: 4, items: {type: 'string'}},
        correctIndex: {type: 'integer', enum: [0, 1, 2, 3]}, evidence: {type: 'string'},
      },
    }},
  },
};
export function validateQuestions(value) {
  if (!Array.isArray(value?.questions) || value.questions.length !== 5) throw new Error('Expected five questions');
  value.questions.forEach((q, i) => {
    if (q.category !== RECALL_CATEGORIES[i] || typeof q.question !== 'string' || !q.question.trim() ||
      !Array.isArray(q.choices) || q.choices.length !== 4 || q.choices.some(c => typeof c !== 'string' || !c.trim()) ||
      new Set(q.choices.map(c => c.trim().toLowerCase())).size !== 4 ||
      !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3 || typeof q.evidence !== 'string' || !q.evidence.trim()) {
      throw new Error('Invalid recall question');
    }
  });
  return value.questions;
}
export async function generateQuestions(story, env, fetchImpl = fetch) {
  if (!env.OPENAI_API_KEY) throw new Error('Recall generation is not configured');
  const prompt = env.RECALL_PROMPT || RECALL_PROMPT;
  if (!prompt.includes('[STORY]')) throw new Error('Recall prompt must contain [STORY]');
  const model = env.RECALL_MODEL || 'gpt-6.1-sol';
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(45000),
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}`},
    body: JSON.stringify({model, store: false, reasoning_effort: 'low', messages: [
      {role: 'system', content: `${RECALL_FORMAT_INSTRUCTIONS}\nCategories: ${RECALL_CATEGORIES.join(', ')}`},
      {role: 'user', content: prompt.replace('[STORY]', () => `<story>\n${story}\n</story>`)},
    ], response_format: {type: 'json_schema', json_schema: {name: 'story_recall', strict: true, schema: questionSchema}}}),
  });
  if (!response.ok) throw new Error(`Recall provider returned ${response.status}`);
  const data = await response.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== 'stop' || choice.message?.refusal) throw new Error('Recall generation was incomplete or refused');
  return {questions: validateQuestions(JSON.parse(choice.message.content)), model, prompt, promptVersion: RECALL_PROMPT_VERSION};
}
export function scoreQuestions(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== 5 || answers.some(a => !Number.isInteger(a) || a < 0 || a > 4)) throw new Error('Answer all five questions');
  return {answers, correct: answers.map((a, i) => a === questions[i].correctIndex), score: answers.filter((a, i) => a === questions[i].correctIndex).length, total: 5};
}
export function mockQuestions() {
  return [
    {
      category: 'Central character', question: 'Who narrates the story?',
      choices: ['Sam, who plays guitar by the fire', 'Marcus, who brings an inflatable flamingo', 'An unnamed friend who drives the group to the beach', "Lena, who searches for her grandmother's locket"],
      correctIndex: 2,
    },
    {
      category: 'Character goal/motivation', question: 'What does Lena hope to find during the beach trip?',
      choices: ['A special seashell for her grandmother', 'A small locket her grandmother lost years ago', 'A place to celebrate her acceptance into a program abroad', 'A message from someone she once knew'],
      correctIndex: 1,
    },
    {
      category: 'Obstacle/source of tension', question: "What makes Lena's unsuccessful search for the locket feel especially meaningful?",
      choices: ['She discovers that Marcus has been hiding the locket.', 'The group must leave the beach earlier than expected.', 'She reveals that she will be going abroad in the fall.', 'Her friends refuse to help her search the shoreline.'],
      correctIndex: 2,
    },
    {
      category: 'Plot trajectory', question: "Which sequence of events best describes the story's progression?",
      choices: ['The friends arrive at the beach, discover a mysterious bottle, search for the locket, and head home.', 'The friends drive to the beach, enjoy activities together, search unsuccessfully for the locket, and decide to investigate a mysterious invitation.', "Lena finds her grandmother's locket, announces her plans to study abroad, and invites her friends to a midnight celebration.", 'The friends spend the day searching for a lost bottle before discovering a message that leads them to the dunes.'],
      correctIndex: 1,
    },
    {
      category: 'Setting', question: 'Where does most of the story take place?',
      choices: ['At a lakeside campground surrounded by woods', 'In a small coastal town during a winter vacation', 'At a beach with dunes, a jetty, and a nearby pier', 'On a boat traveling between coastal islands'],
      correctIndex: 2,
    },
  ].map(q => ({...q, evidence: 'User-provided preview question and answer key; not based on the submitted story.'}));
}
const previews = new Map();
async function database(env, path, options = {}) {
  const url = env.SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Recall database is not configured');
  return fetch(`${url}/rest/v1/${path}`, { ...options, signal: AbortSignal.timeout(10000), headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers,
  }});
}
const publicResult = record => ({id: record.id, simulated: record.simulated || false,
  questions: record.questions.map(({category, question, choices}, i) => ({id: `recall_${i + 1}`, category, question, choices: [...choices, 'None of the above']}))});

// Shared by the Vercel function and the local Vite middleware. Secrets never reach the browser.
export async function recallRequest(body, {env = process.env, allowPreview = false, generate = generateQuestions} = {}) {
  if (!body || !['generate', 'score', 'save_record'].includes(body.action)) return {status: 400, data: {error: 'Invalid request'}};
  const preview = allowPreview && body.preview === true;
  if (body.preview && !preview) return {status: 403, data: {error: 'Preview is local only'}};
  try {
    if (body.action === 'save_record') {
      if (!['rough_draft', 'survey'].includes(body.kind) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return {status: 400, data: {error: 'Invalid study record'}};
      if (body.kind === 'rough_draft' && (typeof body.payload.text !== 'string' || !Array.isArray(body.payload.transcript) || typeof body.payload.completedAt !== 'string')) return {status: 400, data: {error: 'Invalid rough draft'}};
      if (body.kind === 'survey' && (!body.payload.answers || typeof body.payload.submittedAt !== 'string')) return {status: 400, data: {error: 'Invalid survey'}};
      if (preview) return {status: 200, data: {saved: true, simulated: true}};
      if (!/^[\da-f-]{36}$/i.test(body.sessionId || '')) return {status: 400, data: {error: 'Invalid session'}};
      const session = await database(env, `sessions?id=eq.${body.sessionId}&finished_at=is.null&select=id`);
      if (!session.ok || !(await session.json()).length) return {status: 403, data: {error: 'An active study session is required'}};
      const saved = await database(env, 'study_records?on_conflict=session_id,kind', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'}, body: JSON.stringify({session_id: body.sessionId, kind: body.kind, payload: body.payload})});
      if (!saved.ok) throw new Error('Could not save study record');
      return {status: 200, data: {saved: true}};
    }
    if (body.action === 'score') {
      let record;
      if (preview) record = previews.get(body.id);
      else {
        if (!/^[\da-f-]{36}$/i.test(body.id || '') || !/^[\da-f-]{36}$/i.test(body.sessionId || '')) return {status: 400, data: {error: 'Invalid session'}};
        const response = await database(env, `recall_generations?id=eq.${body.id}&session_id=eq.${body.sessionId}&select=*`);
        if (!response.ok) throw new Error('Could not retrieve recall questions');
        record = (await response.json())[0];
      }
      if (!record || record.status !== 'ready') return {status: 409, data: {error: 'Recall questions are not available'}};
      if (record.responses) return {status: 200, data: {generationId: record.id, ...record.responses, simulated: record.simulated || false}};
      let scoring;
      try { scoring = scoreQuestions(record.questions, body.answers); } catch { return {status: 400, data: {error: 'Answer all five questions'}}; }
      const responses = {...scoring, bonusCents: scoring.score * 10, submittedAt: new Date().toISOString()};
      if (!preview) {
        const saved = await database(env, `recall_generations?id=eq.${record.id}&session_id=eq.${body.sessionId}&responses=is.null`, {method: 'PATCH', body: JSON.stringify({responses})});
        if (!saved.ok) throw new Error('Could not save recall answers');
        if (!(await saved.json()).length) {
          const existing = await database(env, `recall_generations?id=eq.${record.id}&session_id=eq.${body.sessionId}&select=*`);
          if (!existing.ok) throw new Error('Could not retrieve saved quiz');
          const previous = (await existing.json())[0];
          if (!previous?.responses) throw new Error('Could not retrieve saved quiz');
          return {status: 200, data: {generationId: record.id, ...previous.responses, simulated: record.simulated || false}};
        }
      } else {
        record.responses = responses;
      }
      return {status: 200, data: {generationId: record.id, ...responses, simulated: record.simulated || false}};
    }
    if (typeof body.story !== 'string' || !body.story.trim() || body.story.length > 20000) return {status: 400, data: {error: 'A story of 1–20,000 characters is required'}};
    let record = {id: randomUUID(), session_id: body.sessionId, story: body.story, status: 'pending', simulated: preview};
    if (!preview) {
      if (!/^[\da-f-]{36}$/i.test(body.sessionId || '')) return {status: 400, data: {error: 'Invalid session'}};
      const session = await database(env, `sessions?id=eq.${body.sessionId}&finished_at=is.null&select=id`);
      if (!session.ok || !(await session.json()).length) return {status: 403, data: {error: 'An active study session is required'}};
      const claimed = await database(env, 'recall_generations', {method: 'POST', body: JSON.stringify(record)});
      if (claimed.status === 409) {
        const existing = await database(env, `recall_generations?session_id=eq.${body.sessionId}&select=*`);
        if (!existing.ok) throw new Error('Could not retrieve recall generation');
        const previous = (await existing.json())[0];
        if (previous?.story !== body.story) return {status: 409, data: {error: 'The submitted story cannot be changed'}};
        if (previous?.status === 'ready') return {status: 200, data: publicResult(previous)};
        return {status: 409, data: {error: 'Recall generation is already pending or has failed. Please contact the researcher.'}};
      }
      if (!claimed.ok) throw new Error('Could not save submitted story');
      // Start the model only after Supabase confirms the immutable final story.
      const saved = (await claimed.json())[0];
      if (!saved || saved.story !== body.story || saved.status !== 'pending') throw new Error('Could not confirm saved story');
      record = saved;
    }
    try {
      const result = preview && env.RECALL_PREVIEW_LIVE !== 'true'
        ? {questions: mockQuestions(), model: 'simulated', prompt: RECALL_PROMPT, promptVersion: RECALL_PROMPT_VERSION}
        : await generate(record.story, env);
      record = {...record, ...result, simulated: result.model === 'simulated', status: 'ready'};
      if (preview) {
        // Preview data is ephemeral and bounded; production uses the database.
        if (previews.size >= 100) previews.delete(previews.keys().next().value);
        previews.set(record.id, record);
      } else {
        const saved = await database(env, `recall_generations?id=eq.${record.id}`, {method: 'PATCH', body: JSON.stringify(record)});
        if (!saved.ok) throw new Error('Could not save recall questions');
      }
      return {status: 200, data: publicResult(record)};
    } catch (error) {
      if (!preview) await database(env, `recall_generations?id=eq.${record.id}`, {method: 'PATCH', body: JSON.stringify({status: 'failed'})}).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error('Recall operation failed:', error.message);
    return {status: 503, data: {error: body.action === 'save_record' ? 'Your responses could not be saved. Please try again. Your responses are retained on this page.' : 'The story questions could not be prepared. Please contact the researcher. Your current answers are retained on this page.'}};
  }
}
