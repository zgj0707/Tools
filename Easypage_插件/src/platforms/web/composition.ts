// 装配根（composition root，契约 01 §4）：把适配器实现注入 app。
//
// 这是全仓库唯一允许 `new` 具体适配器的位置。app/ 与 core/ 只依赖 core/ports 里的
// 类型，由 .eslintrc.cjs 的 import/no-restricted-paths 强制约束：
//   · src/core/** 不得 import app / adapters / platforms
//   · src/app/**  不得 import adapters / platforms
//
// 换实现（换解析器 / 换交互库 / 换宿主）只改本文件，不动 app/ 与 core/。

import { App } from '../../app/App';
import { DomParserIO } from '../../adapters/dom/DomParserIO';
import { IFramePreviewSandbox } from '../../adapters/preview/IFramePreviewSandbox';
import { SelfInteractionAdapter } from '../../adapters/interaction/SelfInteractionAdapter';
import type {
  AppPlatform,
  HtmlIO,
  InteractionAdapter,
  PreviewSandbox,
} from '../../core/ports';

/** Web 平台：宿主页面 + 双 iframe（编辑帧 allow-same-origin / 预览帧 allow-scripts）。 */
export const webPlatform: AppPlatform = {
  createIO: (): HtmlIO => new DomParserIO(),
  createPreview: (host: HTMLElement): PreviewSandbox => new IFramePreviewSandbox(host),
  createInteraction: (container: HTMLElement, frame: HTMLElement | null): InteractionAdapter =>
    new SelfInteractionAdapter(container, frame),
};

/** 入口装配：构造 App 并挂载。 */
export function createApp(root: HTMLElement): App {
  const app = new App(root, webPlatform);
  app.mount();
  return app;
}
