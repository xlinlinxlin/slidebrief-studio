import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { createPptxBlob, fileName, findReadabilityIssues, THEMES } from '../src/deck.js';

const item = { heading: '明确责任人', body: '确定全流程负责人，按周记录进度。' };
const layouts = ['cover', 'points', 'comparison', 'roadmap', 'metrics', 'closing'];
const metrics = [
  { heading: '42 / 50', body: '试点盘点完成数（实测）' },
  { heading: '≤3%', body: '差错率目标（待验证）' },
  { heading: '5%', body: '试点差错率（实测）' },
];
const deck = {
  title: '阶段回顾与下一步',
  visualSubject: 'operations',
  slides: layouts.map((layout, index) => ({
    layout,
    title: index === 0 ? '质量 & 进度 <2026>' : `试点计划 ${index + 1}`,
    subtitle: '把反馈转化为改进计划',
    items: layout === 'metrics' ? metrics
      : Array.from({ length: layout === 'cover' ? 0 : layout === 'comparison' ? 2 : 4 }, () => item),
    notes: '先陈述目标，再解释节奏。 Q&A',
  })),
};

test('writes editable wide PowerPoint slides, notes, and the selected theme', async () => {
  const blob = await createPptxBlob(deck, 'midnight');
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const pptx = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = (path) => pptx.file(path).async('string');
  const metadata = await xml('ppt/presentation.xml');
  assert.match(metadata, /<p:sldSz cx="12192000" cy="6858000"/);
  assert.match(await xml('docProps/core.xml'), /阶段回顾与下一步/u);
  for (const [index, slide] of deck.slides.entries()) {
    const page = await xml(`ppt/slides/slide${index + 1}.xml`);
    assert.match(page, /<a:prstGeom prst="rect">/);
    assert.match(page, /<p:cNvSpPr txBox="1"\s*\/>/);
    assert.match(page, /<a:t>把反馈转化为改进计划<\/a:t>/u);
    if (slide.layout === 'metrics') {
      for (const { heading, body } of metrics) {
        const valueBox = textBox(page, heading);
        assert.ok(valueBox.size > textBox(page, body).size, 'metric value should lead its description');
      }
    } else {
      assert.equal((page.match(/<a:t>明确责任人<\/a:t>/gu) ?? []).length, slide.items.length);
    }
    const notes = await xml(`ppt/notesSlides/notesSlide${index + 1}.xml`);
    assert.match(notes, /先陈述目标，再解释节奏。 Q&amp;A/u);
    if (slide.layout === 'cover') {
      assert.match(page, /<p:pic\b/);
      assert.match(notes, /Pexels/u);
    } else {
      assert.doesNotMatch(page, /<p:pic\b/);
    }
  }
  const cover = await xml('ppt/slides/slide1.xml');
  assert.match(cover, /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="11192C"/);
  assert.match(cover, /质量 &amp; 进度 &lt;2026&gt;/u);
  const roadmap = await xml('ppt/slides/slide4.xml');
  assert.match(roadmap, /<a:t>04<\/a:t>/);
  assert.match(roadmap, /<a:prstGeom prst="ellipse">/);
  assert.equal(Object.keys(pptx.files).filter((name) => /^ppt\/media\/[^/]+\.jpe?g$/iu.test(name)).length, 1);
});

function textBox(page, value) {
  const shape = page.match(/<p:sp>[\s\S]*?<\/p:sp>/gu)
    ?.find((candidate) => candidate.includes(`<a:t>${value}</a:t>`));
  assert.ok(shape, `editable text box is missing ${value}`);
  assert.match(shape, /<p:cNvSpPr txBox="1"\s*\/>/u);
  const [, x, y] = shape.match(/<a:off x="(\d+)" y="(\d+)"/u);
  return { x: Number(x), y: Number(y), size: Number(shape.match(/<a:rPr\b[^>]*\bsz="(\d+)"/u)[1]) };
}

test('promotes roadmap weeks, the primary point, and the closing decision', async () => {
  const roadmap = deck.slides.find((slide) => slide.layout === 'roadmap');
  const points = ['关键结论', '原因一', '原因二'].map((heading) => ({ ...item, heading }));
  const decisions = ['批准小范围试点', '确定负责人', '约定复盘时间', '确认指标'].map((heading) => ({ ...item, heading }));
  const longBody = '现场抽样显示当前流程仍有手工录入和等待复核两个阶段，试点期间需要分开记录处理耗时，周会统一复核异常原因，并在复盘时核对两组记录。';
  decisions[3].body = longBody;
  const slides = [
    { ...deck.slides[1], items: points },
    { ...roadmap, items: ['第 1 周：采集数据', '第 2–3 周 · 跟踪使用', 'Week 4: Review']
      .map((heading) => ({ ...item, heading })) },
    { ...deck.slides.at(-1), items: decisions },
  ];
  const pptx = await JSZip.loadAsync(await (await createPptxBlob({ ...deck, slides }, 'editorial')).arrayBuffer());
  const pointPage = await pptx.file('ppt/slides/slide1.xml').async('string');
  const [lead, firstReason, secondReason] = points.map(({ heading }) => textBox(pointPage, heading));
  assert.ok(lead.x < firstReason.x && lead.size > firstReason.size);
  assert.equal(firstReason.x, secondReason.x);
  assert.ok(firstReason.y < secondReason.y);

  const roadmapPage = await pptx.file('ppt/slides/slide2.xml').async('string');
  for (const [label, activity] of [['第 1 周', '采集数据'], ['第 2–3 周', '跟踪使用'], ['Week 4', 'Review']]) {
    assert.ok(textBox(roadmapPage, label).y < textBox(roadmapPage, activity).y);
  }
  assert.doesNotMatch(roadmapPage, /<a:t>0[123]<\/a:t>/u);

  const closingPage = await pptx.file('ppt/slides/slide3.xml').async('string');
  const decision = textBox(closingPage, decisions[0].heading);
  for (const { heading } of decisions.slice(1)) {
    const followUp = textBox(closingPage, heading);
    assert.ok(decision.y < followUp.y && decision.size > followUp.size);
  }
  assert.ok(textBox(closingPage, longBody).size >= 1600);
});

test('uses native chart bars only for explicit matching numeric units or part-to-whole measures', async () => {
  const slide = deck.slides.find(({ layout }) => layout === 'metrics');
  const samples = [
    { heading: '42 / 50', body: '试点盘点完成数（实测）' },
    { heading: '8% → 5%', body: '相同口径的差错率变化（实测）' },
    { heading: '3万元/月', body: '订阅合同报价' },
  ];
  const version = { ...deck, slides: [{ ...slide, items: samples }] };
  const pptx = await JSZip.loadAsync(await (await createPptxBlob(version, 'sage')).arrayBuffer());
  const page = await pptx.file('ppt/slides/slide1.xml').async('string');
  const bars = [...page.matchAll(/<a:off x="(\d+)" y="\d+"\/><a:ext cx="(\d+)" cy="118872"\/>/gu)]
    .map(([, x, w]) => [Number(x), Number(w)]);
  const barGroups = Map.groupBy(bars, ([x]) => x);
  assert.equal(barGroups.size, 2);
  const [partToWhole, beforeAfter] = [...barGroups.values()].map((group) => group.map(([, w]) => w));
  assert.equal(partToWhole.length, 2);
  assert.equal(beforeAfter.length, 4);
  assert.ok(Math.abs(partToWhole[1] / partToWhole[0] - 42 / 50) < 0.0001);
  assert.ok(Math.abs(beforeAfter[3] / beforeAfter[2] - 5 / 8) < 0.0001);
});

test('fits the cover title and charts only a matched observed and target percentage', async () => {
  const title = '自助退款入口试点进展汇报';
  const cover = { ...deck.slides[0], title };
  const metricsPage = deck.slides.find(({ layout }) => layout === 'metrics');
  const observed = { heading: '18%', body: '试点组自助完成率，已观测' };
  const target = { heading: '25%', body: '自助完成率后续目标，尚未达成' };
  const slides = [
    cover,
    { ...metricsPage, items: [observed, target] },
    { ...metricsPage, items: [observed, { ...target, body: '满意度后续目标，尚未达成' }] },
  ];
  const version = { ...deck, slides };
  const pptx = await JSZip.loadAsync(await (await createPptxBlob(version, 'editorial')).arrayBuffer());
  const coverPage = await pptx.file('ppt/slides/slide1.xml').async('string');
  assert.ok(textBox(coverPage, title).size >= 3500 && textBox(coverPage, title).size < 4200);

  const matched = await pptx.file('ppt/slides/slide2.xml').async('string');
  assert.equal((matched.match(/<a:t>100%<\/a:t>/gu) ?? []).length, 2);
  const bars = [...matched.matchAll(/<a:ext cx="(\d+)" cy="118872"\/>/gu)].map(([, w]) => Number(w));
  assert.equal(bars.length, 4);
  assert.equal(bars[0], bars[2]);
  assert.ok(Math.abs(bars[1] / bars[0] - 0.18) < 0.0001);
  assert.ok(Math.abs(bars[3] / bars[2] - 0.25) < 0.0001);
  const unmatched = await pptx.file('ppt/slides/slide3.xml').async('string');
  assert.doesNotMatch(unmatched, /<a:t>100%<\/a:t>|cy="118872"/u);
});

test('reports overly dense text once per slide and ignores the small footer', () => {
  assert.deepEqual(findReadabilityIssues(deck), []);
  const denseItem = {
    heading: '盘点记录和试点基线调整原因及相关处理方法',
    body: '试点期间需要分开记录处理耗时。'.repeat(5).slice(0, 72),
  };
  const denseClosing = {
    ...deck.slides.at(-1),
    title: '汇报试点结果并说明后续改进口径与待验证事项'.repeat(2),
    subtitle: '说明试点背景、当前限制、样本情况及处理方式，以便确认下一轮复核范围。'.repeat(2),
    items: Array(4).fill(denseItem),
  };
  const issues = findReadabilityIssues({ ...deck, slides: [deck.slides[0], denseClosing] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].slide, 2);
  assert.match(issues[0].message, /文字过密/u);
});

test('covers theme metadata and cross-platform filenames', async () => {
  assert.deepEqual(Object.keys(THEMES), ['editorial', 'midnight', 'sage']);
  for (const theme of Object.values(THEMES)) {
    assert.equal(theme.swatches.length, 3);
    assert.ok(theme.swatches.every((swatch) => /^#[0-9A-F]{6}$/.test(swatch)));
  }
  assert.equal(fileName({ title: ' 策划/草案:一 ' }), '策划-草案-一.pptx');
  assert.equal(fileName({ title: '..' }), 'Slidebrief.pptx');
  assert.equal(fileName({ title: 'NUL' }), 'Slides - NUL.pptx');
  await assert.rejects(createPptxBlob({ title: 'Empty', slides: [] }), /no slides/);
});
