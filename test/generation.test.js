import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_LIMITS, generateDeck, rewriteSlide, sampleBrief, sampleDeck, validateDeck } from '../src/generation.js';

const success = (data) => ({
  model: 'test-model',
  stopReason: 'endTurn',
  content: { type: 'text', text: JSON.stringify(data) },
  usage: { inputTokens: 102, outputTokens: 334, totalTokens: 436 },
  _meta: { quotaConsumed: 0.4, latencyMs: 456 },
});

function mockAnna(handler) {
  const requests = [];
  const anna = {
    llm: {
      async complete(request) {
        requests.push(request);
        return handler(request);
      },
    },
  };
  return { anna, requests };
}

test('generation spends one bounded Anna completion and returns verified data and usage', async () => {
  const { anna, requests } = mockAnna(() => {
    const reply = success(sampleDeck);
    reply.content.text = '```json\n' + reply.content.text + '\n```';
    return reply;
  });
  const { deck, usage } = await generateDeck(anna, sampleBrief);
  assert.deepEqual(deck, sampleDeck);
  assert.deepEqual(usage, {
    model: 'test-model', inputTokens: 102, outputTokens: 334, totalTokens: 436,
    quotaConsumed: 0.4, latencyMs: 456,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].thinking, false);
  assert.deepEqual(requests[0].modelPreferences, { hints: [{ name: 'qwen3.8-flash' }] });
  assert.ok(requests[0].maxTokens > 0 && requests[0].maxTokens < 8192);
  assert.match(requests[0].systemPrompt, /exactly 5 slides/);
  assert.deepEqual(requests[0].messages.map(({ role }) => role), ['user']);
  assert.deepEqual(JSON.parse(requests[0].messages[0].content.text), sampleBrief);
});

test('invalid briefs are rejected before calling Anna', async () => {
  const { anna, requests } = mockAnna(() => success(sampleDeck));
  await assert.rejects(generateDeck(anna, { ...sampleBrief, topic: '   ' }), { code: 'validation' });
  await assert.rejects(generateDeck(anna, { ...sampleBrief, count: 9 }), { code: 'validation' });
  await assert.rejects(generateDeck(anna, { ...sampleBrief, source: '字'.repeat(FIELD_LIMITS.source + 1) }), { code: 'validation' });
  assert.equal(requests.length, 0);
});

test('truncated and malformed replies fail safely with no follow-up calls', async () => {
  const fourSlideDeck = { ...sampleDeck, slides: sampleDeck.slides.slice(0, 4) };
  const malformed = { ...success(sampleDeck), content: { text: '{"slides":[' } };
  const cases = [
    [{ ...malformed, stopReason: 'maxTokens' }, 'truncated'],
    [{ ...malformed, stopReason: 'contentFilter' }, 'content_filter'],
    [malformed, 'invalid_output'],
    [success(fourSlideDeck), 'invalid_output'],
    [success({ ...sampleDeck, slides: [...sampleDeck.slides].reverse() }), 'invalid_output'],
  ];
  for (const [reply, code] of cases) {
    const { anna, requests } = mockAnna(() => reply);
    await assert.rejects(generateDeck(anna, sampleBrief), { code });
    assert.equal(requests.length, 1);
  }
});

test('quota errors stay actionable and never trigger another request', async () => {
  const { anna, requests } = mockAnna(() => {
    throw Object.assign(new Error('quota'), { code: 'quota_exceeded' });
  });
  await assert.rejects(generateDeck(anna, sampleBrief), { code: 'quota_exceeded' });
  assert.equal(requests.length, 1);
});

test('deck validation returns an independent draft and rejects content outside layout limits', () => {
  const draft = validateDeck(sampleDeck);
  draft.slides[0].title = '新的封面';
  assert.notEqual(draft.slides[0].title, sampleDeck.slides[0].title);
  draft.slides[2].items.push({ heading: '超出的要点', body: '模拟数据' });
  assert.throws(() => validateDeck(draft), { code: 'validation' });
  draft.slides[2].items.pop();
  draft.slides[2].items[0].body = '字'.repeat(FIELD_LIMITS.body + 1);
  assert.throws(() => validateDeck(draft), { code: 'validation' });
});

test('incomplete drafts can be restored while incomplete exports stay invalid', () => {
  const draft = structuredClone(sampleDeck);
  draft.slides[1].items[0].body = '';
  assert.equal(validateDeck(draft, undefined, { draft: true }).slides[1].items[0].body, '');
  assert.throws(() => validateDeck(draft), { code: 'validation' });
});

test('rewrite returns one slide and preserves the current layout', async () => {
  const rewritten = { ...sampleDeck.slides[1], title: '缩短查找和确认路径' };
  const { anna, requests } = mockAnna(() => success(rewritten));
  const { slide } = await rewriteSlide(anna, sampleDeck, 1, '把标题改为行动式');
  assert.deepEqual(slide, rewritten);
  assert.notEqual(slide.title, sampleDeck.slides[1].title);
  assert.equal(JSON.parse(requests[0].messages[0].content.text).index, 2);
  assert.equal(requests.length, 1);

  const differentLayout = mockAnna(() => success(sampleDeck.slides[2]));
  await assert.rejects(rewriteSlide(differentLayout.anna, sampleDeck, 1, '把标题改为行动式'), { code: 'invalid_output' });
  assert.equal(differentLayout.requests.length, 1);
});
