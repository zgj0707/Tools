/**
 * ESLint 配置（遗留 .eslintrc.cjs 格式，配合 eslint@8）。
 * import 边界（契约 01 §3，T001 落地、T003 复核）：
 *  - src/core/** 禁止 import src/app/** 与 src/adapters/**（第三方包：core 目前无任何 import，
 *    完整第三方包拦截在 T003 纳入已登记依赖白名单后补全，与卡片 step5「T003 补全」一致）。
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
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // core 纯逻辑 + 端口：不得依赖外壳(app)与适配器(adapters)
      files: ['src/core/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              { target: './src/core', from: './src/app' },
              { target: './src/core', from: './src/adapters' },
            ],
          },
        ],
      },
    },
  ],
};
