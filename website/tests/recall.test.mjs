import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuestions, recallRequest, scoreQuestions, validateQuestions } from '../server/recall.mjs';
import { RECALL_CATEGORIES } from '../server/recall-prompt.mjs';
const questions = RECALL_CATEGORIES.map((category, i) => ({category, question: `Question ${i + 1}?`, choices: ['One', 'Two', 'Three', 'Four'], correctIndex: i % 4, evidence: 'A quote from the story.'}));
test('one model call produces all five questions using the configurable prompt and final story', async () => {
  let calls = 0;
  const result = await generateQuestions('My final story contains $& and [STORY].', {OPENAI_API_KEY: 'test-secret', RECALL_PROMPT: 'New instruction: [STORY]'}, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.messages.length, 2);
    assert.ok(body.messages[1].content.includes('My final story contains $& and [STORY].'));
    assert.equal(body.response_format.json_schema.strict, true);
    return {ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({questions})}}]})};
  });
  assert.equal(calls, 1); assert.equal(result.questions.length, 5); assert.equal(result.prompt, 'New instruction: [STORY]');
});
test('rejects malformed question sets and refusal instead of silently using them', async () => {
  assert.throws(() => validateQuestions({questions: questions.slice(1)}));
  assert.throws(() => validateQuestions({questions: questions.map(q => ({...q, choices: ['Same','Same','Other','Last']}))}));
  assert.throws(() => validateQuestions({questions: questions.map(q => ({...q, correctIndex: 4}))}));
  await assert.rejects(generateQuestions('Story', {OPENAI_API_KEY: 'test'}, async () => ({ok: true, json: async () => ({choices: [{finish_reason: 'stop', message: {refusal: 'Refused'}}]})})), /refused/);
});
test('scores zero-based answers and rejects incomplete answers', () => {
  assert.equal(scoreQuestions(questions, [0,1,2,3,0]).score, 5);
  assert.equal(scoreQuestions(questions, [1,2,3,0,1]).score, 0);
  assert.equal(scoreQuestions(questions, [4,4,4,4,4]).score, 0);
  assert.throws(() => scoreQuestions(questions, [5,0,0,0,0]));
  assert.throws(() => scoreQuestions(questions, [0,1]));
});
test('local preview returns five choices sets without exposing answer keys; score is server-side', async () => {
  const generated = await recallRequest({action: 'generate', story: 'Local test story.', preview: true}, {allowPreview: true, env: {}});
  assert.equal(generated.status, 200); assert.equal(generated.data.simulated, true);
  assert.equal(generated.data.questions.length, 5);
  assert.ok(generated.data.questions.every(q => q.choices.length === 5 && q.choices[4] === 'None of the above'));
  assert.equal(generated.data.questions[0].correctIndex, undefined);
  assert.equal(generated.data.questions[0].evidence, undefined);
  assert.equal(generated.data.questions[0].question, 'Who narrates the story?');
  const scored = await recallRequest({action: 'score', id: generated.data.id, answers: [2,1,2,1,2], preview: true}, {allowPreview: true, env: {}});
  assert.equal(scored.status, 200); assert.equal(scored.data.score, 5);
  assert.equal(scored.data.bonusCents, 50);
});
test('production cannot enable preview, and invalid input never triggers a model call', async () => {
  let calls = 0; const generate = async () => {calls++;};
  assert.equal((await recallRequest({action: 'generate', story: 'Story', preview: true}, {generate})).status, 403);
  assert.equal((await recallRequest({action: 'generate', story: ''}, {generate})).status, 400);
  assert.equal((await recallRequest({action: 'generate', story: 'x'.repeat(20001)}, {generate})).status, 400);
  assert.equal((await recallRequest({action: 'generate', story: 'Story', sessionId: 'bad'}, {generate})).status, 400);
  assert.equal(calls, 0);
});

test('production claims a session once, persists questions, and reuses them on duplicate submission', async (t) => {
  let record; let calls = 0;
  const sessionId = '11111111-1111-4111-8111-111111111111';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/sessions?')) return Response.json([{id: sessionId}]);
    if (options.method === 'POST') {
      if (record) return new Response(null, {status: 409});
      record = JSON.parse(options.body);
      return Response.json([record], {status: 201});
    }
    if (options.method === 'PATCH') record = {...record, ...JSON.parse(options.body)};
    return Response.json([record]);
  });
  const options = {env: {SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test'}, generate: async () => {
    calls++; return {questions, model: 'test-model', prompt: 'Test prompt', promptVersion: '1'};
  }};
  const body = {action: 'generate', sessionId, story: 'Final submitted story.'};
  const first = await recallRequest(body, options);
  const second = await recallRequest(body, options);
  assert.equal(first.status, 200); assert.deepEqual(second, first); assert.equal(calls, 1);
  assert.equal(record.story, body.story); assert.equal(record.status, 'ready');
  assert.equal(first.data.questions[0].correctIndex, undefined);
  assert.equal((await recallRequest({...body, story: 'Changed story'}, options)).status, 409);
  const scored = await recallRequest({action: 'score', id: first.data.id, sessionId, answers: [0,1,2,3,0]}, options);
  assert.equal(scored.status, 200); assert.equal(record.responses.score, 5); assert.equal(calls, 1);
});

test('rough draft and survey save independently with immutable retry semantics', async (t) => {
  const records = new Map();
  const sessionId = '11111111-1111-4111-8111-111111111111';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/sessions?')) return Response.json([{id: sessionId}]);
    assert.ok(url.includes('study_records?on_conflict=session_id,kind'));
    assert.equal(options.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
    const record = JSON.parse(options.body);
    if (!records.has(record.kind)) records.set(record.kind, record);
    return Response.json([records.get(record.kind)]);
  });
  const options = {env: {SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test'}};
  const rough = {action: 'save_record', sessionId, kind: 'rough_draft', payload: {text: 'My rough draft', transcript: [], completedAt: '2026-10-15T12:00:00Z'}};
  assert.equal((await recallRequest(rough, options)).status, 200);
  assert.equal((await recallRequest({...rough, payload: {...rough.payload, text: 'Retry'}}, options)).status, 200);
  assert.equal(records.get('rough_draft').payload.text, 'My rough draft');
  assert.equal((await recallRequest({action: 'save_record', sessionId, kind: 'survey', payload: {answers: {credit: 0}, submittedAt: '2026-10-15T12:20:00Z'}}, options)).status, 200);
  assert.equal(records.size, 2);
  assert.equal(records.get('survey').payload.answers.credit, 0);
});
