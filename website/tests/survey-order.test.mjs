import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {orderSurveyPages} from '../src/surveyOrder.ts';
import {surveyPages} from '../src/surveyQuestions.ts';

test('survey order survives refresh and only permutes the three intact blocks', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const session = randomUUID();
    const pages = orderSurveyPages(surveyPages, session);
    assert.deepEqual(pages, orderSurveyPages(surveyPages, session));
    assert.equal(pages[0], surveyPages[0]);
    assert.equal(pages[4], surveyPages[4]);
    assert.equal(pages[5], surveyPages[5]);
    assert.equal(new Set(pages.map(p => p.id)).size, surveyPages.length);
    for (const page of pages) assert.equal(page, surveyPages.find(p => p.id === page.id));
    seen.add(pages.slice(1, 4).map(p => p.id).join(','));
  }
  assert.equal(seen.size, 6);
});
