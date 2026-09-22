#!/usr/bin/env node
/**
 * qa/probes/clipboard-http.mjs · 「复制 HTML」在安全上下文下的成功路径探针
 *
 * 为什么单独存在：
 *   `navigator.clipboard` 只在安全上下文可用，「复制 HTML」的成功路径因此无法在
 *   file:// 下验证（file:// 非安全上下文，必然降级）。而在整个测试体系里，
 *   这个按钮此前**零覆盖** —— e2e 里搜到的「复制」是 Ctrl+D 的节点复制，与它无关。
 *   本探针补上 http://localhost 这条路径，与 qa/probes/file-journey.mjs 的
 *   file:// 降级路径互为对照，两者合起来才是这个按钮的完整行为图景。
 *
 * 断言：
 *   1) http://localhost 是安全上下文，navigator.clipboard 存在
 *   2) 导入后点「复制 HTML」→ toast 为「导出成功」（走的是成功分支，不是降级）
 *   3) 剪贴板内容 = 干净导出（含正文、不含 contenteditable、不含 ep- 前缀）
 *   4) 全程零 pageerror / console error / 失败请求
 *
 * 用法：node qa/probes/clipboard-http.mjs [--base http://localhost:4173]
 *   默认自起 `vite preview`（端口 4173），跑完自动关闭；传 --base 则复用已有服务。
 * 退出码：0=通过；1=不通过。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const baseArgIdx = process.argv.indexOf('--base');
const externalBase = baseArgIdx >= 0 ? process.argv[baseArgIdx + 1] : null;
const PORT = Number(process.env.PREVIEW_PORT || 4173);
const BASE = externalBase || `http://localhost:${PORT}`;

const FIXTURE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>剪贴板样例</title></head>
<body><div class="hero" id="hero-block"><h2>原始标题</h2><p>一段说明文字</p></div></body></html>`;

const steps = [];
const failures = [];
function record(name, ok, detail) {
  steps.push({ step: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

/** 轮询等待服务可访问。 */
async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return true;
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let server = null;
if (!externalBase) {
  const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js');
  if (!existsSync(viteBin)) {
    console.error(
      `RESULT ${JSON.stringify({ ok: false, error: 'vite binary not found', viteBin })}`,
    );
    process.exit(1);
  }
  server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}

const logs = [];
let out = {};
try {
  const up = await waitForServer(BASE);
  if (!up) {
    record('preview 服务就绪', false, { base: BASE });
  } else {
    record('preview 服务就绪', true, { base: BASE });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));

    try {
      await page.goto(BASE, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(600);

      const env = await page.evaluate(() => ({
        protocol: location.protocol,
        isSecureContext: window.isSecureContext,
        clipboardType: typeof navigator.clipboard,
      }));
      out.env = env;
      record(
        '安全上下文与剪贴板可用',
        env.isSecureContext === true && env.clipboardType === 'object',
        env,
      );

      await page.locator('textarea').fill(FIXTURE);
      await page.getByRole('button', { name: '导入 HTML' }).click();
      await page.waitForTimeout(700);
      const h2 = (
        await page.frameLocator('#ep-canvas-frame').locator('h2').first().textContent()
      )?.trim();
      record('导入成功', h2 === '原始标题', { h2 });

      await page.getByRole('button', { name: '复制 HTML' }).click();
      await page.waitForTimeout(500);
      const toast = (
        await page
          .locator('.ep-toast')
          .first()
          .textContent()
          .catch(() => null)
      )?.trim();
      out.toast = toast;
      record('复制走成功分支（非降级）', toast === '导出成功', { toast });

      const clip = await page.evaluate(() => navigator.clipboard.readText());
      out.clipboardLength = clip.length;
      record('剪贴板已写入内容', clip.length > 0, { length: clip.length });
      record('剪贴板内容为正文 HTML', clip.includes('原始标题'), { head: clip.slice(0, 100) });
      record('剪贴板内容无编辑器痕迹', !clip.includes('contenteditable') && !/\bep-/.test(clip), {
        hasContenteditable: clip.includes('contenteditable'),
        hasEpPrefix: /\bep-/.test(clip),
      });
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  record('探针执行未抛异常', false, e.message);
} finally {
  if (server) server.kill();
}

const hard = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
const reqFail = logs.filter((l) => l.startsWith('[reqfail]'));
const ok = failures.length === 0 && hard.length === 0 && reqFail.length === 0;
console.log(
  'RESULT ' +
    JSON.stringify(
      { ok, base: BASE, steps, failures, hardErrors: hard, requestFailures: reqFail },
      null,
      2,
    ),
);
process.exit(ok ? 0 : 1);
