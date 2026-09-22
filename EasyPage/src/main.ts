import { EP } from './constants';
import { createApp } from './platforms/web/composition';
import { t } from './app/i18n/zh-CN';

const root = document.getElementById(EP.APP_ROOT);
if (!root) {
  throw new Error(`缺少挂载节点 #${EP.APP_ROOT}`);
}

document.title = t('app.title');
createApp(root);
