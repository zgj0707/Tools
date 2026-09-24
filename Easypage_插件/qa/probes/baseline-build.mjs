// 基线产物构建 —— 为「改造前后对照」产出一份旧版 dist/index.html。
//
// 用法:
//   node qa/probes/baseline-build.mjs <commit-ish> <标签> [输出目录]
//   例: node qa/probes/baseline-build.mjs dde3df4 before qa/report/ui-refactor-p1
//       → 生成 qa/report/ui-refactor-p1/before.html（并打印体积）
//
// 【为什么不临时回滚工作树】
// 临时 `git checkout <sha> -- src/` 再改回来，一旦中途出错就把工作树留在半旧半新的状态，
// 事后很难判断「哪几处其实没还原」。这里改用 `git archive` 把目标提交导出到临时目录，
// 当前工作树一个字节都不动，可反复执行、可并行执行。
//
// 【为什么要挂 node_modules 联接】
// vite 打包时从**导入方所在目录**向上解析依赖（源码里的 idb / parse5），
// 导出目录里没有 node_modules 就解析不到。用 junction（目录联接）最省：不需要管理员权限、
// 不复制上万个文件。
//
// 【踩过的坑】用 `cmd //c mklink /J` 建联接在 Git Bash 下不可靠 —— `/J` 会被 MSYS 当成路径转换掉，
// 命令退化成「打开一个新的 cmd」且不报错。直接用 Node 的 `fs.symlinkSync(src, dst, 'junction')`
// 反而干净。同理，绝不能把 Windows 路径写成 `'C:\\a\\b'` 塞进 `node -e "..."`：反斜杠会被 shell
// 吃掉，路径里混进换行和随机字符。路径一律用正斜杠（Node 在 Windows 上接受）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, symlinkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const [commitish, label, outDirArg] = process.argv.slice(2);
if (!commitish || !label) {
  throw new Error('用法: node qa/probes/baseline-build.mjs <commit-ish> <标签> [输出目录]');
}
const outDir = resolve(outDirArg ?? 'qa/report');
mkdirSync(outDir, { recursive: true });

const repo = process.cwd();
const sandbox = join(tmpdir(), `easypage-baseline-${label}`);

// 1) 导出目标提交（不含 node_modules / dist，它们在 .gitignore 里）
if (existsSync(sandbox)) {
  console.log(`· 复用已有导出目录 ${sandbox}`);
} else {
  mkdirSync(sandbox, { recursive: true });
  const archive = spawnSync('git', ['archive', commitish], { cwd: repo, maxBuffer: 1 << 28 });
  if (archive.status !== 0) throw new Error(`git archive ${commitish} 失败: ${archive.stderr}`);
  const untar = spawnSync('tar', ['-x', '-C', sandbox], { input: archive.stdout, maxBuffer: 1 << 28 });
  if (untar.status !== 0) throw new Error(`解包失败: ${untar.stderr}`);
  console.log(`· 已导出 ${commitish} → ${sandbox}`);
}

// 2) 挂依赖目录联接
const modulesDst = join(sandbox, 'node_modules');
if (!existsSync(modulesDst)) {
  symlinkSync(join(repo, 'node_modules'), modulesDst, 'junction');
  console.log(`· node_modules 联接 → ${realpathSync(modulesDst)}`);
}
if (!existsSync(join(modulesDst, 'vite', 'package.json'))) {
  throw new Error('联接里解析不到 vite —— 依赖目录不对');
}

// 3) 在导出目录内构建（root = cwd，配置就地取该提交自己的 vite.config.ts）
const viteBin = join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
const build = spawnSync(process.execPath, [viteBin, 'build'], { cwd: sandbox, stdio: 'inherit' });
if (build.status !== 0) throw new Error('基线构建失败');

// 4) 另存为对照用产物
const built = join(sandbox, 'dist', 'index.html');
const target = join(outDir, `${label}.html`);
copyFileSync(built, target);
const kb = (statSync(target).size / 1024).toFixed(2);
console.log(`\n✓ ${target}  (${kb} kB)`);
console.log(`  下一步: node qa/audit/batch1-evidence.mjs ${target} ${outDir} ${label}`);
