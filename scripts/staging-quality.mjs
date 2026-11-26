import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';
import { createPptxBlob } from '../src/deck.js';
import { generateDeck } from '../src/generation.js';

const host = 'https://staging.anna.partners';
const runtime = '/api/v1/anna-apps/runtime';
const briefs = {
  observed: {
    topic: '自助退款入口试点进展',
    audience: '客服运营负责人',
    goal: '向负责人汇报观测和后续目标，争取保留小范围试点',
    source: '已观测：试点组自助完成率为18%。后续目标（尚未达成）：自助完成率达到25%。访谈指出部分用户找不到进度入口，下一步拟调整入口和进度说明。素材没有对照组数据，无法判断对整体客服量的影响。',
    count: 4,
  },
  retro: {
    topic: '订单提交异常复盘',
    audience: '研发及值班团队',
    goal: '回顾已知影响和恢复动作，明确仍需核对的信息',
    source: '部分订单提交失败。发现下游接口响应异常，切换备用路径后恢复，随后验证了订单提交。触发条件还在排查，影响范围待核实。未提供发生日期、具体持续时间、订单数量或负责人姓名。',
    count: 4,
  },
  decision: {
    topic: '客服质检工具采购决策',
    audience: '运营和财务决策人',
    goal: '比较两种方案，明确需要确认的采购口径',
    source: '自建方案的一次性采购报价为12万元，后续维护费待核实。订阅方案的报价为3万元/月，含维护，合同期限待确认。两种方案尚未决策。比较时保留原始金额和计费单位，不能直接把两笔报价当成同一周期的总成本。',
    count: 5,
  },
};

const help = `Usage: node scripts/staging-quality.mjs --run [--case observed|retro|decision] [--out-dir PATH]

--case can be repeated. With no cases selected, all three run.
--app-id defaults to 313, --version to 0.0.0-draft, --max-calls to 3 per case.
--out-dir writes the PPTX and a JSON report, including slide text, for each successful case.
--run explicitly enables model calls that can consume Anna staging credits.
Use a saved Anna staging CLI login with the selected app installed.`;

function finding(name, passed) {
  return { name, passed };
}

function statements(deck) {
  return deck.slides.flatMap((slide) => [
    `${slide.title} ${slide.subtitle}`,
    ...slide.items.map((item) => `${item.heading} ${item.body}`),
    slide.notes,
  ]).filter(Boolean).map((line) => line.normalize('NFKC'));
}

function checkContent(key, deck) {
  const lines = statements(deck);
  const contains = (pattern) => lines.some((line) => pattern.test(line));
  if (key === 'observed') {
    return [
      finding('18% remains an observed pilot result', contains(/(?:观测|实测|现状|当前|实际|已达|试点结果|基线|从)[^，。；]{0,28}(?<![\d.])18\s*%|(?<![\d.])18\s*%[^，。；]{0,14}(?:实测|观测|基线)/u)),
      finding('25% remains a future target', contains(/(?:目标|拟|计划|预期|争取|希望|后续|提升至|提升到|提高到)[^，。；]{0,24}(?<![\d.])25\s*%|(?<![\d.])25\s*%[^，。；]{0,12}(?:目标|待验证|未达)/u)),
      finding('No unqualified claim that 25% was achieved', !contains(/(?:已达到|已达成|现已达到|已提升至|已提升到|实测为)\s*25\s*%/u)),
    ];
  }
  if (key === 'retro') {
    return [
      finding('Restoration method preserved', contains(/备用路径/u)),
      finding('Trigger or scope uncertainty preserved', contains(/触发[^，。；]{0,15}(?:排查|待|未)|影响范围[^，。；]{0,10}(?:未知|待|未)/u)),
      finding('No concrete date, duration, count, or named owner detected', !contains(/\d+\s*(?:年|月[\d份]|日|时|小时|分钟|秒|单|笔|%|名|人)|(?:周[一二三四五六日]|[一二三四五六七八九十两半]+(?:个)?(?:小时|分钟|秒钟|百单|千单))|(?:负责人|责任人|owner)\s*(?:是|为|[:=])\s*(?!待|未|不|无|尚)[^，。；\s]{2,}/iu)),
      finding('Missing names do not become pending assignments', !contains(/(?:负责人|责任人|核实人)\s*[:：]?\s*(?:待定|待明确|待指定|尚未指定)|(?:指定|安排|组织)(?:相关人员|负责人|责任人)进行/u)),
    ];
  }
  return [
    finding('Self-build priced at 120,000 RMB one time', contains(/一次性[^，。；]{0,22}(?<![\d.])(?:12\s*万(?:元)?|120[, ]?000\s*元)|(?<![\d.])(?:12\s*万(?:元)?|120[, ]?000\s*元)[^，。；]{0,16}一次性/u)),
    finding('Subscription priced at 30,000 RMB per month', contains(/(?<![\d.])(?:3\s*万(?:元)?|30[, ]?000\s*元)\s*(?:[/每]\s*月|月付)|(?:每月|月费|按月)[^，。；]{0,14}(?<![\d.])(?:3\s*万(?:元)?|30[, ]?000\s*元)/u)),
    finding('At least one unknown cost or terms factor preserved', contains(/(?:维护费|合同期|合同期限)[^，。；]{0,14}(?:待|未|未知)/u)),
    finding('No reversal of one-time and monthly pricing detected', !contains(/(?<![\d.])(?:12\s*万(?:元)?|120[, ]?000\s*元)\s*[/每]\s*月|一次性[^，。；]{0,10}(?<![\d.])(?:3\s*万(?:元)?|30[, ]?000\s*元)(?!\s*(?:元|[/每]\s*月))/u)),
  ];
}

async function verifyPptx(deck) {
  const bytes = Buffer.from(await (await createPptxBlob(deck, 'editorial')).arrayBuffer());
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideNames.length, deck.slides.length, 'PPTX slide count mismatch');
  const textBoxes = await Promise.all(deck.slides.map(async (slide, index) => {
    const number = index + 1;
    const page = await zip.file(`ppt/slides/slide${number}.xml`).async('string');
    const count = (page.match(/<p:cNvSpPr\b[^>]*txBox="1"/g) ?? []).length;
    assert.ok(count > 0, `Slide ${number} has no editable text box`);
    if (slide.notes?.trim()) {
      const notes = zip.file(`ppt/notesSlides/notesSlide${number}.xml`);
      assert.ok(notes && /<a:t>[^<]+<\/a:t>/u.test(await notes.async('string')), `Slide ${number} is missing exported speaker notes`);
    }
    return count;
  }));
  return { bytes, textBoxes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function createRuntime(appId, version) {
  // The pinned CLI exposes its saved-account helper through this bundled module.
  const cli = import.meta.resolve('@anna-ai/cli');
  const { getAccount } = await import(new URL('credentials-eDEOTZtm.js', cli));
  const account = getAccount(host);
  assert.ok(account?.pat && (!account.expires_at || account.expires_at * 1000 > Date.now()), 'Sign in using the Anna staging CLI before running the benchmark');

  async function request(path, { body, appToken } = {}) {
    const headers = { Authorization: `Bearer ${account.pat}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (appToken) headers['X-Anna-App-Token'] = appToken;
    const response = await fetch(`${host}${runtime}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error || !payload) {
      const rawCode = payload?.error?.code;
      const code = typeof rawCode === 'string' && /^[A-Z_\d]{1,64}$/.test(rawCode) ? rawCode : 'RUNTIME_ERROR';
      throw Object.assign(new Error(`${path} returned ${code} (HTTP ${response.status})`), { code });
    }
    return payload;
  }

  const window = await request('/windows', { body: { app_id: appId, view: 'main' } });
  assert.ok(window.window_uuid && window.bundle_url, 'Staging did not return an app window and a bundle');
  const path = decodeURIComponent(new URL(window.bundle_url, host).pathname);
  assert.ok(path.split('/').includes(version), `Installed staging App is not the expected ${version} version`);

  return async (args) => {
    const detail = await request(`/windows/${encodeURIComponent(window.window_uuid)}`);
    assert.ok(detail.token, 'Staging did not return a window token');
    const response = await request('/rpc', {
      appToken: detail.token,
      body: { id: randomUUID(), window_uuid: window.window_uuid, ns: 'llm', method: 'complete', args },
    });
    assert.ok(response.result?.content, 'Staging did not return a model result');
    return response.result;
  };
}

async function runCase(key, complete, maxCalls, outputDirectory) {
  const brief = briefs[key];
  const calls = [];
  const progress = [];
  try {
    const anna = { llm: { async complete(args) {
      assert.ok(calls.length < maxCalls, `Model call limit reached (${maxCalls})`);
      const record = { number: calls.length + 1, maxTokens: args.maxTokens };
      calls.push(record);
      const reply = await complete(args).catch((error) => {
        record.error = error.code ?? error.name;
        throw error;
      });
      Object.assign(record, {
        model: reply.model,
        usage: reply.usage,
        quotaConsumed: reply._meta?.quotaConsumed ?? null,
        latencyMs: reply._meta?.latencyMs,
        stopReason: reply.stopReason,
      });
      return reply;
    } } };
    const { deck, usage, review } = await generateDeck(anna, brief, {
      onProgress: (phase) => progress.push(typeof phase === 'string' ? phase : phase?.stage ?? phase?.phase),
    });

    const { bytes, textBoxes, sha256 } = await verifyPptx(deck);
    const findings = [
      finding(`Exactly ${brief.count} slides`, deck.slides.length === brief.count),
      finding('Cover first, closing slide last', deck.slides[0].layout === 'cover' && deck.slides.at(-1).layout === 'closing'),
      ...checkContent(key, deck),
    ];
    if (review) findings.push(finding('Model review completed with no open findings', !review.warning && review.issues?.length === 0));
    const report = {
      case: key, progress, calls, usage, review,
      slides: deck.slides.map(({ layout, title }) => ({ layout, title })),
      findings,
      pptx: { bytes: bytes.length, textBoxes, sha256 },
    };
    if (outputDirectory) {
      const stem = resolve(outputDirectory, key);
      await writeFile(`${stem}.pptx`, bytes);
      await writeFile(`${stem}.json`, `${JSON.stringify({ ...report, brief, deck }, null, 2)}\n`);
      report.pptx.file = `${stem}.pptx`;
    }
    return report;
  } catch (error) {
    return { case: key, progress, calls, error: error.message, cause: error.cause?.message };
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean' },
    run: { type: 'boolean' },
    'app-id': { type: 'string', default: '313' },
    version: { type: 'string', default: '0.0.0-draft' },
    case: { type: 'string', multiple: true },
    'out-dir': { type: 'string' },
    'max-calls': { type: 'string', default: '3' },
  } });
  if (values.help || !values.run) {
    console.log(help);
    return;
  }
  const selections = values.case ? [...new Set(values.case)] : Object.keys(briefs);
  assert.ok(selections.every((key) => Object.hasOwn(briefs, key)), 'Unknown case. Run with --help to see available cases');
  const appId = Number(values['app-id']);
  assert.ok(Number.isSafeInteger(appId) && appId > 0, 'Invalid Anna app ID');
  const maxCalls = Number(values['max-calls']);
  assert.ok(Number.isSafeInteger(maxCalls) && maxCalls > 0, 'Invalid model call limit');

  const outDir = values['out-dir'] && resolve(values['out-dir']);
  if (outDir) await mkdir(outDir, { recursive: true });
  const complete = await createRuntime(appId, values.version);
  for (const key of selections) {
    const result = await runCase(key, complete, maxCalls, outDir);
    console.log(JSON.stringify(result, null, 2));
    if (result.error || result.findings.some(({ passed }) => !passed)) process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
