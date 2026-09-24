import { expect, test } from '@playwright/test';

// 画布/预览内的导航拦截。
// 缺陷：编辑帧与预览帧都是 srcdoc iframe，其 base URL 继承父页 URL，
// 因此 `<a href="#">` 会解析成应用自身 URL（不是 about:srcdoc），点击即整帧导航，
// 把编辑文档/预览内容覆盖掉，且没有任何返回入口。
//
// 注意：必须用真实点击（locator.click），不能用浏览器内合成 MouseEvent ——
// 合成事件本来就不会触发原生导航，preventDefault 是否生效都测不出来。

const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>画布导航拦截</title></head>
<body>
  <p id="p1">正文未动</p>
  <a id="lnk" href="#">点我</a>
  <form id="f1" action="/nowhere"><button id="sub" type="submit">提交</button></form>
</body>
</html>`;

/** 读编辑帧当前 URL：编辑帧带 allow-same-origin，父页可直接读。 */
function canvasHref(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const f = document.getElementById('ep-canvas-frame') as HTMLIFrameElement | null;
    return f?.contentWindow?.location.href ?? '';
  });
}

test('画布导航拦截：点链接 / 表单提交 / 中键点击都不离开编辑帧', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const edit = page.frameLocator('#ep-canvas-frame');
  await expect(edit.locator('#p1')).toHaveText('正文未动');

  const before = await canvasHref(page);
  expect(before).toContain('srcdoc');

  // (a) 左键点 <a href="#">：若未拦截，帧 URL 变成应用自身 URL
  await edit.locator('#lnk').click();
  expect(await canvasHref(page)).toBe(before);
  await expect(edit.locator('#p1')).toHaveText('正文未动');

  // (b) 提交表单：若未拦截，帧导航到 action
  await edit.locator('#sub').click();
  expect(await canvasHref(page)).toBe(before);
  await expect(edit.locator('#p1')).toHaveText('正文未动');

  // (c) 中键点链接（auxclick）
  await edit.locator('#lnk').click({ button: 'middle' });
  expect(await canvasHref(page)).toBe(before);
  await expect(edit.locator('#p1')).toHaveText('正文未动');
});

test('预览导航拦截：点链接后预览内容仍在', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.getByRole('button', { name: '预览' }).click();

  const preview = page.frameLocator('#ep-preview-frame');
  await expect(preview.locator('#p1')).toHaveText('正文未动');

  // 预览帧跨源隔离，父页读不到其 URL，故用「内容是否还在」作为行为断言
  await preview.locator('#lnk').click();
  await expect(preview.locator('#p1')).toHaveText('正文未动');
});
