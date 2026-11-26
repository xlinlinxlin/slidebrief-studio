const WIDTH = 40 / 3;
const HEIGHT = 7.5;
const FOOTER_TOP = 6.78;
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const THEMES = {
  editorial: {
    name: 'Editorial', swatches: ['#F8F7F2', '#192923', '#BCEA9D'],
    background: '#F8F7F2', ink: '#172620', muted: '#4F6259', line: '#C5D1C7',
    accent: '#255842', panel: '#E2EBE1', cover: '#192923', coverInk: '#F8F7F2',
    coverMuted: '#C6D6CA', coverAccent: '#BCEA9D', pattern: '#314B3F',
  },
  midnight: {
    name: 'Midnight', swatches: ['#192236', '#ADBCFF', '#F0F3FF'],
    background: '#192236', ink: '#F0F3FF', muted: '#C1CBE3', line: '#465671',
    accent: '#ADBCFF', panel: '#24314C', cover: '#11192C', coverInk: '#F0F3FF',
    coverMuted: '#C1CBE3', coverAccent: '#ADBCFF', pattern: '#293A5D',
  },
  sage: {
    name: 'Sage', swatches: ['#EEF1E5', '#293D2B', '#E9D198'],
    background: '#EEF1E5', ink: '#243B2B', muted: '#4D6051', line: '#BDCDBB',
    accent: '#446448', panel: '#DAE3D2', cover: '#293D2B', coverInk: '#FCF8EB',
    coverMuted: '#D6E4CF', coverAccent: '#E9D198', pattern: '#415A43',
  },
};

const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;
const emoji = /\p{Extended_Pictographic}/u;
const byGlyph = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const space = /\s/u;
const chineseWeek = /^第\s*[0-9０-９一二三四五六七八九十]+(?:(?:\s*周)?\s*[-–—~～至到]\s*(?:第\s*)?[0-9０-９一二三四五六七八九十]+)?\s*周/u;
const englishWeek = /^weeks?\s+\d+(?:\s*(?:[-–—]|to)\s*(?:week\s+)?\d+)?\b/iu;

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

function makeScene(slide, { theme, index = 0, total = 1, deckTitle = '' } = {}) {
  const palette = THEMES[theme] ?? THEMES.editorial;
  const shapes = [];
  const rect = (x, y, w, h, color) => shapes.push({ type: 'rect', x, y, w, h, color });
  const text = (value, x, y, w, h, options) => {
    let content = plainText(value);
    if (!content) return 0;
    const { size, color, bold = false, align = 'left', lineHeight = 1.16 } = options;
    let fitted = fitText(content, w, h, size, lineHeight);
    if (fitted < 14 && content.includes('\n')) {
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
    const pad = featured ? 0.32 : 0;
    const headingY = y + (featured ? 0.52 : 0.15);
    if (featured) rect(x, y, w, h, palette.panel);
    else rect(x, y, w, 0.02, dark ? palette.pattern : palette.line);
    rect(x + pad, y + (featured ? 0.28 : 0), 0.35, 0.05, accent);
    const headingHeight = text(item.heading, x + pad, headingY, w - 2 * pad, featured ? 1.16 : 0.68,
      { size: featured ? 31 : 21, color: ink, bold: true, lineHeight: 1.1 });
    const bodyY = headingY + headingHeight + 0.14;
    text(item.body, x + pad, bodyY, w - 2 * pad, y + h - bodyY - (featured ? 0.26 : 0.05),
      { size: featured ? 21 : 18, color: muted });
  };

  if (slide.layout === 'cover') {
    rect(9.35, 0, WIDTH - 9.35, HEIGHT, palette.pattern);
    rect(10, 1.04, 2.6, 0.055, palette.coverMuted);
    rect(10, 1.04, 0.055, 5.38, palette.coverMuted);
    rect(12.545, 1.04, 0.055, 5.38, palette.coverMuted);
    rect(10, 6.365, 2.6, 0.055, palette.coverMuted);
    rect(10.26, 1.31, 1.12, 1.12, accent);
    rect(11.52, 2.56, 0.82, 2.04, palette.coverMuted);
    rect(10.26, 2.56, 1.12, 2.04, palette.cover);
    rect(10.26, 4.73, 2.08, 0.065, accent);
    rect(10.26, 4.99, 2.08, 0.065, palette.coverMuted);
    rect(10.26, 5.25, 1.48, 0.065, palette.coverMuted);
    rect(0.78, 2.01, 0.8, 0.07, accent);
    const titleHeight = text(slide.title || deckTitle, 0.76, 2.4, 8.06, 2.06,
      { size: 46, color: ink, bold: true, lineHeight: 1.07 });
    text(slide.subtitle, 0.8, 2.64 + titleHeight, 8.04, 1.33, { size: 22, color: muted });
    return { background: palette.cover, shapes };
  }

  const items = Array.isArray(slide.items) ? slide.items.slice(0, 4) : [];
  const hasSubtitle = Boolean(plainText(slide.subtitle));
  const contentTop = hasSubtitle ? 2.87 : 2.38;
  const contentHeight = 6.52 - contentTop;
  rect(0.78, 0.67, 0.51, 0.055, accent);
  const titleHeight = text(slide.title, 0.77, 0.91, 11.68, hasSubtitle ? 1.08 : 1.35,
    { size: 37, color: ink, bold: true, lineHeight: 1.1 });
  text(slide.subtitle, 0.8, 1.13 + titleHeight, 11.73, 0.64, { size: 17, color: muted });

  if (slide.layout === 'metrics') {
    const gap = 0.28;
    const width = (11.77 - (items.length - 1) * gap) / Math.max(items.length, 1);
    items.forEach((item, index) => {
      const x = 0.78 + index * (width + gap);
      rect(x, contentTop, width, contentHeight, palette.panel);
      rect(x + 0.29, contentTop + 0.28, 0.45, 0.065, accent);
      text(item.heading, x + 0.27, contentTop + 0.54, width - 0.54, 1.22,
        { size: 49, color: accent, bold: true, lineHeight: 1.04 });
      text(item.body, x + 0.3, contentTop + 1.84, width - 0.6, contentHeight - 2.15,
        { size: 20, color: ink });
    });
  } else if (slide.layout === 'roadmap') {
    const columnWidth = 11.77 / Math.max(items.length, 1);
    rect(0.78, contentTop + 0.77, 11.77, 0.045, palette.line);
    items.forEach((item, itemIndex) => {
      const x = 0.78 + itemIndex * columnWidth;
      const width = columnWidth - 0.24;
      const heading = plainText(item.heading);
      const week = heading.match(chineseWeek)?.[0] ?? heading.match(englishWeek)?.[0];
      const label = week ?? String(itemIndex + 1).padStart(2, '0');
      const activity = week ? heading.slice(week.length).replace(/^[\s:：·–—-]+/u, '') : heading;
      text(label, x, contentTop + 0.08, width, 0.59,
        { size: week ? 27 : 33, color: accent, bold: true, lineHeight: 1.05 });
      rect(x, contentTop + 0.72, 0.14, 0.14, accent);
      const headingHeight = text(activity, x, contentTop + 1.05, width, 0.74,
        { size: 21, color: ink, bold: true, lineHeight: 1.1 });
      const bodyY = contentTop + 1.19 + headingHeight;
      text(item.body, x, bodyY, width, contentTop + contentHeight - bodyY,
        { size: 18, color: muted });
    });
  } else if (slide.layout === 'comparison' && items.length === 2) {
    items.forEach((item, itemIndex) => {
      const x = 0.78 + itemIndex * 6.03;
      rect(x, contentTop + 0.12, 5.73, 3.53, itemIndex === 0 ? palette.panel : palette.background);
      rect(x, contentTop + 0.12, 5.73, 0.055, itemIndex === 0 ? accent : palette.line);
      text(item.heading, x + 0.29, contentTop + 0.46, 5.12, 0.91, { size: 26, color: ink, bold: true });
      text(item.body, x + 0.29, contentTop + 1.48, 5.12, 1.8, { size: 20, color: muted });
    });
  } else if (slide.layout === 'closing' && items.length > 0) {
    const [decision, ...followUps] = items;
    const gap = 0.4;
    const width = (11.77 - (followUps.length - 1) * gap) / Math.max(followUps.length, 1);
    rect(0.78, contentTop, 11.77, 1.31, palette.pattern);
    rect(0.78, contentTop, 0.055, 1.31, accent);
    text(decision.heading, 1.06, contentTop + 0.2, 4.35, 0.91,
      { size: 28, color: accent, bold: true, lineHeight: 1.1 });
    text(decision.body, 5.68, contentTop + 0.2, 6.55, 0.91, { size: 20, color: ink });
    followUps.forEach((item, index) => {
      const x = 0.78 + index * (width + gap);
      itemBlock(item, x, contentTop + 1.62, width, contentHeight - 1.62);
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
      && (shape.size < 14 || shape.textHeight > shape.h));
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
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'absolute', left: `${shape.x / WIDTH * 100}%`, top: `${shape.y / HEIGHT * 100}%`,
      width: `${shape.w / WIDTH * 100}%`, height: `${shape.h / HEIGHT * 100}%`, overflow: 'hidden',
    });
    if (shape.type === 'text') {
      element.textContent = shape.value;
      Object.assign(element.style, {
        color: shape.color, fontWeight: shape.bold ? '700' : '400', textAlign: shape.align,
        fontFamily: shape.cjk ? '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' : 'Aptos, Inter, Arial, sans-serif',
        fontSize: `${shape.size / (72 * WIDTH) * 100}cqw`, lineHeight: String(shape.lineHeight),
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxSizing: 'border-box',
      });
    } else {
      element.style.backgroundColor = shape.color;
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
    const scene = makeScene(slide, { theme, index, total: deck.slides.length, deckTitle: deck.title });
    page.background = { color: scene.background.slice(1) };
    for (const shape of scene.shapes) {
      const { x, y, w, h } = shape;
      const color = shape.color.slice(1);
      if (shape.type === 'rect') {
        page.addShape(presentation.ShapeType.rect, { x, y, w, h, fill: { color }, line: { transparency: 100 } });
      } else {
        page.addText(shape.value, {
          x, y, w, h, color, margin: 0, align: shape.align, valign: 'top', wrap: true,
          bold: shape.bold, fontSize: shape.size, fit: 'shrink', lineSpacing: shape.size * shape.lineHeight,
          fontFace: shape.cjk ? 'Microsoft YaHei' : 'Aptos', lang: shape.cjk ? 'zh-CN' : 'en-US',
          isTextBox: true,
        });
      }
    }
    const notes = plainText(slide.notes);
    if (notes) page.addNotes(notes);
  });

  const bytes = await presentation.write({ outputType: 'arraybuffer', compression: true });
  return new Blob([bytes], { type: PPTX_MIME });
}
