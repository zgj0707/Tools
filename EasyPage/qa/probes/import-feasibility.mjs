#!/usr/bin/env node
/**
 * qa/probes/import-feasibility.mjs · 「粘贴链接导入 HTML」的浏览器能力边界探针
 *
 * 存在意义：这是一份**平台事实**的回归基线，不是产品功能测试。
 * 它回答的是「浏览器允许什么」，用来约束导入功能的方案设计 ——
 * 将来实现 URL 导入 / 拖拽导入时，先跑这里确认边界没变。
 *
 * 实测结论（2026-09-22，Chromium；file:// 与 http:// 两种载体结果一致）：
 *
 *   | 输入形式                         | 能否导入 | 决定因素 |
 *   |----------------------------------|----------|----------|
 *   | 本地文件（选择 / 拖拽 / 粘贴）    | ✅ 可以  | FileReader + DataTransfer，与载体无关 |
 *   | 本地路径字符串（C:\a\b.html）     | ❌ 不行  | 浏览器无文件系统读权限；file:// 之间 fetch 被禁 |
 *   | 网页链接 · 目标放行 CORS          | ✅ 可以  | 实测 api.github.com 在 file:// 下 type=cors/200 |
 *   | 网页链接 · 目标未放行 CORS        | ❌ 不行  | 实测 example.com 降级 opaque/status=0，纯前端无解 |
 *
 * 注意「跨域抓取成功」与「载体是 file://」无关：file:// 的 origin 为 null，
 * 但只要目标返回 `Access-Control-Allow-Origin: *`（或 null）即可读取。
 * 反过来，http:// 载体同样救不了不放行 CORS 的普通网页。
 *
 * 用法：node qa/probes/import-feasibility.mjs
 * 退出码：0=边界与预期一致；1=出现与预期不符的结果（浏览器行为变化，需重新评估方案）。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const distEntry = resolve(repoRoot, 'dist/index.html');
const PORT = Number(process.env.PREVIEW_PORT || 4173);

/** 可达且放行 CORS 的目标（api.github.com 返回 Access-Control-Allow-Origin: *）。 */
const CORS_OK_URL = 'https://api.github.com/';
/** 可达但不放行 CORS 的目标（example.com 不返回该头）。 */
const CORS_MISSING_URL = 'https://example.com/';

const findings = [];
function check(name, ok, detail) {
  findings.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
}

async function probe(page) {
  // 显式传入 file:// 绝对 URL：不能从 location.href 推导，
  // 否则在 http 载体下会变成同源 http 请求（合法成功），测不到 file→file 的真实边界。
  const localFileUrl = pathToFileURL(resolve(repoRoot, 'qa/fixtures/01-script-carousel.html')).href;
  return page.evaluate(
    async ({ corsOk, corsMissing, fileUrl }) => {
      const out = {};
      async function tryFetch(u, init) {
        try {
          const r = await fetch(u, init);
          let len = null;
          try {
            len = (await r.text()).length;
          } catch (e) {
            len = `throw:${e.name}`;
          }
          return { ok: true, status: r.status, type: r.type, length: len };
        } catch (e) {
          return { ok: false, name: e.name, message: String(e.message).slice(0, 160) };
        }
      }
      out.corsOkFetch = await tryFetch(corsOk, { redirect: 'follow' });
      out.corsMissingFetch = await tryFetch(corsMissing, { redirect: 'follow' });
      out.fileUrlFetch = await tryFetch(fileUrl);

      out.localFileApis = {
        DataTransfer: typeof DataTransfer === 'function',
        FileReader: typeof FileReader === 'function',
        showOpenFilePicker: typeof window.showOpenFilePicker,
        clipboardRead: typeof navigator.clipboard?.read,
      };

      // FileReader 读本地 File —— 选择 / 拖拽 / 粘贴三条路径最终都汇到这里
      try {
        const f = new File(['<!DOCTYPE html><html><body><h1>hi</h1></body></html>'], 'a.html', {
          type: 'text/html',
        });
        const text = await new Promise((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => res(String(rd.result));
          rd.onerror = () => rej(new Error('reader error'));
          rd.readAsText(f);
        });
        out.fileReader = { ok: text.includes('<h1>hi</h1>'), length: text.length };
      } catch (e) {
        out.fileReader = { ok: false, message: e.message };
      }

      // 构造 drop 事件能否把 File 递进页面（拖拽导入的可行性核心）
      try {
        const dt = new DataTransfer();
        dt.items.add(new File(['<html></html>'], 'b.html', { type: 'text/html' }));
        const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        out.dropEvent = {
          ok: (ev.dataTransfer?.files?.length ?? 0) === 1,
          fileCount: ev.dataTransfer?.files?.length ?? -1,
        };
      } catch (e) {
        out.dropEvent = { ok: false, message: e.message };
      }
      return out;
    },
    { corsOk: CORS_OK_URL, corsMissing: CORS_MISSING_URL, fileUrl: localFileUrl },
  );
}

const stages = [];
for (const carrier of ['file', 'http']) {
  let server = null;
  let browser = null;
  try {
    let url;
    if (carrier === 'file') {
      url = pathToFileURL(distEntry).href;
    } else {
      const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js');
      server = spawn(
        process.execPath,
        [viteBin, 'preview', '--port', String(PORT), '--strictPort'],
        { cwd: repoRoot, stdio: 'ignore' },
      );
      const deadline = Date.now() + 20000;
      let up = false;
      while (Date.now() < deadline && !up) {
        try {
          up = (await fetch(`http://localhost:${PORT}/`)).status < 500;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!up) {
        stages.push({ carrier, error: 'preview 服务未就绪' });
        continue;
      }
      url = `http://localhost:${PORT}/`;
    }

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const env = await page.evaluate(() => ({
      protocol: location.protocol,
      origin: location.origin,
      isSecureContext: window.isSecureContext,
    }));
    const p = await probe(page);
    stages.push({ carrier, env, probe: p });

    // 与预期逐条比对
    const tag = `${carrier}:`;
    check(
      `${tag} 放行 CORS 的链接可抓取`,
      p.corsOkFetch.ok && p.corsOkFetch.type === 'cors',
      p.corsOkFetch,
    );
    check(
      `${tag} 未放行 CORS 的链接不可读取`,
      !p.corsMissingFetch.ok || p.corsMissingFetch.length === 0,
      p.corsMissingFetch,
    );
    check(`${tag} 本地 file:// 之间不可 fetch`, !p.fileUrlFetch.ok, p.fileUrlFetch);
    check(`${tag} FileReader 可读本地 File`, p.fileReader.ok === true, p.fileReader);
    check(`${tag} 可构造 drop 事件递入 File`, p.dropEvent.ok === true, p.dropEvent);
  } catch (e) {
    stages.push({ carrier, error: e.message });
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
}

const ok = findings.every((f) => f.ok) && stages.every((s) => !s.error);
console.log(
  'RESULT ' +
    JSON.stringify({ ok, findings, stages, expected: '见本文件头部注释的边界表' }, null, 2),
);
process.exit(ok ? 0 : 1);
