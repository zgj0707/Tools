#!/usr/bin/env node
/**
 * T004 · 样本库质量度量脚本（轻量版，Stage 0 基线）
 *
 * 只做当前可真实计算的两项：
 *   - losslessRate：把 before/after 用 happy-dom 分别解析，做规范化 DOM diff，输出一致率与首个差异位置。
 *   - residueCount ：对 after HTML 统计六类编辑器注入物命中数（口径见下）。
 *   - hitRate     ：编辑器尚未接入（T101 之后才接通），本基线固定返回 null，绝不编造数字。
 *
 * 当前「编辑前 = 编辑后 = 同一文件」，因此 losslessRate 应自然算出 1.0、residue 应为 0。
 *
 * 不允许 import grapesjs / interact.js / moveable（在 jsdom/happy-dom 下会挂起）。
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const fixturesDir = join(repoRoot, 'qa', 'fixtures');
const reportDir = join(repoRoot, 'qa', 'report');
const reportFile = join(reportDir, 'metrics-latest.json');

/** 文件名（去 .html 后缀）→ 分类，与 qa/fixtures/README.md 索引一致。 */
const CATEGORY_BY_ID = {
  '01-script-carousel': '脚本轮播',
  '02-shadowdom': 'ShadowDOM',
  '03-svg-table': 'SVG 表格',
  '04-inline-image': '内联图片',
  '05-ai-landing': 'AI 生成页',
  '06-malformed': '残缺 HTML',
  '07-large': '大页精简版',
  '08-inline-events': '内联事件安全',
  '09-word-fragment': '文本片段',
  '10-flex-grid': 'Flex-Grid 布局',
};

/**
 * 编辑器注入物命中口径（契约 01 §8.2 / §8.3）。
 * 顺序即 JSON 明细中的展示顺序；命中数为全局正则匹配次数。
 */
const RESIDUE_PATTERNS = [
  { kind: 'data-ep-', re: /data-ep-/g },
  { kind: 'class="ep-', re: /class="ep-/g },
  { kind: 'ep-overlay-root', re: /ep-overlay-root/g },
  { kind: 'contenteditable', re: /contenteditable/g },
  { kind: '<style id="ep-', re: /<style\s+id="ep-/g },
  { kind: '<script id="ep-', re: /<script\s+id="ep-/g },
];

const HIT_RATE_NOTE = '未接入编辑器，hitRate 基线为占位 null';

// ── 规范化工具 ──────────────────────────────────────────────

/** 把一段文本规范化：连续空白折叠为单个空格，再 trim。空串表示纯空白。 */
function normText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// ── 规范化 DOM token 流 ─────────────────────────────────────

/**
 * 把 Document 展平成可逐位比较的 token 数组（文档序，前序遍历）。
 * 每个 token 是一个字符串，相等即视为该比较单元一致。
 *
 * token 形态：
 *   - DOCTYPE ：`DOCTYPE <name>`
 *   - 元素     ：`ELEM <tag> <JSON([[attr,value],...按名排序])>`
 *   - 文本     ：`TEXT "<norm>"`（纯空白文本节点折叠后为空，整节点丢弃）
 *   - 注释     ：`COMMENT "<norm>"`
 *   - 其他     ：`OTHER<nodeType> <nodeName>`（PI / 文档碎片等，仅占位）
 */
function tokenize(doc) {
  const tokens = [];
  if (doc.doctype) {
    tokens.push(`DOCTYPE ${doc.doctype.name}`);
  }
  const walk = (node) => {
    switch (node.nodeType) {
      case 1: {
        // ELEMENT_NODE
        const attrs = [...node.attributes]
          .map((a) => [a.name, normText(a.value)])
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        tokens.push(`ELEM <${node.tagName.toLowerCase()}> ${JSON.stringify(attrs)}`);
        for (const child of node.childNodes) walk(child);
        break;
      }
      case 3: {
        // TEXT_NODE
        const t = normText(node.nodeValue || '');
        if (t) tokens.push(`TEXT ${JSON.stringify(t)}`);
        break;
      }
      case 8: {
        // COMMENT_NODE
        const t = normText(node.nodeValue || '');
        tokens.push(`COMMENT ${JSON.stringify(t)}`);
        break;
      }
      default:
        tokens.push(`OTHER<${node.nodeType}> ${node.nodeName}`);
    }
  };
  walk(doc.documentElement);
  return tokens;
}

/** 逐位比较两组 token，返回一致率、总单元数、命中数与首个差异位置。 */
function diffTokens(beforeTokens, afterTokens) {
  const total = Math.max(beforeTokens.length, afterTokens.length);
  let matched = 0;
  let firstDiff = null;
  for (let i = 0; i < total; i += 1) {
    const b = beforeTokens[i];
    const a = afterTokens[i];
    if (b === a) {
      matched += 1;
    } else if (!firstDiff) {
      firstDiff = { index: i, before: b ?? null, after: a ?? null };
    }
  }
  return { total, matched, rate: total === 0 ? 1 : matched / total, firstDiff };
}

// ── 残留统计 ────────────────────────────────────────────────

/** 对 after HTML 原文统计六类编辑器注入物命中，返回明细数组与总数。 */
function countResidue(afterHtml) {
  const hits = [];
  let total = 0;
  for (const { kind, re } of RESIDUE_PATTERNS) {
    const m = afterHtml.match(re);
    const count = m ? m.length : 0;
    total += count;
    if (count > 0) hits.push({ kind, count });
  }
  return { hits, total };
}

// ── 主流程 ──────────────────────────────────────────────────

function listFixtures() {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b));
}

function run() {
  const win = new Window();
  const parser = new win.DOMParser();

  const files = listFixtures();
  const perFixture = [];
  let sumUnits = 0;
  let sumMatched = 0;
  let residueTotal = 0;

  for (const file of files) {
    const id = file.replace(/\.html$/, '');
    const category = CATEGORY_BY_ID[id] || '未分类';
    const afterHtml = readFileSync(join(fixturesDir, file), 'utf8');

    // 编辑前 = 编辑后 = 同一文件（Stage 0：编辑器未接入）。
    const beforeDoc = parser.parseFromString(afterHtml, 'text/html');
    const afterDoc = parser.parseFromString(afterHtml, 'text/html');

    const { total, matched, rate, firstDiff } = diffTokens(
      tokenize(beforeDoc),
      tokenize(afterDoc),
    );
    sumUnits += total;
    sumMatched += matched;

    const { hits, total: residue } = countResidue(afterHtml);
    residueTotal += residue;

    const notes = [];
    notes.push('编辑前=编辑后=同一文件，lossless 为真实解析后逐位比较');
    if (firstDiff) {
      notes.push(
        `首个差异@token#${firstDiff.index}: before=${JSON.stringify(firstDiff.before)} after=${JSON.stringify(firstDiff.after)}`,
      );
    } else {
      notes.push('与原始一致');
    }

    perFixture.push({
      id,
      category,
      hit: null, // 占位：编辑器未接入
      losslessRate: Number(rate.toFixed(4)),
      residue: hits,
      notes: notes.join('；'),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      hitRate: null,
      losslessRate: sumUnits === 0 ? 1 : Number((sumMatched / sumUnits).toFixed(4)),
      residueCount: residueTotal,
    },
    perFixture,
    notes: `${HIT_RATE_NOTE}；losslessRate 为跨样本合并的 token 一致率；residueCount 为六类注入物命中总数。`,
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');

  printHumanTable(report, files.length);
}

function printHumanTable(report, fixtureCount) {
  const line = '─'.repeat(78);
  console.log('');
  console.log('T004 质量度量（happy-dom 轻量 DOM diff，编辑前=编辑后=同一文件）');
  console.log(`${HIT_RATE_NOTE}（hitRate = null）`);
  console.log(line);
  const cols = ['id', 'category', 'lossless', 'residue', 'hit'];
  console.log(pad(cols[0], 22) + pad(cols[1], 16) + pad(cols[2], 10) + pad(cols[3], 8) + cols[4]);
  console.log(line);
  for (const f of report.perFixture) {
    console.log(
      pad(f.id, 22) +
        pad(f.category, 16) +
        pad(f.losslessRate.toFixed(4), 10) +
        pad(String(f.residue.length ? f.residue.reduce((s, h) => s + h.count, 0) : 0), 8) +
        'null',
    );
  }
  console.log(line);
  console.log(
    `totals: losslessRate=${report.totals.losslessRate}  residueCount=${report.totals.residueCount}  hitRate=${report.totals.hitRate}  fixtures=${fixtureCount}`,
  );
  console.log(`JSON -> qa/report/metrics-latest.json`);
  console.log('');
}

function pad(s, n) {
  // 中英文混排时按字符宽度粗略补齐（中文按 2 列），仅用于控制台对齐。
  let width = 0;
  for (const ch of s) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return s + ' '.repeat(Math.max(1, n - width));
}

run();
