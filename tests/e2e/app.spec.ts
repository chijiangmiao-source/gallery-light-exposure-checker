import { expect, test, type Page } from '@playwright/test';

async function fillRow(page: Page, index: number, time: string, lux: string) {
  const row = page.getByTestId('point-row').nth(index);
  await row.getByTestId('time-input').fill(time);
  await row.getByTestId('lux-input').fill(lux);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('表格录入：添加时间点并提交，得到合格结论与逐段算式', async ({ page }) => {
  await page.getByTestId('exhibit-name').fill('唐代绢画');
  await page.getByTestId('shift-start').fill('2026-09-14T08:00');
  await page.getByTestId('shift-end').fill('2026-09-14T10:00');
  await page.getByTestId('limit').fill('120');

  // 默认两行，添加一行后共三个时间点
  await expect(page.getByTestId('point-row')).toHaveCount(2);
  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('point-row')).toHaveCount(3);

  await fillRow(page, 0, '2026-09-14T08:00', '50');
  await fillRow(page, 1, '2026-09-14T09:00', '70');
  await fillRow(page, 2, '2026-09-14T10:00', '50');

  await page.getByTestId('submit').click();

  // 唯一判定：合格
  await expect(page.getByTestId('verdict')).toHaveText('合格');
  await expect(page.getByTestId('total')).toHaveText('120.00');
  await expect(page.getByTestId('limit-value')).toHaveText('120.00');
  await expect(page.getByTestId('diff-label')).toHaveText('剩余额');
  await expect(page.getByTestId('diff')).toHaveText('0.00');

  // 逐段算式
  const segments = page.getByTestId('segment');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0)).toContainText('2026-09-14 08:00 → 2026-09-14 09:00');
  await expect(segments.nth(0)).toContainText('(50 + 70) ÷ 2 × 60 min ÷ 60');
  await expect(segments.nth(0)).toContainText('60.00 lx·h');
  await expect(segments.nth(1)).toContainText('(70 + 50) ÷ 2 × 60 min ÷ 60');

  // 无错误提示
  await expect(page.getByTestId('error-summary')).toHaveCount(0);
});

test('跨日班次：超限结论与超出量', async ({ page }) => {
  await page.getByTestId('exhibit-name').fill('宋代青瓷');
  await page.getByTestId('shift-start').fill('2026-09-14T22:00');
  await page.getByTestId('shift-end').fill('2026-09-15T02:00');
  await page.getByTestId('limit').fill('500');

  await page.getByTestId('add-row').click();
  await fillRow(page, 0, '2026-09-14T22:00', '100');
  await fillRow(page, 1, '2026-09-15T00:00', '200');
  await fillRow(page, 2, '2026-09-15T02:00', '100');

  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveText('超限');
  await expect(page.getByTestId('total')).toHaveText('600.00');
  await expect(page.getByTestId('diff-label')).toHaveText('超出量');
  await expect(page.getByTestId('diff')).toHaveText('100.00');
  await expect(page.getByTestId('segment')).toHaveCount(2);
});

test('非法提交：合并标出对应行、保留输入且不更新旧结论', async ({ page }) => {
  // 先做一次合法提交，得到旧结论
  await page.getByTestId('exhibit-name').fill('唐代绢画');
  await page.getByTestId('shift-start').fill('2026-09-14T08:00');
  await page.getByTestId('shift-end').fill('2026-09-14T10:00');
  await page.getByTestId('limit').fill('120');
  await page.getByTestId('add-row').click();
  await fillRow(page, 0, '2026-09-14T08:00', '50');
  await fillRow(page, 1, '2026-09-14T09:00', '70');
  await fillRow(page, 2, '2026-09-14T10:00', '50');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveText('合格');

  // 制造多类错误：照度超范围、时间点缺失、末点不等于班次结束
  const rows = page.getByTestId('point-row');
  await rows.nth(0).getByTestId('lux-input').fill('6000');
  await rows.nth(1).getByTestId('time-input').fill('');
  await rows.nth(2).getByTestId('time-input').fill('2026-09-14T11:00');
  await page.getByTestId('submit').click();

  // 合并标出对应行
  await expect(page.getByTestId('error-summary')).toBeVisible();
  await expect(page.getByTestId('error-summary')).toContainText('处错误');
  await expect(page.getByTestId('row-0-lux-error')).toHaveText('照度须在 0 至 5000 lx 之间');
  await expect(page.getByTestId('row-1-time-error')).toHaveText('请填写时间点');
  await expect(page.getByTestId('row-2-time-error')).toHaveText('末个时间点必须等于班次结束时间');

  // 输入保留
  await expect(rows.nth(0).getByTestId('lux-input')).toHaveValue('6000');
  await expect(rows.nth(2).getByTestId('time-input')).toHaveValue('2026-09-14T11:00');

  // 旧结论不更新
  await expect(page.getByTestId('verdict')).toHaveText('合格');
  await expect(page.getByTestId('total')).toHaveText('120.00');
});

test('表格行可删除，且至少保留两行', async ({ page }) => {
  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('point-row')).toHaveCount(3);

  await page.getByTestId('point-row').nth(1).getByTestId('remove-row').click();
  await expect(page.getByTestId('point-row')).toHaveCount(2);

  // 仅剩两行时删除按钮禁用
  await expect(page.getByTestId('remove-row').first()).toBeDisabled();
});
