import { expect, test } from '@playwright/test';

test('首页渲染应用标题', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('易页 EasyPage')).toBeVisible();
});
