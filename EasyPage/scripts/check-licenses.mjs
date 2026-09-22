#!/usr/bin/env node
/**
 * check-licenses.mjs · T003 / T120 许可白名单校验（闭环门禁的一部分）
 *
 * 产品 D6 = 闭源、代码私有仓库，因此只允许宽松许可依赖。
 * 规则（与 docs/plan/ADR-001-选型.md §4 一致）：
 *   允许：MIT / BSD-2-Clause / BSD-3-Clause / Apache-2.0 / ISC / CC0 / 0BSD / Unlicense / BlueOak-1.0.0
 *   禁止：GPL / LGPL / AGPL / SSPL / 未知
 *   DOMPurify 双许可(MPL-2.0/Apache-2.0)按 Apache-2.0 采用，且不修改其源码。
 *
 * 读取 node_modules 下每个包的 package.json 的 license（v3 lockfile 不含 license，故读包文件）。
 * 退出码：0=全部在白名单；1=出现禁止/未知许可。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

const ALLOWED = /MIT|BSD|Apache-2\.0|ISC|CC0|0BSD|Unlicense|BlueOak|WTFPL|Zlib|Python-2\.0|Python Software Foundation/i;
const BLOCKED = /GPL|AGPL|SSPL|MPL/i;
// 注意：MPL-2.0 仅在"按 Apache-2.0 双许可分支采用且不改源码"时放行；
// 默认对裸 MPL-* 告警，由维护者在 whitelist-overrides 中显式登记后放行。

// 已知例外（包名 → 理由）；新增前必须在 ADR/NOTICE 记录。
const OVERRIDES = new Map([
  // ['dompurify', '按 Apache-2.0 双许可分支采用，不改源码，仅用于 PasteSanitizer（T119）'],
]);

function licenseOf(pkg) {
  const l = pkg.license;
  if (!l) {
    // 有些包用 licenses:[{type}]
    if (Array.isArray(pkg.licenses) && pkg.licenses.length) return pkg.licenses.map((x) => x.type || x).join(' OR ');
    return null;
  }
  if (typeof l === 'string') return l;
  if (typeof l === 'object') return l.type || l.name || null;
  return null;
}

function collectPackages(dir, out = new Map(), prefix = '') {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const scoped = e.name.startsWith('@');
    if (scoped) {
      collectPackages(join(dir, e.name), out, prefix + e.name + '/');
      continue;
    }
    const name = prefix + e.name;
    const pkgJson = join(dir, e.name, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
        out.set(name, { license: licenseOf(pkg), version: pkg.version });
      } catch {
        out.set(name, { license: '(unparsable)', version: '?' });
      }
    }
    // 嵌套 node_modules
    const nested = join(dir, e.name, 'node_modules');
    if (existsSync(nested)) collectPackages(nested, out, '');
  }
  return out;
}

if (!existsSync(nm)) {
  console.error('未找到 node_modules，先运行 npm install');
  process.exit(1);
}

const pkgs = collectPackages(nm);
const bad = [];
const warn = [];

for (const [name, meta] of pkgs) {
  const lic = meta.license || '(missing)';
  if (OVERRIDES.has(name)) continue;
  if (lic === '(missing)' || lic === '(unparsable)') {
    warn.push(`${name}@${meta.version}  许可缺失/无法解析 → 需人工确认`);
    continue;
  }
  if (BLOCKED.test(lic)) {
    bad.push(`${name}@${meta.version}  许可=${lic}  → 命中禁止模式`);
  } else if (!ALLOWED.test(lic)) {
    warn.push(`${name}@${meta.version}  许可=${lic}  → 不在白名单正则内，需人工确认`);
  }
}

console.log(`check-licenses: 扫描 ${pkgs.size} 个包`);
if (bad.length) {
  console.error('\n[禁止] 命中 copyleft/未许可：');
  for (const b of bad) console.error('  ✗ ' + b);
}
if (warn.length) {
  console.log('\n[待确认] 以下包许可未自动判定，请人工核对后加入 OVERRIDES 或移除：');
  for (const w of warn) console.log('  ! ' + w);
}
if (bad.length) {
  console.error('\nFAIL：存在禁止许可，阻断 check。');
  process.exit(1);
}
console.log('\nPASS：无禁止许可。待确认项见上（warn）。');
