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
        return handler(request, requests.length - 1);
      },
    },
  };
  return { anna, requests };
}

const plan = {
  slides: sampleDeck.slides.map((slide, index) => ({
    layout: slide.layout, takeaway: slide.title, sourceIds: index === 0 ? [] : [1],
  })),
};

test('plans against numbered source excerpts, writes, and audits using separate model hints', async () => {
  const fenced = success(sampleDeck);
  fenced.content.text = '```json\n' + fenced.content.text + '\n```';
  const responses = [success(plan), fenced, success({ issues: [] })];
  const { anna, requests } = mockAnna((_, index) => responses[index]);
  const stages = [];
  const { deck, usage, review } = await generateDeck(anna, sampleBrief, { onProgress: (stage) => stages.push(stage) });
  assert.deepEqual(deck.slides, sampleDeck.slides);
  assert.equal(deck.title, sampleDeck.title);
  assert.equal(deck.evidence.length, sampleDeck.slides.length);
  assert.deepEqual(deck.evidence[0], []);
  assert.ok(sampleBrief.source.includes(deck.evidence[1][0]));
  assert.deepEqual(validateDeck(deck).evidence, deck.evidence);
  assert.deepEqual(review, { issues: [] });
  assert.equal(usage.totalTokens, 1308);
  assert.ok(Math.abs(usage.quotaConsumed - 1.2) < 0.0001);
  assert.deepEqual(stages, ['plan', 'write', 'review']);
  assert.deepEqual(usage.calls.map(({ stage }) => stage), stages);
  assert.deepEqual(requests.map(({ modelPreferences }) => modelPreferences.hints[0].name), [
    'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5', 'anthropic/claude-opus-5',
  ]);
  assert.ok(requests.every(({ thinking, maxTokens }) => thinking === false && maxTokens > 0 && maxTokens < 8192));
  assert.match(requests[0].systemPrompt, /exactly 5 pages/);
  assert.deepEqual(JSON.parse(requests[1].messages[0].content.text).plan, plan.slides);
  assert.deepEqual(JSON.parse(requests[2].messages[0].content.text).reviewPages, [1, 2, 3, 4, 5]);
});

test('repairs only pages named by the reviewer and verifies those pages again', async () => {
  const issues = [{ slide: 2, message: '明确第 1 周才测量基线。' }];
  const revised = { ...sampleDeck.slides[1], title: '首响基线将在第 1 周建立' };
  const responses = [
    success(plan), success(sampleDeck), success({ issues }),
    success({ replacements: [{ page: 2, slide: revised }] }), success({ issues: [] }),
  ];
  const { anna, requests } = mockAnna((_, index) => responses[index]);
  const { deck, review, usage } = await generateDeck(anna, sampleBrief);
  assert.deepEqual(deck.slides, [sampleDeck.slides[0], revised, ...sampleDeck.slides.slice(2)]);
  assert.deepEqual(review, { issues: [] });
  assert.deepEqual(usage.calls.map(({ stage }) => stage), ['plan', 'write', 'review', 'repair', 'review']);
  assert.deepEqual(JSON.parse(requests.at(-1).messages[0].content.text).reviewPages, [2]);
});

test('keeps the valid original when review or targeted repair returns invalid data', async () => {
  const issues = [{ slide: 2, message: '核对首响统计口径。' }];
  for (const [tail, remaining] of [
    [[success({ issues: [{ slide: 20, message: '页码不存在' }] })], []],
    [[success({ issues }), success({ replacements: [{ page: 3, slide: sampleDeck.slides[2] }] })], issues],
  ]) {
    const responses = [success(plan), success(sampleDeck), ...tail];
    const { anna, requests } = mockAnna((_, index) => responses[index]);
    const { deck, review, usage } = await generateDeck(anna, sampleBrief);
    assert.deepEqual(deck.slides, sampleDeck.slides);
    assert.deepEqual(review.issues, remaining);
    assert.ok(review.warning);
    assert.equal(requests.length, responses.length);
    assert.equal(usage.calls.length, responses.length);
  }
});

test('makes at most two targeted repair attempts and surfaces issues that remain', async () => {
  const issues = [{ slide: 2, message: '消除重复表述。' }];
  const replacement = { replacements: [{ page: 2, slide: sampleDeck.slides[1] }] };
  const responses = [
    success(plan), success(sampleDeck), success({ issues }), success(replacement),
    success({ issues }), success(replacement), success({ issues }),
  ];
  const { anna, requests } = mockAnna((_, index) => responses[index]);
  const { review } = await generateDeck(anna, sampleBrief);
  assert.equal(requests.length, 7);
  assert.deepEqual(review, { issues });
});

test('invalid briefs are rejected before calling Anna', async () => {
  const { anna, requests } = mockAnna(() => success(sampleDeck));
  await assert.rejects(generateDeck(anna, { ...sampleBrief, topic: '   ' }), { code: 'validation' });
  await assert.rejects(generateDeck(anna, { ...sampleBrief, count: 9 }), { code: 'validation' });
  await assert.rejects(generateDeck(anna, { ...sampleBrief, source: '字'.repeat(FIELD_LIMITS.source + 1) }), { code: 'validation' });
  assert.equal(requests.length, 0);
});

test('stops on truncation and content filtering, and retries malformed drafts only once', async () => {
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
    const { anna, requests } = mockAnna((_, index) => index === 0 ? success(plan) : reply);
    await assert.rejects(generateDeck(anna, sampleBrief), { code });
    assert.equal(requests.length, code === 'invalid_output' ? 3 : 2);
  }
});

test('retries a comparison with an invalid item count and gives the writer the precise format issue', async () => {
  const deckWithComparison = structuredClone(sampleDeck);
  deckWithComparison.slides[2].layout = 'comparison';
  const comparisonPlan = structuredClone(plan);
  comparisonPlan.slides[2].layout = 'comparison';
  const broken = structuredClone(deckWithComparison);
  broken.slides[2].items.push({ heading: '第三项', body: '需要移到讲稿。' });
  const responses = [success(comparisonPlan), success(broken), success(deckWithComparison), success({ issues: [] })];
  const { anna, requests } = mockAnna((_, index) => responses[index]);
  const { deck, usage } = await generateDeck(anna, sampleBrief);
  assert.deepEqual(deck.slides, deckWithComparison.slides);
  assert.match(JSON.parse(requests[2].messages[0].content.text).formatFeedback, /对比所含的要点数量无效/);
  assert.deepEqual(usage.calls.map(({ stage }) => stage), ['plan', 'write', 'write', 'review']);
});

test('rejects evidence references that were never in the supplied material', async () => {
  const invalid = structuredClone(plan);
  invalid.slides[1].sourceIds = [999];
  const { anna, requests } = mockAnna(() => success(invalid));
  await assert.rejects(generateDeck(anna, sampleBrief), { code: 'invalid_output' });
  assert.equal(requests.length, 1);
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
  const items = draft.slides[2].items;
  items.push({ heading: '第三项', body: '模拟数据' }, { heading: '超出的要点', body: '模拟数据' });
  assert.throws(() => validateDeck(draft), { code: 'validation' });
  items.pop();
  items[0].body = '字'.repeat(FIELD_LIMITS.body + 1);
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
