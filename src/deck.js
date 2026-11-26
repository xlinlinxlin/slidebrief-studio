import { coverImageCredit, resolveCoverImage } from './visuals.js';

const WIDTH = 40 / 3;
const HEIGHT = 7.5;
const FOOTER_TOP = 6.78;
const MIN_CONTENT_FONT = 16;
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const THEMES = {
  editorial: {
    name: 'Editorial', swatches: ['#F8F7F2', '#192923', '#BCEA9D'],
    background: '#F8F7F2', ink: '#172620', muted: '#4F6259', line: '#C5D1C7',
    accent: '#255842', panel: '#E3EDE6', alternate: '#EFF0E7', cover: '#192923', coverInk: '#F8F7F2',
    coverMuted: '#C6D6CA', coverAccent: '#BCEA9D', pattern: '#314B3F', secondary: '#82A38D',
  },
  midnight: {
    name: 'Midnight', swatches: ['#192236', '#ADBCFF', '#F0F3FF'],
    background: '#192236', ink: '#F0F3FF', muted: '#C1CBE3', line: '#465671',
    accent: '#AFC4FF', panel: '#263550', alternate: '#202A42', cover: '#11192C', coverInk: '#F0F3FF',
    coverMuted: '#C1CBE3', coverAccent: '#AFC4FF', pattern: '#293A5D', secondary: '#72D1C0',
  },
  sage: {
    name: 'Sage', swatches: ['#EEF1E5', '#293D2B', '#E9D198'],
    background: '#EEF1E5', ink: '#243B2B', muted: '#4D6051', line: '#BDCDBB',
    accent: '#446448', panel: '#DDE7D5', alternate: '#ECE9D8', cover: '#293D2B', coverInk: '#FCF8EB',
    coverMuted: '#D6E4CF', coverAccent: '#E9D198', pattern: '#415A43', secondary: '#B9975A',
  },
};

const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;
const emoji = /\p{Extended_Pictographic}/u;
const byGlyph = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const coverWords = new Intl.Segmenter('zh', { granularity: 'word' });
const space = /\s/u;
const chineseWeek = /^第\s*[0-9０-９一二三四五六七八九十]+(?:(?:\s*周)?\s*[-–—~～至到]\s*(?:第\s*)?[0-9０-９一二三四五六七八九十]+)?\s*周/u;
const englishWeek = /^weeks?\s+\d+(?:\s*(?:[-–—]|to)\s*(?:week\s+)?\d+)?\b/iu;

function metricBars({ heading, body }) {
  const value = plainText(heading);
  const percentChange = value.match(/^([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:→|->)\s*([0-9]+(?:\.[0-9]+)?)\s*%$/u);
  if (percentChange) {
    const values = percentChange.slice(1).map(Number);
    const max = Math.max(...values);
    if (max > 0 && Number.isFinite(max)) return values.map((value) => value / max);
  }
  const partWhole = value.match(/^(\d+)\s*\/\s*(\d+)$/u);
  if (partWhole && /完成|通过|覆盖|盘点|合格|占比|complet|progress|pass|cover/iu.test(body)) {
    const [part, whole] = partWhole.slice(1).map(Number);
    if (Number.isFinite(whole) && whole > 0 && part <= whole) return [part / whole];
  }
  return [];
}

function actualAndTargetBars(items) {
  if (items.length !== 2) return [];
  const pair = items.map((item) => {
    const value = plainText(item.heading).match(/^(\d+(?:\.\d+)?)\s*%$/u)?.[1];
    const description = plainText(item.body);
    const actual = /已观测|实测|实际值|\b(?:actual|observed)\b/iu.test(description);
    const target = /目标|\btarget\b/iu.test(description);
    const label = description.split(/[，,；;。]/u)[0].trim()
      .replace(/^(?:试点组|试点|当前|实际|后续|pilot\s+group\s+|pilot\s+|actual\s+|target\s+)/iu, '')
      .replace(/(?:后续目标|当前实测|实际值|目标|实测|\s+(?:actual|observed|target))$/iu, '')
      .trim().toLowerCase();
    return { fraction: Number(value) / 100, actual, target, label };
  });
  const [first, second] = pair;
  if (first.label.length < 3 || first.label !== second.label) return [];
  if (first.actual === first.target || second.actual === second.target || first.actual === second.actual) return [];
  if (pair.some(({ fraction }) => !Number.isFinite(fraction) || fraction > 1)) return [];
  return pair.map(({ fraction }) => fraction);
}

// Limit text to XML 1.0 characters before writing user input to the package.
function plainText(value) {
  return String(value ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/\r\n?/g, '\n').trim();
}

function glyphWidth(glyph) {
  if (space.test(glyph)) return 0.28;
  if (eastAsian.test(glyph)) return 1;
  if (emoji.test(glyph)) return 1.1;
  if (/[MW@%mw&]/u.test(glyph)) return 0.9;
  if (/[ilIjt1.,'`:|!]/u.test(glyph)) return 0.35;
  if (/[A-Z0-9]/u.test(glyph)) return 0.68;
  return 0.57;
}

function coverTitle(value, width) {
  const title = plainText(value);
  const glyphs = [...byGlyph.segment(title)].map(({ segment }) => segment);
  const preferred = 42;
  if (title.includes('\n') || glyphs.filter((glyph) => eastAsian.test(glyph)).length < glyphs.length * 0.6) {
    return { title, size: preferred };
  }
  const measure = (text) => [...byGlyph.segment(text)]
    .reduce((sum, { segment }) => sum + glyphWidth(segment), 0);
  const oneLineSize = Math.floor((width * 69 / measure(title)) * 2) / 2;
  if (oneLineSize >= 35) return { title, size: Math.min(preferred, oneLineSize) };
  const capacity = width * 69 / preferred;
  const candidates = [...coverWords.segment(title)].slice(1)
    .map(({ index }) => [title.slice(0, index), title.slice(index)])
    .filter(([, right]) => !/^[\s，。？！：；、）】》]/u.test(right))
    .map(([left, right]) => ({ left, right, a: measure(left), b: measure(right) }))
    .filter(({ a, b }) => Math.max(a, b) <= capacity && Math.min(a, b) >= capacity * 0.35)
    .sort((a, b) => Math.abs(a.a - a.b) - Math.abs(b.a - b.b));
  if (candidates.length > 0) {
    const [{ left, right }] = candidates;
    return { title: `${left}\n${right}`, size: preferred };
  }
  return { title, size: preferred };
}

function estimatedLines(text, capacity) {
  return text.split('\n').reduce((lineCount, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      const widths = [...byGlyph.segment(word)].map(({ segment }) => glyphWidth(segment));
      const wordWidth = widths.reduce((sum, width) => sum + width, 0);
      if (used + wordWidth <= capacity) {
        used += wordWidth;
      } else if (wordWidth <= capacity && used > 0) {
        lines += 1;
        used = wordWidth;
      } else {
        for (const width of widths) {
          if (used > 0 && used + width > capacity) {
            lines += 1;
            used = 0;
          }
          used += width;
        }
      }
    }
    return lineCount + lines;
  }, 0);
}

function textHeight(value, width, size, lineHeight) {
  // Leave space for the Office font metrics above and below the glyphs.
  return estimatedLines(value, (width * 71) / size) * size * lineHeight / 61;
}

function fitText(value, width, height, preferredSize, lineHeight) {
  let size = preferredSize;
  while (size > 7 && textHeight(value, width, size, lineHeight) > height) {
    size -= 0.5;
  }
  return size;
}

function makeScene(slide, { theme = 'editorial', index = 0, total = 1, deckTitle = '', visualSubject } = {}) {
  const palette = THEMES[theme] ?? THEMES.editorial;
  const shapes = [];
  const rect = (x, y, w, h, color) => shapes.push({ type: 'rect', x, y, w, h, color });
  const ellipse = (x, y, w, h, color) => shapes.push({ type: 'ellipse', x, y, w, h, color });
  const text = (value, x, y, w, h, options) => {
    let content = plainText(value);
    if (!content) return 0;
    const { size, color, bold = false, align = 'left', lineHeight = 1.16 } = options;
    let fitted = fitText(content, w, h, size, lineHeight);
    if (fitted < MIN_CONTENT_FONT && content.includes('\n')) {
      const condensed = content.replace(/\s*\n\s*/gu, ' ');
      const condensedSize = fitText(condensed, w, h, size, lineHeight);
      if (condensedSize > fitted) {
        content = condensed;
        fitted = condensedSize;
      }
    }
    const textHeightInInches = textHeight(content, w, fitted, lineHeight);
    shapes.push({
      type: 'text', value: content, x, y, w, h, color, bold, align, lineHeight,
      size: fitted, textHeight: textHeightInInches, cjk: eastAsian.test(content),
    });
    return textHeightInInches;
  };
  const dark = slide.layout === 'cover' || slide.layout === 'closing';
  const ink = dark ? palette.coverInk : palette.ink;
  const muted = dark ? palette.coverMuted : palette.muted;
  const accent = dark ? palette.coverAccent : palette.accent;
  const itemBlock = (item, x, y, w, h, featured = false) => {
    const pad = featured ? 0.32 : 0.16;
    const headingY = y + (featured ? 0.52 : 0.17);
    if (featured) rect(x, y, w, h, palette.panel);
    else if (!dark && theme === 'midnight') rect(x, y, w, h, palette.alternate);
    else rect(x, y, w, 0.023, dark ? palette.pattern : palette.line);
    if (featured) rect(x, y, 0.06, h, accent);
    else if (theme === 'sage') ellipse(x, headingY + 0.13, 0.08, 0.08, palette.secondary);
    else rect(x, headingY, 0.042, 0.29, accent);
    const headingHeight = text(item.heading, x + pad, headingY, w - 2 * pad, featured ? 1.16 : 0.66,
      { size: featured ? 30 : 21, color: ink, bold: true, lineHeight: 1.08 });
    const bodyY = headingY + headingHeight + 0.14;
    text(item.body, x + pad, bodyY, w - 2 * pad, y + h - bodyY - (featured ? 0.26 : 0.05),
      { size: featured ? 22 : 19, color: muted, lineHeight: 1.12 });
  };

  if (slide.layout === 'cover') {
    const source = resolveCoverImage(visualSubject);
    const imageX = 7.79;
    if (theme === 'midnight') rect(7.53, 0, WIDTH - 7.53, HEIGHT, palette.pattern);
    if (theme === 'sage') rect(7.56, 0.84, 5.04, 6.30, palette.secondary);
    if (theme === 'editorial') rect(7.58, 0.43, 5.02, 6.28, palette.coverMuted);
    if (source) {
      shapes.push({
        type: 'image', x: imageX, y: 0.61, w: 5.0, h: 6.25, source, credit: coverImageCredit(visualSubject),
      });
    } else {
      rect(imageX, 0.61, 5.0, 6.25, palette.pattern);
      if (theme === 'sage') {
        ellipse(8.58, 1.20, 3.66, 3.66, palette.accent);
        ellipse(9.10, 1.72, 2.62, 2.62, accent);
        ellipse(9.61, 2.23, 1.60, 1.60, palette.pattern);
        rect(8.65, 5.10, 3.38, 0.045, palette.coverMuted);
        rect(8.65, 5.49, 2.64, 0.045, palette.coverMuted);
      } else if (theme === 'midnight') {
        rect(8.42, 1.25, 3.73, 4.99, palette.cover);
        rect(8.76, 1.68, 2.92, 0.23, accent);
        rect(8.76, 2.37, 1.10, 2.00, palette.secondary);
        rect(10.08, 2.37, 1.60, 2.00, palette.pattern);
        rect(8.76, 4.77, 2.92, 0.07, palette.coverMuted);
        rect(8.76, 5.15, 2.42, 0.07, palette.coverMuted);
      } else {
        rect(8.55, 1.33, 3.54, 4.84, palette.coverMuted);
        rect(8.74, 1.54, 3.54, 4.84, palette.cover);
        rect(9.05, 1.93, 2.90, 1.42, accent);
        rect(9.05, 3.79, 1.16, 1.53, palette.pattern);
        rect(10.40, 3.79, 1.55, 0.09, palette.coverMuted);
        rect(10.40, 4.16, 1.55, 0.09, palette.coverMuted);
        rect(10.40, 4.53, 1.10, 0.09, palette.coverMuted);
      }
    }
    rect(0.78, 2.02, 0.82, 0.08, accent);
    const titleWidth = 6.88;
    const display = coverTitle(slide.title || deckTitle, titleWidth);
    const titleHeight = text(display.title, 0.76, 2.43, titleWidth, 2.07,
      { size: display.size, color: ink, bold: true, lineHeight: 1.05 });
    text(slide.subtitle, 0.8, 2.64 + titleHeight, 6.75, 1.32, { size: 22, color: muted });
    rect(0.78, 6.62, 6.4, 0.016, palette.pattern);
    return { background: palette.cover, shapes };
  }

  const items = Array.isArray(slide.items) ? slide.items.slice(0, 4) : [];
  const hasSubtitle = Boolean(plainText(slide.subtitle));
  if (theme === 'midnight') rect(0, 0, WIDTH, 0.08, accent);
  else if (theme === 'sage') ellipse(0.78, 0.56, 0.17, 0.17, palette.secondary);
  else rect(0.78, 0.61, 0.57, 0.055, accent);
  const titleHeight = text(slide.title, 0.77, 0.79, 11.68, hasSubtitle ? 1.04 : 1.28,
    { size: 36, color: ink, bold: true, lineHeight: 1.07 });
  const subtitleY = 0.94 + titleHeight;
  const subtitleHeight = text(slide.subtitle, 0.8, subtitleY, 11.73, 0.72, { size: 18, color: muted });
  const contentTop = Math.max(hasSubtitle ? 2.32 : 1.95, subtitleY + subtitleHeight + 0.33);
  const contentHeight = 6.55 - contentTop;

  if (slide.layout === 'metrics') {
    const gap = 0.28;
    const width = (11.77 - (items.length - 1) * gap) / Math.max(items.length, 1);
    const pair = actualAndTargetBars(items);
    const graphs = items.map((item, index) => pair.length ? [pair[index]] : metricBars(item));
    const pad = 0.29;
    const usableWidth = width - 2 * pad;
    const cardHeight = Math.min(contentHeight, Math.max(2.72, ...items.map((item, index) =>
      textHeight(plainText(item.body), usableWidth, 20, 1.12) + (graphs[index].length ? 2.67 : 1.93))));
    const cardTop = contentTop + Math.min(0.42, (contentHeight - cardHeight) * 0.35);
    items.forEach((item, index) => {
      const x = 0.78 + index * (width + gap);
      const graph = graphs[index];
      rect(x, cardTop, width, cardHeight, index % 2 ? palette.alternate : palette.panel);
      rect(x, cardTop, width, 0.08, index % 2 ? palette.secondary : accent);
      text(item.heading, x + pad, cardTop + 0.34, usableWidth, 1.04,
        { size: 46, color: accent, bold: true, lineHeight: 1.04 });
      rect(x + pad, cardTop + 1.40, usableWidth, 0.019, palette.line);
      text(item.body, x + pad, cardTop + 1.57, usableWidth, cardHeight - (graph.length ? 2.42 : 1.79),
        { size: 21, color: ink, lineHeight: 1.12 });
      graph.forEach((fraction, graphIndex) => {
        const y = cardTop + cardHeight - 0.61 + graphIndex * 0.25;
        rect(x + pad, y, usableWidth, 0.13, palette.line);
        if (fraction > 0) rect(x + pad, y, usableWidth * fraction, 0.13,
          (pair.length ? index : graphIndex) ? palette.secondary : accent);
      });
      if (pair.length) {
        text('0%', x + pad, cardTop + cardHeight - 0.40, 0.8, 0.31, { size: 16, color: muted, lineHeight: 1.04 });
        text('100%', x + width - pad - 0.8, cardTop + cardHeight - 0.40, 0.8, 0.31,
          { size: 16, color: muted, lineHeight: 1.04, align: 'right' });
      }
    });
  } else if (slide.layout === 'roadmap') {
    const columnWidth = 11.77 / Math.max(items.length, 1);
    rect(0.87, contentTop + 0.72, 11.47, 0.041, palette.line);
    items.forEach((item, itemIndex) => {
      const x = 0.78 + itemIndex * columnWidth;
      const width = columnWidth - 0.34;
      const heading = plainText(item.heading);
      const week = heading.match(chineseWeek)?.[0] ?? heading.match(englishWeek)?.[0];
      const label = week ?? String(itemIndex + 1).padStart(2, '0');
      const activity = week ? heading.slice(week.length).replace(/^[\s:：·–—-]+/u, '') : heading;
      const labelWidth = Math.min(width, 2.36);
      rect(x, contentTop, labelWidth, 0.48, palette.panel);
      text(label, x + 0.09, contentTop + 0.055, labelWidth - 0.18, 0.38,
        { size: week ? 19 : 21, color: accent, bold: true, lineHeight: 1.04 });
      ellipse(x, contentTop + 0.64, 0.20, 0.20, accent);
      ellipse(x + 0.054, contentTop + 0.694, 0.092, 0.092, palette.background);
      const bodyTop = contentTop + 1.02;
      rect(x, bodyTop, columnWidth - 0.17, contentHeight - 1.02, itemIndex % 2 ? palette.alternate : palette.panel);
      const headingHeight = text(activity, x + 0.09, bodyTop + 0.13, width, 0.74,
        { size: 21, color: ink, bold: true, lineHeight: 1.1 });
      const bodyY = bodyTop + 0.26 + headingHeight;
      text(item.body, x + 0.09, bodyY, width, contentTop + contentHeight - bodyY - 0.17,
        { size: 19, color: muted, lineHeight: 1.12 });
    });
  } else if (slide.layout === 'comparison' && items.length === 2) {
    const cardHeight = Math.min(contentHeight, Math.max(2.63, ...items.map((item) =>
      textHeight(plainText(item.body), 5.16, 21, 1.14) + 1.88)));
    const cardTop = contentTop + Math.min(0.42, (contentHeight - cardHeight) * 0.35);
    items.forEach((item, itemIndex) => {
      const x = 0.78 + itemIndex * 6.03;
      rect(x, cardTop, 5.73, cardHeight, itemIndex === 0 ? palette.panel : palette.alternate);
      rect(x, cardTop, 5.73, 0.08, itemIndex === 0 ? accent : palette.secondary);
      const headingY = cardTop + 0.33;
      const headingHeight = text(item.heading, x + 0.26, headingY, 5.16, 1.11,
        { size: 28, color: ink, bold: true, lineHeight: 1.08 });
      const dividerY = headingY + Math.max(headingHeight, 0.63) + 0.12;
      rect(x + 0.26, dividerY, 5.16, 0.024, palette.line);
      const bodyY = dividerY + 0.24;
      text(item.body, x + 0.26, bodyY, 5.16, cardTop + cardHeight - bodyY - 0.28,
        { size: 21, color: muted, lineHeight: 1.14 });
    });
  } else if (slide.layout === 'closing' && items.length > 0) {
    const [decision, ...followUps] = items;
    const gap = 0.4;
    const width = (11.77 - (followUps.length - 1) * gap) / Math.max(followUps.length, 1);
    rect(0.78, contentTop, 11.77, 1.47, palette.pattern);
    rect(0.78, contentTop, 0.08, 1.47, accent);
    text(decision.heading, 1.12, contentTop + 0.29, 4.18, 0.91,
      { size: 29, color: accent, bold: true, lineHeight: 1.08 });
    rect(5.61, contentTop + 0.27, 0.022, 0.92, palette.coverMuted);
    text(decision.body, 5.88, contentTop + 0.26, 6.31, 0.99, { size: 22, color: ink, lineHeight: 1.12 });
    followUps.forEach((item, index) => {
      const x = 0.78 + index * (width + gap);
      itemBlock(item, x, contentTop + 1.75, width, contentHeight - 1.75);
    });
  } else if (slide.layout === 'points' && items.length === 3) {
    const rowHeight = (contentHeight - 0.26) / 2;
    itemBlock(items[0], 0.78, contentTop, 5.1, contentHeight, true);
    itemBlock(items[1], 6.35, contentTop, 6.2, rowHeight);
    itemBlock(items[2], 6.35, contentTop + rowHeight + 0.26, 6.2, rowHeight);
  } else {
    const columns = items.length === 1 ? 1 : 2;
    const rows = Math.ceil(items.length / columns);
    const gap = 0.42;
    const width = (11.77 - (columns - 1) * gap) / columns;
    const rowGap = 0.24;
    const rowHeight = (contentHeight - (rows - 1) * rowGap) / Math.max(rows, 1);
    items.forEach((item, itemIndex) => {
      const x = 0.78 + (itemIndex % columns) * (width + gap);
      const y = contentTop + Math.floor(itemIndex / columns) * (rowHeight + rowGap);
      itemBlock(item, x, y, width, rowHeight);
    });
  }

  const footerLine = dark ? palette.pattern : palette.line;
  rect(0.78, FOOTER_TOP, 11.77, 0.022, footerLine);
  text(String(index + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0'),
    11.38, 6.93, 1.17, 0.3, { size: 11, color: muted, align: 'right' });
  return { background: dark ? palette.cover : palette.background, shapes };
}

export function findReadabilityIssues(deck) {
  return deck.slides.flatMap((slide, index) => {
    const { shapes } = makeScene(slide, { index, total: deck.slides.length, deckTitle: deck.title });
    const overlyDense = shapes.some((shape) => shape.type === 'text' && shape.y < FOOTER_TOP
      && (shape.size < MIN_CONTENT_FONT || shape.textHeight > shape.h));
    return overlyDense
      ? [{ slide: index + 1, message: '文字过密。请缩短长句，保留关键事实和数字，其余细节移入演讲备注。' }]
      : [];
  });
}

export function renderSlidePreview(container, slide, options) {
  const scene = makeScene(slide, options);
  const canvas = document.createElement('div');
  canvas.className = 'slide-preview-art';
  Object.assign(canvas.style, {
    position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden',
    containerType: 'inline-size', backgroundColor: scene.background,
  });
  for (const shape of scene.shapes) {
    const element = document.createElement(shape.type === 'image' ? 'img' : 'div');
    Object.assign(element.style, {
      position: 'absolute', left: `${shape.x / WIDTH * 100}%`, top: `${shape.y / HEIGHT * 100}%`,
      width: `${shape.w / WIDTH * 100}%`, height: `${shape.h / HEIGHT * 100}%`, overflow: 'hidden',
    });
    if (shape.type === 'image') {
      element.src = shape.source;
      element.alt = '';
      element.style.objectFit = 'cover';
    } else if (shape.type === 'text') {
      element.textContent = shape.value;
      Object.assign(element.style, {
        color: shape.color, fontWeight: shape.bold ? '700' : '400', textAlign: shape.align,
        fontFamily: shape.cjk ? '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' : 'Aptos, Inter, Arial, sans-serif',
        fontSize: `${shape.size / (72 * WIDTH) * 100}cqw`, lineHeight: String(shape.lineHeight),
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxSizing: 'border-box',
      });
    } else {
      element.style.backgroundColor = shape.color;
      if (shape.type === 'ellipse') element.style.borderRadius = '50%';
      element.setAttribute('aria-hidden', 'true');
    }
    canvas.append(element);
  }
  container.replaceChildren(canvas);
}

export function fileName(deck) {
  const base = plainText(deck?.title).replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-').trim();
  const shortened = Array.from(base).slice(0, 70).join('').replace(/^[.\s]+|[.\s]+$/gu, '');
  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu;
  return `${reserved.test(shortened) ? `Slides - ${shortened}` : shortened || 'Slidebrief'}.pptx`;
}

export async function createPptxBlob(deck, theme) {
  if (!Array.isArray(deck?.slides) || !deck.slides.length) throw new Error('The presentation has no slides.');
  const { default: PptxGenJS } = await import('pptxgenjs');
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.title = plainText(deck.title);
  presentation.author = 'Slidebrief';
  presentation.theme = { headFontFace: 'Aptos', bodyFontFace: 'Aptos' };

  deck.slides.forEach((slide, index) => {
    const page = presentation.addSlide();
    const scene = makeScene(slide, {
      theme, index, total: deck.slides.length, deckTitle: deck.title, visualSubject: deck.visualSubject,
    });
    page.background = { color: scene.background.slice(1) };
    for (const shape of scene.shapes) {
      const { x, y, w, h } = shape;
      if (shape.type === 'image') {
        page.addImage({ data: shape.source, altText: '封面配图', x, y, w, h });
      } else if (shape.type === 'text') {
        page.addText(shape.value, {
          x, y, w, h, color: shape.color.slice(1), margin: 0, align: shape.align, valign: 'top', wrap: true,
          bold: shape.bold, fontSize: shape.size, fit: 'shrink', lineSpacing: shape.size * shape.lineHeight,
          fontFace: shape.cjk ? 'Microsoft YaHei' : 'Aptos', lang: shape.cjk ? 'zh-CN' : 'en-US',
          isTextBox: true,
        });
      } else {
        page.addShape(presentation.ShapeType[shape.type],
          { x, y, w, h, fill: { color: shape.color.slice(1) }, line: { transparency: 100 } });
      }
    }
    const imageCredit = scene.shapes.find((shape) => shape.type === 'image')?.credit;
    const notes = [plainText(slide.notes), imageCredit].filter(Boolean).join('\n');
    if (notes) page.addNotes(notes);
  });

  const bytes = await presentation.write({ outputType: 'arraybuffer', compression: true });
  return new Blob([bytes], { type: PPTX_MIME });
}
