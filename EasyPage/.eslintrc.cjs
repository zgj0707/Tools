/**
 * ESLint 配置（遗留 .eslintrc.cjs 格式，配合 eslint@8）。
 * import 边界（契约 01 §3，T001 落地、T003 复核）：
 *  - src/core/** 禁止 import src/app/** 与 src/adapters/**（第三方包：core 目前无任何 import，
 *    完整第三方包拦截在 T003 纳入已登记依赖白名单后补全，与卡片 step5「T003 补全」一致）。
 *  - src/app/** 禁止 import adapters / platforms：适配器实现只能由
 *    src/platforms/web/composition.ts 注入，app 仅依赖 core/ports 的类型。
 *  - src/app/** 禁止直接 import 第三方交互/编辑库（占位规则，T003 补全包名）。
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', 'playwright-report', 'test-results', 'qa/report'],
  settings: {
    // import/no-restricted-paths 必须先能解析 import 目标，否则规则静默失效。
    // 2026-09-22 复现：未配 resolver 时，app/ 下探针文件 import adapters 也不报错
    // —— 即此前的 core→app/adapters 边界一直是"纸面规则"。
    'import/resolver': {
      node: { extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx'] },
    },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // core 纯逻辑 + 端口：不得依赖外壳(app)、适配器(adapters)、装配层(platforms)
      files: ['src/core/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              { target: './src/core', from: './src/app' },
              { target: './src/core', from: './src/adapters' },
              { target: './src/core', from: './src/platforms' },
            ],
          },
        ],
      },
    },
    {
      // 外壳：只依赖 core 与自身。具体适配器一律由 platforms/** 注入。
      // 2026-09-22 补：此前只挡住 core→app/adapters，app→adapters 无人拦，
      // 装配根因此漂到 App.ts 尾部（889 行的类里 new 三个适配器）。
      files: ['src/app/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              { target: './src/app', from: './src/adapters' },
              { target: './src/app', from: './src/platforms' },
            ],
          },
        ],
      },
    },
  ],
};
