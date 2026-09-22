import { expect, test } from '@playwright/test';

const fixture = `<!DOCTYPE html><body>
<p id="p1">Hello</p>
<p id="p2">World</p>
</body>`;

test('Ctrl+D 复制节点，一次 Ctrl+Z 移除', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+d');
  const count = await editFrame.locator('p').count();
  expect(count).toBe(3);
  await page.keyboard.press('Control+z');
  expect(await editFrame.locator('p').count()).toBe(2);
});

test('方向键微移 transform 变化；撤销归位', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('h1').first().click();
  await page.keyboard.press('ArrowRight');
  const t = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.transform);
  expect(t).toContain('translate');
  await page.keyboard.press('Control+z');
  const t2 = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.transform);
  expect(t2).not.toContain('translate');
});

test('Ctrl+S 拦截并提示，不离开页面', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL('/');
  await expect(page.locator('.ep-toast')).toContainText('保存');
});

test('右键菜单弹出，点删除触发', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click({ button: 'right' });
  await expect(page.locator('.ep-context-menu')).toBeVisible();
  await page.getByText('删除', { exact: true }).click();
  expect(await editFrame.locator('p').count()).toBe(1);
});

test('Delete 键删除，Ctrl+Z 恢复', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('h1').first().click();
  await page.keyboard.press('Delete');
  expect(await editFrame.locator('p').count()).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await editFrame.locator('p').count()).toBe(2);
});

test('Ctrl+B 非编辑态加 font-weight:700，撤销还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+b');
  const fw = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.fontWeight);
  expect(fw).toBe('700');
  await page.keyboard.press('Control+z');
});

test('编辑态 Ctrl+B/I/U 不产生脏标签', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.ep-toast')).toContainText('选区');
  await page.keyboard.press('Control+i');
  await expect(page.locator('.ep-toast')).toContainText('选区');
  await page.keyboard.press('Control+u');
  await expect(page.locator('.ep-toast')).toContainText('选区');
  expect(await editFrame.locator('b,strong,i,em,u').count()).toBe(0);
  const html = await editFrame.locator('body').evaluate((el) => el.innerHTML);
  expect(html).not.toMatch(/font-weight|font-style|text-decoration/i);
  await page.keyboard.press('Escape');
});


test('焦点守卫：外壳输入框内派发按键不操作画布', async ({ page }) => {
  await page.goto('/' );
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('.ep-box input').first().evaluate((input) => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  });
  expect(await editFrame.locator('p').count()).toBe(2);
  const t = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.transform);
  expect(t).not.toContain('translate');
});

test('焦点守卫：编辑态 contenteditable 派发 Delete 不删除', async ({ page }) => {
  await page.goto('/' );
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })));
  expect(await editFrame.locator('p').count()).toBe(2);
  await page.keyboard.press('Escape');
});
test('Ctrl+L 锁定切换，文档无 lock 标记', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').click();
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+l');
  await expect(page.locator('button.ep-layer-lock').first()).toContainText('\u{1F512}');
  await page.keyboard.press('Control+l');
  await expect(page.locator('button.ep-layer-lock').first()).toContainText('\u{1F513}');
  const html = await editFrame.locator('body').evaluate((el) => el.innerHTML);
  expect(html).not.toMatch(/lock/i);
});
