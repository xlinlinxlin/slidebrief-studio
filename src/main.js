import './style.css';
import panels from 'lucide/icons/presentation.svg?raw';
import sparkles from 'lucide/icons/sparkles.svg?raw';
import download from 'lucide/icons/download.svg?raw';
import pen from 'lucide/icons/square-pen.svg?raw';
import arrowUpRight from 'lucide/icons/arrow-up-right.svg?raw';
import backwards from 'lucide/icons/chevron-left.svg?raw';
import forwards from 'lucide/icons/chevron-right.svg?raw';
import notes from 'lucide/icons/sticky-note.svg?raw';
import reviewIcon from 'lucide/icons/clipboard-check.svg?raw';
import close from 'lucide/icons/x.svg?raw';
import plus from 'lucide/icons/plus.svg?raw';
import minus from 'lucide/icons/minus.svg?raw';
import loader from 'lucide/icons/loader-circle.svg?raw';
import { THEMES, createPptxBlob, fileName, renderSlidePreview } from './deck.js';
import {
  FIELD_LIMITS, LAYOUTS, SLIDE_COUNTS, generateDeck, rewriteSlide,
  sampleBrief, sampleDeck, validateDeck,
} from './generation.js';

const root = document.querySelector('#app');
const hostWindow = window.parent !== window && new URLSearchParams(location.search).has('wid');
const storageKey = 'slidebrief.v1';
const uiThemeNames = { editorial: '纸本', midnight: '深海', sage: '苔青' };
const blankBrief = { topic: '', audience: '', goal: '', source: '', count: 5 };
const fields = ['topic', 'audience', 'goal', 'source'];
const stageLabels = {
  plan: '正在梳理汇报主线',
  write: '正在撰写幻灯片',
  review: '正在核对事实和汇报目标',
  repair: '正在修订核对发现的问题',
};
const app = {
  brief: { ...blankBrief }, deck: structuredClone(sampleDeck), theme: 'editorial',
  origin: 'sample', index: 0, editing: false, showingNotes: false, status: null,
  busy: '', progress: '', usage: null, usageAction: '', review: null,
  connection: hostWindow ? 'connecting' : 'local',
};
let anna;
let saveTimer;
let saveQueue = Promise.resolve();

function escaped(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function button(action, icon, label, extra = '') {
  return `<button type="button" data-action="${action}" ${extra}>${icon}<span>${label}</span></button>`;
}

function iconButton(action, icon, label, extra = '') {
  return `<button class="icon-button" type="button" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon}</button>`;
}

root.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <div class="brand-icon">${panels}</div>
      <div><h1>Slidebrief</h1><span>汇报工坊</span></div>
    </div>
    <div class="top-actions">
      <span id="connection" class="connection" aria-live="polite"></span>
      ${button('export', download, '导出 PPTX', 'class="button export-button" id="export"')}
    </div>
  </header>
  <main class="workspace">
    <aside class="brief">
      <div class="brief-heading">
        <h2>汇报任务</h2>
        ${button('sample', arrowUpRight, '填入示例', 'class="text-button" id="sample"')}
      </div>
      <form id="brief-form">
        <label class="field">汇报主题 <span class="required">*</span>
          <textarea name="topic" rows="2" required maxlength="${FIELD_LIMITS.topic}" placeholder="例如：向管理层汇报客户服务改进计划"></textarea>
        </label>
        <label class="field">汇报对象
          <input name="audience" maxlength="${FIELD_LIMITS.audience}" placeholder="例如：跨部门负责人" />
        </label>
        <label class="field">希望达成的目标
          <input name="goal" maxlength="${FIELD_LIMITS.goal}" placeholder="例如：争取批准两周试点" />
        </label>
        <label class="field">参考素材
          <textarea name="source" rows="4" maxlength="${FIELD_LIMITS.source}" placeholder="粘贴事实、数据、结论或会议纪要"></textarea>
          <span class="field-counter" id="source-counter"></span>
        </label>
        <fieldset class="count-field">
          <legend>幻灯片页数</legend>
          <div class="segments">${SLIDE_COUNTS.map((count) => `
            <label><input type="radio" name="count" value="${count}"><span>${count} 页</span></label>`).join('')}</div>
        </fieldset>
        <button class="button primary" type="submit" id="generate" aria-describedby="credit-line">${sparkles}<span>生成演示文稿</span></button>
        <p id="credit-line" class="credit-line" role="status"></p>
      </form>
    </aside>
    <section class="stage" aria-label="演示文稿工作区">
      <div class="stage-heading">
        <div class="document-title">
          <div class="document-meta" id="document-meta"></div>
          <h2 id="deck-title"></h2>
        </div>
        <div class="theme-picker" aria-label="演示主题">
          ${Object.entries(THEMES).map(([id, theme]) => `
            <button type="button" data-action="theme" data-theme="${id}" title="${uiThemeNames[id]}" aria-label="${uiThemeNames[id]}主题">
              <span class="theme-swatches" data-swatch="${id}" aria-hidden="true"></span><span>${uiThemeNames[id] ?? escaped(theme.name)}</span>
            </button>`).join('')}
        </div>
      </div>
      <div id="status" class="status" aria-live="polite" hidden></div>
      <details id="review-panel" class="review-panel" hidden>
        <summary>${reviewIcon}<span id="review-title"></span>${forwards}</summary>
        <p id="review-warning" hidden></p>
        <ul id="review-issues"></ul>
      </details>
      <div class="studio" id="studio">
        <div class="canvas-area">
          <div class="canvas-frame">
            <div id="slide-preview" class="slide-preview"></div>
          </div>
          <div class="canvas-toolbar">
            <div class="pager">
              ${iconButton('previous', backwards, '上一页', 'id="previous"')}
              <span id="page-index"></span>
              ${iconButton('next', forwards, '下一页', 'id="next"')}
            </div>
            <div class="canvas-tools">
              ${button('notes', notes, '讲稿', 'class="tool-button" id="notes-button" aria-controls="notes-panel"')}
              ${button('edit', pen, '编辑内容', 'class="tool-button edit-button" id="edit-button"')}
            </div>
          </div>
          <div id="notes-panel" class="notes-panel" hidden></div>
        </div>
        <aside id="editor" class="editor" aria-label="编辑幻灯片" hidden></aside>
      </div>
      <div id="filmstrip" class="filmstrip" aria-label="幻灯片列表"></div>
    </section>
  </main>`;

const briefForm = root.querySelector('#brief-form');
const editor = root.querySelector('#editor');
const filmstrip = root.querySelector('#filmstrip');
const preview = root.querySelector('#slide-preview');
const element = (id) => root.querySelector(`#${id}`);

for (const [id, theme] of Object.entries(THEMES)) {
  const swatches = root.querySelector(`[data-swatch="${id}"]`);
  for (const color of theme.swatches.slice(0, 2)) {
    const piece = document.createElement('span');
    piece.style.backgroundColor = color;
    swatches.append(piece);
  }
}

function currentSlide() {
  return app.deck.slides[app.index];
}

function currentEvidence() {
  return app.deck.evidence?.[app.index] ?? [];
}

function clearCurrentEvidence() {
  if (currentEvidence().length) app.deck.evidence[app.index] = [];
}

function slideOptions(index) {
  return { theme: app.theme, index, total: app.deck.slides.length, deckTitle: app.deck.title };
}

function renderBrief() {
  for (const name of fields) briefForm.elements.namedItem(name).value = app.brief[name];
  briefForm.elements.namedItem('count').value = String(app.brief.count);
  updateSourceCounter();
}

function updateSourceCounter() {
  element('source-counter').textContent = `${app.brief.source.length} / ${FIELD_LIMITS.source}`;
}

function renderStatus() {
  const status = element('status');
  status.hidden = !app.status;
  status.classList.toggle('is-error', app.status?.tone === 'error');
  status.textContent = app.status?.text ?? '';
  if (app.status) status.append(
    Object.assign(document.createElement('button'), {
      type: 'button', className: 'icon-button', title: '关闭提示', ariaLabel: '关闭提示',
      innerHTML: close,
    }),
  );
  status.querySelector('button')?.setAttribute('data-action', 'dismiss');
}

function showStatus(text, tone = 'info') {
  app.status = { text, tone };
  renderStatus();
}

function renderChrome() {
  const busy = Boolean(app.busy);
  const generating = app.busy === 'generate';
  const connectionLabels = {
    connected: 'Anna 已连接', connecting: '正在连接 Anna', disconnected: 'Anna 连接失败', local: '本地预览',
  };
  const connection = element('connection');
  connection.dataset.connection = app.connection;
  connection.textContent = connectionLabels[app.connection];
  element('document-meta').textContent = app.origin === 'sample' ? '示例演示文稿' : '演示文稿';
  element('deck-title').textContent = app.deck.title || '未命名演示文稿';
  element('export').disabled = busy;
  element('export').innerHTML = app.busy === 'export' ? `${loader}<span>正在导出</span>` : `${download}<span>导出 PPTX</span>`;
  element('sample').disabled = generating;
  briefForm.querySelectorAll('[name]').forEach((control) => { control.disabled = generating; });
  element('generate').disabled = busy || app.connection === 'connecting';
  element('generate').innerHTML = generating
    ? `${loader}<span>正在生成文稿</span>` : `${sparkles}<span>生成演示文稿</span>`;
  const credits = element('credit-line');
  const quota = app.usage?.quotaConsumed;
  const creditMessage = generating ? stageLabels[app.progress] ?? ''
    : Number.isFinite(quota) ? `上次${app.usageAction}消耗 ${quota} CU` : '';
  if (credits.textContent !== creditMessage) credits.textContent = creditMessage;
  element('studio').classList.toggle('is-editing', app.editing);
  element('edit-button').setAttribute('aria-expanded', String(app.editing));
  element('edit-button').disabled = app.busy === 'rewrite';
  const notesButton = element('notes-button');
  notesButton.setAttribute('aria-expanded', String(app.showingNotes));
  notesButton.querySelector('span').textContent = currentEvidence().length ? '讲稿与依据' : '讲稿';
  element('previous').disabled = app.index === 0 || app.busy === 'rewrite';
  element('next').disabled = app.index === app.deck.slides.length - 1 || app.busy === 'rewrite';
  element('page-index').textContent = `${app.index + 1} / ${app.deck.slides.length}`;
  root.querySelectorAll('[data-theme]').forEach((control) => {
    control.setAttribute('aria-pressed', String(control.dataset.theme === app.theme));
  });
}

function setReview(review) {
  const issues = Array.isArray(review?.issues) ? review.issues.filter((issue) =>
    Number.isInteger(issue?.slide) && issue.slide > 0 && issue.slide <= app.deck.slides.length
    && typeof issue.message === 'string' && issue.message.trim()) : [];
  const warning = typeof review?.warning === 'string' ? review.warning.trim() : '';
  const count = issues.length;
  app.review = count || warning ? { issues, warning } : null;
  const panel = element('review-panel');
  panel.hidden = !app.review;
  panel.open = Boolean(app.review);
  element('review-title').textContent = count ? `生成时留下 ${count} 项待核对事项` : '生成核对未完成';
  const warningLine = element('review-warning');
  warningLine.hidden = !warning;
  warningLine.textContent = warning;
  const issueList = element('review-issues');
  issueList.hidden = !count;
  issueList.innerHTML = issues.map(({ slide, message }) => `
    <li><button type="button" data-action="select" data-index="${slide - 1}">
      <strong>第 ${slide} 页</strong><span>${escaped(message)}</span>
    </button></li>`).join('');
}

function renderNotes() {
  const panel = element('notes-panel');
  panel.hidden = !app.showingNotes;
  if (!app.showingNotes) {
    panel.replaceChildren();
    return;
  }
  const evidence = currentEvidence();
  panel.innerHTML = `
    <p>${escaped(currentSlide().notes || '这一页还没有讲稿。')}</p>
    ${evidence.length ? `<section class="slide-evidence" aria-label="参考原文">
      <h3>参考原文</h3>
      ${evidence.map((quote) => `<blockquote>${escaped(quote)}</blockquote>`).join('')}
    </section>` : ''}`;
}

function renderFilmstrip() {
  filmstrip.replaceChildren();
  app.deck.slides.forEach((slide, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'slide-tile';
    tile.dataset.action = 'select';
    tile.dataset.index = index;
    tile.title = slide.title;
    tile.disabled = app.busy === 'rewrite';
    tile.setAttribute('aria-current', index === app.index ? 'true' : 'false');
    tile.innerHTML = `<div class="film-slide" aria-hidden="true"></div><div class="slide-caption"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escaped(slide.title)}</strong></div>`;
    renderSlidePreview(tile.firstElementChild, slide, slideOptions(index));
    filmstrip.append(tile);
  });
}

function textarea(label, name, value, limit, rows = 2, disabled = false) {
  return `<label class="field">${label}<textarea data-edit="${name}" rows="${rows}" maxlength="${limit}" ${disabled ? 'disabled' : ''}>${escaped(value)}</textarea></label>`;
}

function renderEditor() {
  editor.hidden = !app.editing;
  if (!app.editing) return;
  const slide = currentSlide();
  const locked = Boolean(app.busy);
  const metrics = slide.layout === 'metrics';
  const { minItems, maxItems } = LAYOUTS[slide.layout];
  const disabled = locked ? 'disabled' : '';
  const rewrite = app.busy === 'rewrite'
    ? button('rewrite', loader, '正在改写', 'class="button subtle" disabled')
    : button('rewrite', sparkles, '改写此页', `class="button subtle" ${disabled}`);
  editor.innerHTML = `
    <div class="editor-title"><h3>第 ${app.index + 1} 页</h3>${iconButton('edit', close, '关闭编辑', app.busy === 'rewrite' ? 'disabled' : '')}</div>
    <label class="field">版式
      <select data-edit="layout" ${disabled}>
        ${Object.entries(LAYOUTS).filter(([id]) => app.index === 0 ? id === 'cover' : id !== 'cover')
          .map(([id, layout]) => `<option value="${id}" ${slide.layout === id ? 'selected' : ''}>${escaped(layout.name)}</option>`).join('')}
      </select>
    </label>
    ${textarea('标题', 'title', slide.title, FIELD_LIMITS.title, 2, locked)}
    ${textarea('副标题', 'subtitle', slide.subtitle, FIELD_LIMITS.subtitle, 2, locked)}
    ${slide.items.map((item, index) => `
      <div class="item-group">
        <div class="item-heading"><span>${metrics ? '指标' : '要点'} ${index + 1}</span>
          ${slide.items.length > minItems ? iconButton('remove-item', minus, metrics ? '移除此指标' : '移除此要点', `data-index="${index}" ${disabled}`) : ''}
        </div>
        ${textarea(metrics ? '数值或目标' : '小标题', `heading:${index}`, item.heading, FIELD_LIMITS.heading, 1, locked)}
        ${textarea(metrics ? '指标名称与口径' : '内容', `body:${index}`, item.body, FIELD_LIMITS.body, 2, locked)}
      </div>`).join('')}
    ${slide.items.length < maxItems ? button('add-item', plus, metrics ? '添加指标' : '添加要点', `class="text-button" ${disabled}`) : ''}
    ${textarea('讲稿', 'notes', slide.notes, FIELD_LIMITS.notes, 3, locked)}
    <form id="rewrite-form">
      <label class="field">改写要求
        <input name="instruction" placeholder="例如：把本页改成面向管理层的表述" maxlength="${FIELD_LIMITS.instruction}" required ${disabled}>
      </label>
      ${rewrite}
    </form>`;
}

function renderDeck({ keepEditor = false } = {}) {
  renderChrome();
  renderSlidePreview(preview, currentSlide(), slideOptions(app.index));
  renderFilmstrip();
  renderNotes();
  if (!keepEditor) renderEditor();
}

function snapshot() {
  return { version: 1, brief: app.brief, deck: app.deck, theme: app.theme, origin: app.origin, index: app.index, review: app.review };
}

function save() {
  clearTimeout(saveTimer);
  if (!hostWindow) {
    try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); } catch { /* Storage may be unavailable. */ }
    return;
  }
  if (!anna) return;
  saveTimer = setTimeout(() => {
    const value = structuredClone(snapshot());
    saveQueue = saveQueue.catch(() => {}).then(() => anna.storage.set({ key: 'draft', value }));
    saveQueue.catch(() => {});
  }, 350);
}

function applyBrief(payload, target = app.brief) {
  if (!payload || typeof payload !== 'object') return false;
  let changed = false;
  for (const field of fields) {
    if (typeof payload[field] !== 'string') continue;
    const text = payload[field].slice(0, FIELD_LIMITS[field]);
    if (target[field] === text) continue;
    target[field] = text;
    changed = true;
  }
  if (SLIDE_COUNTS.includes(payload.count) && target.count !== payload.count) {
    target.count = payload.count;
    changed = true;
  }
  return changed;
}

function restore(data) {
  if (!data || data.version !== 1) return;
  applyBrief(data.brief);
  try {
    app.deck = validateDeck(data.deck, undefined, { draft: true });
    app.index = Number.isInteger(data.index) ? Math.max(0, Math.min(data.index, app.deck.slides.length - 1)) : 0;
    app.origin = data.origin === 'sample' ? 'sample' : 'edited';
    setReview(data.review);
    if (Object.hasOwn(THEMES, data.theme)) app.theme = data.theme;
  } catch { /* Use the example when the saved deck cannot be recovered. */ }
}

function setBusy(busy = '') {
  app.busy = busy;
  renderChrome();
  renderFilmstrip();
  renderEditor();
}

function allowAI() {
  if (anna) return true;
  const message = hostWindow ? 'Anna 尚未连接，请重新打开应用后再试。' : '请在 Anna 中打开 Slidebrief 以使用 AI。';
  showStatus(message, 'error');
  return false;
}

async function generate() {
  if (app.busy || !allowAI()) return;
  const { topic } = app.brief;
  if (!topic.trim()) {
    showStatus('请输入汇报主题。', 'error');
    briefForm.elements.namedItem('topic').focus();
    return;
  }
  app.status = null;
  renderStatus();
  app.progress = 'plan';
  setBusy('generate');
  try {
    const { deck, usage, review } = await generateDeck(anna, { ...app.brief }, {
      onProgress(stage) {
        app.progress = stage;
        renderChrome();
      },
    });
    Object.assign(app, { deck, usage, usageAction: '生成', index: 0, origin: 'generated', editing: false });
    setReview(review);
    showStatus(`已生成 ${deck.slides.length} 页演示文稿。${app.review ? '请查看生成核对提示。' : ''}`);
    save();
  } catch (error) {
    showStatus(error.message || '暂时无法生成，请稍后重试。', 'error');
  } finally {
    app.busy = '';
    app.progress = '';
    renderDeck();
  }
}

async function rewrite(instruction) {
  if (app.busy || !allowAI()) return;
  if (!instruction.trim()) {
    showStatus('请输入改写要求。', 'error');
    return;
  }
  app.status = null;
  renderStatus();
  setBusy('rewrite');
  try {
    const { slide, usage } = await rewriteSlide(anna, app.deck, app.index, instruction);
    app.deck.slides[app.index] = slide;
    clearCurrentEvidence();
    if (app.index === 0) app.deck.title = slide.title;
    app.usage = usage;
    app.usageAction = '改写';
    app.origin = 'edited';
    showStatus(`第 ${app.index + 1} 页已更新。`);
    save();
  } catch (error) {
    showStatus(error.message || '暂时无法改写，请稍后重试。', 'error');
  } finally {
    app.busy = '';
    renderDeck();
    const field = editor.querySelector('[name="instruction"]');
    if (app.status?.tone === 'error' && field) field.value = instruction;
  }
}

async function exportDeck() {
  if (app.busy) return;
  setBusy('export');
  try {
    const deck = validateDeck(app.deck);
    const blob = await createPptxBlob(deck, app.theme);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(deck);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showStatus('已生成 PowerPoint 文件。');
  } catch (error) {
    showStatus(error.message || '导出失败，请检查幻灯片内容。', 'error');
  } finally {
    setBusy();
  }
}

function selectSlide(index) {
  if (app.busy === 'rewrite' || index < 0 || index >= app.deck.slides.length) return;
  app.index = index;
  save();
  renderDeck();
  const tile = filmstrip.children[index];
  const stripBounds = filmstrip.getBoundingClientRect();
  const tileBounds = tile.getBoundingClientRect();
  if (tileBounds.left < stripBounds.left) filmstrip.scrollLeft += tileBounds.left - stripBounds.left;
  if (tileBounds.right > stripBounds.right) filmstrip.scrollLeft += tileBounds.right - stripBounds.right;
}

function editField(control) {
  if (!control.dataset.edit || app.busy) return;
  const slide = currentSlide();
  const [field, itemIndex] = control.dataset.edit.split(':');
  if (field === 'layout') {
    slide.layout = control.value;
    const { minItems, maxItems } = LAYOUTS[slide.layout];
    if (slide.items.length > maxItems) {
      slide.items = slide.items.slice(0, maxItems);
      showStatus(`当前版式最多保留 ${maxItems} 个${slide.layout === 'metrics' ? '指标' : '要点'}。`);
    }
    while (slide.items.length < minItems) slide.items.push({ heading: '', body: '' });
  } else if (itemIndex !== undefined) {
    slide.items[Number(itemIndex)][field] = control.value;
  } else {
    slide[field] = control.value;
    if (field === 'title' && app.index === 0) app.deck.title = control.value;
  }
  clearCurrentEvidence();
  app.origin = 'edited';
  save();
  renderDeck({ keepEditor: field !== 'layout' });
}

briefForm.addEventListener('input', ({ target }) => {
  if (target.name === 'count') app.brief.count = Number(target.value);
  if (fields.includes(target.name)) app.brief[target.name] = target.value;
  updateSourceCounter();
  save();
});
root.addEventListener('input', ({ target }) => {
  if (target.tagName !== 'SELECT') editField(target);
});
editor.addEventListener('change', ({ target }) => {
  if (target.tagName === 'SELECT') editField(target);
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target === briefForm) generate();
  if (event.target.id === 'rewrite-form') rewrite(event.target.elements.namedItem('instruction').value);
});

root.addEventListener('click', (event) => {
  const control = event.target.closest('button[data-action]');
  if (!control) return;
  const { action, index, theme } = control.dataset;
  switch (action) {
    case 'sample':
      applyBrief(sampleBrief);
      renderBrief();
      save();
      break;
    case 'theme':
      app.theme = theme;
      save();
      renderDeck({ keepEditor: true });
      break;
    case 'select': selectSlide(Number(index)); break;
    case 'previous': selectSlide(app.index - 1); break;
    case 'next': selectSlide(app.index + 1); break;
    case 'export': exportDeck(); break;
    case 'notes':
      app.showingNotes = !app.showingNotes;
      renderChrome();
      renderNotes();
      break;
    case 'edit':
      app.editing = !app.editing;
      renderChrome();
      renderEditor();
      if (app.editing) editor.querySelector('[data-edit="title"]:enabled')?.focus({ preventScroll: true });
      else element('edit-button').focus();
      break;
    case 'add-item':
    case 'remove-item':
      if (app.busy) break;
      if (action === 'add-item') currentSlide().items.push({ heading: '', body: '' });
      else currentSlide().items.splice(Number(index), 1);
      clearCurrentEvidence();
      app.origin = 'edited';
      save();
      renderDeck();
      break;
    case 'rewrite': control.form?.requestSubmit(); break;
    case 'dismiss': app.status = null; renderStatus(); break;
    default: break;
  }
});

async function connect() {
  if (!hostWindow) {
    try { restore(JSON.parse(localStorage.getItem(storageKey))); } catch { /* Start with the sample. */ }
    renderBrief();
    renderDeck();
    return;
  }
  try {
    const sdkPath = '/static/anna-apps/_sdk/latest/index.js';
    const { AnnaAppRuntime } = await import(/* @vite-ignore */ sdkPath);
    anna = await AnnaAppRuntime.connect();
    app.connection = 'connected';
    restore(anna.runtimeState?.draft);
    if (applyBrief(anna.entryPayload)) save();
    anna.on('entry_payload', (payload) => {
      if (!applyBrief(payload)) return;
      renderBrief();
      save();
      showStatus('已带入 Anna 对话中的汇报任务。');
    });
  } catch {
    app.connection = 'disconnected';
    showStatus('未能连接 Anna。你仍可编辑和导出示例。', 'error');
  }
  renderBrief();
  renderDeck();
}

renderBrief();
renderDeck();
connect();
