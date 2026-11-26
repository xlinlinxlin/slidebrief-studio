import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { createPptxBlob, fileName, THEMES } from '../src/deck.js';

const item = { heading: '明确责任人', body: '确定全流程负责人，按周记录进度。' };
const layouts = ['cover', 'points', 'comparison', 'roadmap', 'closing'];
const deck = {
  title: '阶段回顾与下一步',
  slides: layouts.map((layout, index) => ({
    layout,
    title: index === 0 ? '质量 & 进度 <2026>' : `试点计划 ${index + 1}`,
    subtitle: '把反馈转化为改进计划',
    items: Array.from({ length: index === 0 ? 0 : index === 2 ? 2 : 4 }, () => item),
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
    assert.equal((page.match(/<a:t>明确责任人<\/a:t>/gu) ?? []).length, slide.items.length);
    assert.doesNotMatch(page, /<p:pic\b/);
    const notes = await xml(`ppt/notesSlides/notesSlide${index + 1}.xml`);
    assert.match(notes, /先陈述目标，再解释节奏。 Q&amp;A/u);
  }
  const cover = await xml('ppt/slides/slide1.xml');
  assert.match(cover, /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="11192C"/);
  assert.match(cover, /质量 &amp; 进度 &lt;2026&gt;/u);
  assert.match(await xml('ppt/slides/slide4.xml'), /<a:t>04<\/a:t>/);
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
