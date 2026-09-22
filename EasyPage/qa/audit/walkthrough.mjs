#!/usr/bin/env node
/**
 * qa/audit/walkthrough.mjs · 功能与呈现方式走查
 *
 * 目的：把「界面乱」这个主观印象变成可量化、可复查的事实。
 * 做法：在真实 Chromium 下逐个功能场景操作 → 截图 → 同时自动检测呈现层异常：
 *   - 文字被截断（scrollWidth > clientWidth + 容差）
 *   - 元素零尺寸 / 不可见但占位（visibility:hidden 且非后代用途）
 *   - 元素超出视口或父容器边界
 *   - 可见元素互相重叠（同类控件之间，排除刻意覆盖层）
 *   - 同一区域内的按钮尺寸参差
 *
 * 用法：node qa/audit/walkthrough.mjs [--base http://localhost:4173] [--only <场景id前缀>]
 * 产出：qa/audit/shots/<id>.png + qa/audit/report.json（stdout 同时打印摘要）
 * 退出码：0=走查完成（发现问题不影响退出码）；1=走查自身出错。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const PORT = Number(process.env.PREVIEW_PORT || 4173);
const SHOTS = resolve(here, 'shots');
const LAYOUT_KEY = 'easypage:layout';
const OPEN_ALL = JSON.stringify({ left: true, right: true });
const CLOSED_ALL = JSON.stringify({ left: false, right: false });

const baseArgIdx = process.argv.indexOf('--base');
const EXTERNAL_BASE = baseArgIdx >= 0 ? process.argv[baseArgIdx + 1] : null;
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

mkdirSync(SHOTS, { recursive: true });

const FIXTURE = readFileSync(resolve(repoRoot, 'qa/fixtures/05-ai-landing.html'), 'utf8');

/**
 * T123 场景 17 专用：刻意「内容不足一屏」的短文档。
 *
 * 默认的 05-ai-landing 内容太短但画布高 600px，body 天然只有约 150px ——
 * 悬停空白处虽然也会命中 html/body，但框只占画布 ~25%，落在阈值边缘，触发不稳定。
 * 这里用 body{height:480px} 把内容高度钉死成画布高度的 80%，
 * 让「悬停空白 → 框住整页 → 12% 填充染蓝整屏」这个缺陷**必然**复现。
 */
const SHORT_FIXTURE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T123 短文档</title>
<style>html,body{margin:0}body{height:480px}</style></head>
<body><h1>短文档</h1><p>正文只有一行，下方全是空白</p></body>
</html>`;

/** 检测用：注入到页面里跑的几何体检函数源码。 */
const AUDIT_FN = `
(() => {
  const out = { truncated: [], zeroSize: [], outOfViewport: [], overlaps: [], covered: [], regionOverflow: [], bigTint: [], staleHover: [], regionButtons: {} };
  const TOL = 1;
  // 用 checkVisibility 判断「是否在渲染树中可见」—— 它会把祖先 display:none 一并算进去。
  // 早期版本只查元素自身的 computedStyle.display，导致面板收起时面板内元素全部被误判为
  // 「零尺寸」（空态下误报 71 项）。这个坑必须记住：祖先隐藏 ≠ 自身 display:none。
  const vis = (el) => {
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + (t ? ' "' + t + '"' : '');
  };
  // 从 computedStyle 的 rgb()/rgba() 里取 alpha。
  // ⚠️ 刻意不用正则：AUDIT_FN 整体是模板字符串，正则里的 \\s / \\d 必须写成双反斜杠，
  //    写成单反斜杠会被 JS 当转义吞掉（\\s→s、\\d→d），正则静默失配、永远拿到 alpha=0。
  //    T123 就是踩了这个坑：大面积着色检测本身写对了，却因为这一条恒定返回 0（检测器假阴性）。
  const bgAlphaOf = (css) => {
    if (!css || css.indexOf('(') < 0 || css.indexOf(')') < 0) return 0;
    const parts = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')')).split(',');
    if (parts.length < 3) return 0;
    return parts.length === 4 ? parseFloat(parts[3]) : 1;
  };
  const app = document.getElementById('ep-app');
  if (!app) return { fatal: 'no #ep-app' };

  // 1. 文字截断（只看有直接文本的可见元素）
  for (const el of app.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (el.children.length > 0 && !el.querySelector(':scope > *')) { /* leaf-ish */ }
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim());
    if (!direct) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + TOL) out.truncated.push({ el: label(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
  }

  // 2. 零尺寸：在渲染树中可见、有直接文本、却渲染成 0 尺寸 —— 真异常
  for (const el of app.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim());
    if (hasText && (r.width < 1 || r.height < 1)) out.zeroSize.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
  }

  // 3. 超出视口 —— 只查顶层区域容器与浮层控件。
  //    面板内部子元素超出视口底部是正常的（面板自身可滚动），查它会制造海量噪声。
  const vw = innerWidth, vh = innerHeight;
  const topLevel = ['.ep-topbar', '.ep-alignbar', '#ep-breadcrumb', '.ep-toast', '.ep-import-card', '.ep-link-popover', '.ep-menu', '.ep-elements', '.ep-layers', '.ep-panel'];
  for (const sel of topLevel) {
    for (const el of app.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + TOL || r.bottom > vh + TOL || r.left < -TOL || r.top < -TOL) {
        out.outOfViewport.push({ el: label(el), rect: { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom) }, viewport: { w: vw, h: vh } });
      }
    }
  }

  // 4. 同区域按钮重叠（排除覆盖层/handle/画布内元素）
  const regions = { topbar: '.ep-topbar', alignbar: '.ep-alignbar', elements: '.ep-elements', layers: '.ep-layers', style: '.ep-panel', import: '.ep-import-card' };
  for (const [name, sel] of Object.entries(regions)) {
    const region = app.querySelector(sel);
    if (!region || !vis(region)) continue;
    const btns = [...region.querySelectorAll('button')].filter(vis);
    out.regionButtons[name] = btns.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || '').trim().slice(0, 20),
        w: Math.round(r.width), h: Math.round(r.height),
        pressed: b.getAttribute('aria-pressed'),
        disabled: b.disabled || null,
      };
    });
    for (let i = 0; i < btns.length; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) out.overlaps.push({ a: label(btns[i]), b: label(btns[j]), overlap: { w: Math.round(ox), h: Math.round(oy) } });
      }
    }
  }

  // 5. 关键区域的几何
  const g = (sel) => { const e = app.querySelector(sel); if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  out.geometry = {
    topbar: g('.ep-topbar'), alignbar: g('.ep-alignbar'), elements: g('.ep-elements'), layers: g('.ep-layers'),
    style: g('.ep-panel'), canvas: g('.ep-canvas-host'), breadcrumb: g('#ep-breadcrumb'),
    importOverlay: g('.ep-import-overlay'), toast: g('.ep-toast'),
    selectionBox: g('#ep-selected-box') || g('.ep-selected-box-multi'),
    multiBoxes: app.querySelectorAll('.ep-selected-box-multi').length,
    hoverBox: g('#ep-hover-box'),
  };
  out.viewport = { w: vw, h: vh, scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth };

  // 6. 可滚动性：内容高于视口时，是否提供了滚动手段。
  //    「超出视口」本身不一定是问题，**够不到**才是问题 —— 这条比 outOfViewport 更能定性。
  out.scrollables = [];
  for (const sel of ['.ep-panel', '.ep-elements', '.ep-layers', '.ep-main', '.ep-canvas-row', '.ep-canvas-col']) {
    const el = app.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.scrollables.push({
      sel,
      boxH: Math.round(r.height),
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      overflowY: cs.overflowY,
      maxHeight: cs.maxHeight,
      // 内容被裁掉且没有可用的滚动容器 ⇒ 那部分内容用户永远够不到
      clipped: el.scrollHeight > el.clientHeight + 2 && !(cs.overflowY === 'auto' || cs.overflowY === 'scroll'),
    });
  }
  out.counts = {
    appButtons: app.querySelectorAll('button').length,
    visibleAppButtons: [...app.querySelectorAll('button')].filter(vis).length,
  };

  // 7. 遮挡可达性：可见控件的**中心点必须能被自己命中**（T122 补）。
  //    第 4 条只查同一区域内部两两重叠，查不到「被另一个区域盖住」——
  //    本次「对齐条末位按钮被样式面板覆盖」正是这样漏掉的：
  //    对齐条 nowrap 宽 497px，画布列只有 408px，右端 89px 压到了右侧样式面板底下。
  //    几何上没越界、也没截断，看起来只是「排列有点怪」，实际按钮中心点已被别人接管、点不到。
  //    elementFromPoint 命中自己 = 真的能点到，这是唯一可靠的判据。
  out.covered = [];
  const modalOpen = !!app.querySelector('.ep-import-overlay[data-open="true"]');
  // 瞬态浮层会正常盖住下面的控件（右键菜单、链接气泡、提示条），不算缺陷
  const TRANSIENT = '.ep-context-menu, .ep-link-popover, .ep-import-overlay, .ep-toast';
  if (!modalOpen) {
    for (const el of app.querySelectorAll('button, select, input, textarea')) {
      if (!vis(el)) continue;
      // ⚠️ 不跳过 disabled 的控件：被遮挡的 disabled 按钮同样是缺陷——它说明容器已经溢出，
      //    只是「恰好溢出的那几个按钮当前不可用」而已。第一版跳过了 disabled，
      //    结果窄视口对齐条场景里溢出的正好是「水平等距 / 垂直等距」（2 元素选中时为 disabled），
      //    检查报 0 却实际溢出了 145px。
      const r = el.getBoundingClientRect();
      // 完全落在视口内、且有可点面积才检查；否则「需要滚动才可见」会被误判成遮挡
      if (r.width < 8 || r.height < 8) continue;
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) continue;
      if (hit === el || el.contains(hit) || hit.contains(el)) continue;
      if (hit.closest?.(TRANSIENT) || el.closest?.(TRANSIENT)) continue;
      out.covered.push({
        el: label(el),
        hit: label(hit),
        disabled: el.disabled || false,
        at: { x: Math.round(cx), y: Math.round(cy) },
      });
    }
  } else {
    out.coveredSkipped = '导入浮层（全屏模态）打开，遮挡属预期';
  }

  // 8. 区域溢出父容器（T122 补）：不看能不能点到，直接量「区域有没有跑出父容器的内容盒」。
  //    与第 7 条互补 —— 第 7 条依赖命中测试、受 disabled 与坐标影响；这条是纯几何，
  //    在按钮全禁用（无选中）的状态下也能抓到溢出。
  out.regionOverflow = [];
  for (const [name, sel] of Object.entries(regions)) {
    const region = app.querySelector(sel);
    if (!region || !vis(region)) continue;
    const parent = region.parentElement;
    if (!parent) continue;
    const pr = parent.getBoundingClientRect();
    const pcs = getComputedStyle(parent);
    const inner = {
      left: pr.left + parseFloat(pcs.borderLeftWidth || '0') + parseFloat(pcs.paddingLeft || '0'),
      right: pr.right - parseFloat(pcs.borderRightWidth || '0') - parseFloat(pcs.paddingRight || '0'),
    };
    const rr = region.getBoundingClientRect();
    const overRight = Math.round(rr.right - inner.right);
    const overLeft = Math.round(inner.left - rr.left);
    if (overRight > TOL || overLeft > TOL) {
      out.regionOverflow.push({
        region: name,
        sel,
        parent: label(parent),
        over: { right: overRight > 0 ? overRight : 0, left: overLeft > 0 ? overLeft : 0 },
        regionW: Math.round(rr.width),
        parentInnerW: Math.round(inner.right - inner.left),
      });
    }
  }

  // 9. 大面积着色遮挡（T123 补）：几何检测永远抓不到「框位置没错、但整页被蒙了一层色」。
  //    T123 的蓝框就是这样漏过去的 —— hover 框的位置/尺寸全对，只是框住了整个 body，
  //    再叠上 12% 的强调色填充，整页内容就被染蓝了。
  //    阈值 0.26 而非拍脑袋的 0.5：修复后填充上限是画布 1/4（geom.HOVER_FILL_MAX_RATIO），
  //    高于 1/4 的着色在「修复后的代码」里不可能出现，因此 0.26 只会有漏报不会有误报。
  //    （最初取 0.5 属于阈值过高，被场景 17 的实测证伪 —— 见 FINDINGS §6.1。）
  out.bigTint = [];
  const frame = document.getElementById('ep-canvas-frame');
  if (frame && vis(frame)) {
    const fr = frame.getBoundingClientRect();
    const canvasArea = fr.width * fr.height;
    const overlayEls = [
      ['#ep-hover-box', document.getElementById('ep-hover-box')],
      ['#ep-selected-box', document.getElementById('ep-selected-box')],
      ...Array.from(document.querySelectorAll('.ep-selected-box-multi')).map((el, i) => ['.ep-selected-box-multi#' + i, el]),
    ];
    for (const [name, el] of overlayEls) {
      if (!el || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (!canvasArea || !r.width || !r.height) continue;
      const ratio = (r.width * r.height) / canvasArea;
      const bg = getComputedStyle(el).backgroundColor;
      const bgAlpha = bgAlphaOf(bg);
      if (ratio > 0.26 && bgAlpha > 0.02) {
        out.bigTint.push({
          el: name,
          ratio: Number(ratio.toFixed(3)),
          bg,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }
  }

  // 10. 高亮滞留（T123 补）：指针已经不在画布上了，hover 高亮却还亮着。
  //     场景需先写 window.__epAuditMouse = {x,y} 声明指针位置；未写则跳过本条。
  //     修复前 CanvasHost 只有 iframe 内的 pointermove，没有 pointerleave，
  //     指针移回顶栏调样式时高亮一直留在画布上，正好挡着要看的效果。
  out.staleHover = [];
  const mouse = window.__epAuditMouse;
  if (mouse && frame && vis(frame)) {
    const fr = frame.getBoundingClientRect();
    const inside = mouse.x >= fr.left && mouse.x <= fr.right && mouse.y >= fr.top && mouse.y <= fr.bottom;
    const hb = document.getElementById('ep-hover-box');
    if (!inside && hb && vis(hb)) {
      const r = hb.getBoundingClientRect();
      out.staleHover.push({
        mouse,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
  }

  return out;
})()
`;

/** 给单步操作加超时兜底：一个场景卡住不应拖垮整轮走查。 */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

function storageStateFor(origin, value) {
  return { cookies: [], origins: [{ origin, localStorage: [{ name: LAYOUT_KEY, value }] }] };
}

/** 场景定义。open：面板是否展开；setup：导入与操作。 */
const SCENARIOS = [
  {
    id: '01-empty',
    name: '空态：导入浮层（无文档）',
    open: false,
  },
  {
    id: '02-imported-canvas-first',
    name: '导入后默认态（C 版：面板收起）',
    open: false,
    import: true,
  },
  {
    id: '03-panels-open',
    name: '双面板展开 + 已导入',
    open: true,
    import: true,
  },
  {
    id: '04-single-select',
    name: '单选 hero 标题（覆盖层 + 手柄 + 面包屑 + 样式面板）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('h1').first().click();
      await page.waitForTimeout(250);
    },
  },
  {
    id: '05-multi-select',
    name: '多选两个卡片（对齐条可用）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      const cards = fr.locator('.card');
      await cards.nth(0).click();
      await cards.nth(1).click({ modifiers: ['Shift'] });
      await page.waitForTimeout(250);
    },
  },
  {
    id: '06-inline-edit',
    name: '就地编辑中（contenteditable 激活）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('h1').first().dblclick();
      await page.waitForTimeout(250);
    },
  },
  {
    id: '07-context-menu',
    name: '右键菜单',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('h1').first().click({ button: 'right' });
      await page.waitForTimeout(300);
    },
  },
  {
    id: '08-block-only-element',
    name: '选中 block-only 元素（样式面板应禁用）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('button.cta').first().click();
      await page.waitForTimeout(300);
    },
  },
  {
    id: '09-link-set',
    name: '选中链接元素（样式面板链接区）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('nav a').nth(1).click();
      await page.waitForTimeout(300);
    },
  },
  {
    id: '10-format-painter',
    name: '格式刷激活态',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('h1').first().click();
      await page.getByRole('button', { name: '格式刷' }).click();
      await page.waitForTimeout(250);
    },
  },
  {
    id: '11-drag',
    name: '拖拽元素中（吸附线可能出现）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      const card = fr.locator('.card').nth(0);
      await card.click();
      await page.waitForTimeout(200);
      // 真实 mouse.down/move 跨 iframe 在本环境会挂起（Playwright + iframe + 主文档覆盖层），
      // 这一点 tests/e2e/drag.spec.ts 的注释里早已记录，不是应用缺陷。
      // 改用浏览器内合成 PointerEvent，并**刻意不派发 pointerup** —— 停在「拖拽进行中」，
      // 这样才能截到只在该瞬间可见的吸附对齐线。
      await card.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const doc = el.ownerDocument;
        el.dispatchEvent(
          new PointerEvent('pointerdown', {
            clientX: rect.left + 8,
            clientY: rect.top + 8,
            bubbles: true,
          }),
        );
        doc.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: rect.left + 48,
            clientY: rect.top + 34,
            bubbles: true,
          }),
        );
      });
      await page.waitForTimeout(350);
    },
  },
  {
    id: '12-locked',
    name: '锁定元素',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      await fr.locator('h1').first().click();
      await page.waitForTimeout(150);
      await page.keyboard.press('Control+l');
      await page.waitForTimeout(300);
    },
  },
  {
    id: '13-preview',
    name: '预览态',
    open: true,
    import: true,
    setup: async (page) => {
      await page.getByRole('button', { name: '预览' }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    id: '14-draft',
    name: '存草稿后草稿区',
    open: false,
    import: true,
    setup: async (page) => {
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: '粘贴 HTML' }).click();
      await page.waitForTimeout(300);
    },
  },
  {
    id: '15-insert-element',
    name: '插入一个按钮元素后',
    open: true,
    import: true,
    setup: async (page) => {
      await page.getByRole('button', { name: '按钮' }).first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    // T122 补：默认视口 1440×900 下对齐条 497px 能放进画布列，问题不暴露；
    // 实测 1180 时画布列约 508px 刚好放得下，1024（常见笔记本 / 分屏）才真正溢出。
    // 高度取 820 而非 720：避免与「短视口下面包屑被推到折叠线下」这条独立问题混淆，
    // 本场景只针对水平方向的溢出压力。
    // 条件是「窄视口 + 双面板展开 + 有选中（8 个按钮全部启用）」——
    // 此时对齐条右端会压到右侧样式面板底下，末位按钮中心点被接管、点了没反应也看不出来。
    id: '16-narrow-panels-open',
    name: '窄视口 1024×820 + 双面板 + 多选（对齐条溢出压力）',
    open: true,
    import: true,
    viewport: { width: 1024, height: 820 },
    setup: async (page) => {
      const fr = page.frameLocator('#ep-canvas-frame');
      const cards = fr.locator('.card');
      await cards.nth(0).click();
      await cards.nth(1).click({ modifiers: ['Shift'] });
      await page.waitForTimeout(250);
    },
  },
  {
    // T123 补：T122 的 16 个场景全是「点击 / 多选 / 拖拽」后的状态，**没有一个是纯悬停**，
    // 而且几何检测看不见「位置没错但整页被染了色」。下面两个场景专打那个盲区，
    // 且都是「在缺陷活着的那一刻取快照」：
    //   17 —— 指针停在画布空白处不动（大面积着色，量 bigTint）
    //   18 —— 悬停真实元素后把指针移出画布（高亮滞留，量 staleHover）
    // 二者不能合并成一个场景：一旦指针移出，17 的着色会被 18 要测的撤销逻辑清掉。
    id: '17-hover-blank-stay',
    name: '悬停画布空白区并停住（大面积着色遮挡）',
    open: false,
    import: true,
    fixture: SHORT_FIXTURE,
    setup: async (page) => {
      const fr = await page.locator('#ep-canvas-frame').boundingBox();
      if (!fr) return;
      const x = fr.x + fr.width - 40;
      const y = fr.y + fr.height - 30;
      await page.mouse.move(x, y);
      await page.waitForTimeout(250);
      // 告诉审计函数「指针此刻在哪」—— 见 AUDIT_FN 第 10 条
      await page.evaluate((p) => { window.__epAuditMouse = p; }, { x, y });
    },
  },
  {
    id: '18-hover-then-leave',
    name: '悬停元素后指针移出画布（高亮滞留）',
    open: true,
    import: true,
    setup: async (page) => {
      const fr = await page.locator('#ep-canvas-frame').boundingBox();
      if (!fr) return;
      // 先悬停一个真实元素，确保高亮曾经亮起
      await page.mouse.move(fr.x + 80, fr.y + 120);
      await page.waitForTimeout(200);
      // 再移到顶栏（真实用户去调样式的动作）
      await page.mouse.move(700, 20);
      await page.waitForTimeout(250);
      await page.evaluate((p) => { window.__epAuditMouse = p; }, { x: 700, y: 20 });
    },
  },
];

// ── 起服务 ────────────────────────────────────────────────────────────
let server = null;
let base = EXTERNAL_BASE;
if (!base) {
  const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js');
  server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  base = `http://localhost:${PORT}`;
  const deadline = Date.now() + 25000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try {
      up = (await fetch(base)).status < 500;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!up) {
    console.error('preview 服务未就绪');
    server.kill();
    process.exit(1);
  }
}

const origin = new URL(base).origin;
const browser = await chromium.launch();
const results = [];

try {
  for (const sc of SCENARIOS) {
    if (ONLY && !sc.id.startsWith(ONLY)) continue;
    const ctx = await browser.newContext({
      viewport: sc.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      storageState: storageStateFor(origin, sc.open ? OPEN_ALL : CLOSED_ALL),
    });
    const page = await ctx.newPage();
    const logs = [];
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') logs.push(`[error] ${m.text()}`);
    });

    const rec = { id: sc.id, name: sc.name, ok: true };
    try {
      await page.goto(`${base}/`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(500);

      if (sc.import) {
        // 空态浮层里导入：导入成功后浮层自动收起，再按需展开面板
        const src = sc.fixture ?? FIXTURE;
        await page.locator('textarea').fill(src);
        await page.getByRole('button', { name: '导入 HTML' }).click();
        await page.waitForTimeout(700);
        if (sc.open) {
          // 面板若因导入后的默认态收起，这里显式展开到位
          const left = await page.locator('#ep-app').getAttribute('data-left');
          if (left !== 'open') await page.locator('.ep-topbar__toggle[data-panel="left"]').click();
          const right = await page.locator('#ep-app').getAttribute('data-right');
          if (right !== 'open') await page.locator('.ep-topbar__toggle[data-panel="right"]').click();
          await page.waitForTimeout(250);
        }
      }

      if (sc.setup) await withTimeout(sc.setup(page, sc.fixture ?? FIXTURE), 20000, sc.id + ' setup');

      const audit = await page.evaluate(AUDIT_FN);
      rec.audit = audit;
      rec.logs = logs;
      await page.screenshot({ path: resolve(SHOTS, `${sc.id}.png`) });
      rec.shot = `qa/audit/shots/${sc.id}.png`;
    } catch (e) {
      rec.ok = false;
      rec.error = e.message.split('\n')[0];
      await page.screenshot({ path: resolve(SHOTS, `${sc.id}-FAILED.png`) }).catch(() => {});
    } finally {
      await ctx.close();
    }
    results.push(rec);
    const bad = rec.audit
      ? (rec.audit.truncated?.length || 0) +
        (rec.audit.zeroSize?.length || 0) +
        (rec.audit.outOfViewport?.length || 0) +
        (rec.audit.overlaps?.length || 0) +
        (rec.audit.covered?.length || 0) +
        (rec.audit.regionOverflow?.length || 0) +
        (rec.audit.bigTint?.length || 0) +
        (rec.audit.staleHover?.length || 0)
      : -1;
    console.error(
      `  ${rec.ok ? 'OK  ' : 'FAIL'} ${sc.id.padEnd(26)} 异常项=${bad}${rec.error ? ' :: ' + rec.error : ''}`,
    );
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

const reportPath = resolve(here, 'report.json');
writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log('REPORT ' + JSON.stringify({ reportPath, shotsDir: SHOTS, count: results.length }));
for (const r of results) {
  console.log(
    `${r.ok ? 'OK  ' : 'FAIL'} ${r.id} :: 截断=${r.audit?.truncated?.length ?? '-'} 零尺寸=${r.audit?.zeroSize?.length ?? '-'} 越界=${r.audit?.outOfViewport?.length ?? '-'} 重叠=${r.audit?.overlaps?.length ?? '-'} 遮挡=${r.audit?.covered?.length ?? '-'} 溢出=${r.audit?.regionOverflow?.length ?? '-'} 大着色=${r.audit?.bigTint?.length ?? '-'} 滞留=${r.audit?.staleHover?.length ?? '-'}${r.error ? ' err=' + r.error : ''}`,
  );
}
process.exit(0);
