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

test('临界判定：精确总量略超限额、舍入后相等时判超限', async ({ page }) => {
  // 0.42 lx × 2 min → 精确总量 0.014，舍入显示 0.01 与限额相等，但应判超限
  await page.getByTestId('exhibit-name').fill('纸质文献');
  await page.getByTestId('shift-start').fill('2026-09-14T10:00');
  await page.getByTestId('shift-end').fill('2026-09-14T10:02');
  await page.getByTestId('limit').fill('0.01');

  await fillRow(page, 0, '2026-09-14T10:00', '0.42');
  await fillRow(page, 1, '2026-09-14T10:02', '0.42');

  await page.getByTestId('submit').click();

  await expect(page.getByTestId('verdict')).toHaveText('超限');
  await expect(page.getByTestId('total')).toHaveText('0.01');
  await expect(page.getByTestId('limit-value')).toHaveText('0.01');
  await expect(page.getByTestId('diff-label')).toHaveText('超出量');
  await expect(page.getByTestId('diff')).toHaveText('0.00');
});

test('表格行可删除，且至少保留两行', async ({ page }) => {
  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('point-row')).toHaveCount(3);

  await page.getByTestId('point-row').nth(1).getByTestId('remove-row').click();
  await expect(page.getByTestId('point-row')).toHaveCount(2);

  // 仅剩两行时删除按钮禁用
  await expect(page.getByTestId('remove-row').first()).toBeDisabled();
});

test('超限核算后模拟调低照度上限：转为合格并应用回表格', async ({ page }) => {
  // 跨日超限场景：总量 600，限额 500
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

  // 模拟上限 150：仅中间点 200 被压低
  await page.getByTestId('cap-input').fill('150');
  await page.getByTestId('simulate').click();

  await expect(page.getByTestId('sim-verdict')).toHaveText('合格');
  await expect(page.getByTestId('sim-total')).toHaveText('500.00');
  await expect(page.getByTestId('sim-reduction')).toHaveText('100.00');
  const capped = page.getByTestId('capped-point');
  await expect(capped).toHaveCount(1);
  await expect(capped.nth(0)).toContainText('2026-09-15 00:00');
  await expect(capped.nth(0)).toContainText('200 → 150');

  // 模拟不改变正式结论与表格
  await expect(page.getByTestId('verdict')).toHaveText('超限');
  await expect(page.getByTestId('point-row').nth(1).getByTestId('lux-input')).toHaveValue('200');

  // 应用到表格：模拟结果清除，照度写回各行，班次、限额和展品名保持不变
  await page.getByTestId('apply-simulation').click();
  await expect(page.getByTestId('simulation')).toHaveCount(0);
  const rows = page.getByTestId('point-row');
  await expect(rows.nth(0).getByTestId('lux-input')).toHaveValue('100');
  await expect(rows.nth(1).getByTestId('lux-input')).toHaveValue('150');
  await expect(rows.nth(2).getByTestId('lux-input')).toHaveValue('100');
  await expect(page.getByTestId('exhibit-name')).toHaveValue('宋代青瓷');
  await expect(page.getByTestId('limit')).toHaveValue('500');
  await expect(page.getByTestId('shift-start')).toHaveValue('2026-09-14T22:00');
  await expect(page.getByTestId('shift-end')).toHaveValue('2026-09-15T02:00');

  // 再按原核算按钮生成正式结论：合格
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('verdict')).toHaveText('合格');
  await expect(page.getByTestId('total')).toHaveText('500.00');
  await expect(page.getByTestId('diff-label')).toHaveText('剩余额');
  await expect(page.getByTestId('diff')).toHaveText('0.00');
});

test('非法模拟上限：控件旁反馈且不污染表格、正式结论与既有模拟', async ({ page }) => {
  // 先做一次合法核算：总量 120 合格
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

  // 先做一次有效模拟：上限 40 全部压低，预计总量 80
  await page.getByTestId('cap-input').fill('40');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-verdict')).toHaveText('合格');
  await expect(page.getByTestId('sim-total')).toHaveText('80.00');
  await expect(page.getByTestId('sim-reduction')).toHaveText('40.00');
  await expect(page.getByTestId('capped-point')).toHaveCount(3);

  // 非法上限：超范围
  await page.getByTestId('cap-input').fill('6000');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('cap-error')).toHaveText('模拟照度上限须在 0 至 5000 lx 之间');

  // 表格、正式结论、最近一次有效模拟均不受影响
  const rows = page.getByTestId('point-row');
  await expect(rows.nth(0).getByTestId('lux-input')).toHaveValue('50');
  await expect(rows.nth(1).getByTestId('lux-input')).toHaveValue('70');
  await expect(rows.nth(2).getByTestId('lux-input')).toHaveValue('50');
  await expect(page.getByTestId('verdict')).toHaveText('合格');
  await expect(page.getByTestId('total')).toHaveText('120.00');
  await expect(page.getByTestId('sim-total')).toHaveText('80.00');
  await expect(page.getByTestId('sim-verdict')).toHaveText('合格');

  // 非法格式：小数位过多
  await page.getByTestId('cap-input').fill('12.345');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('cap-error')).toHaveText('模拟照度上限须为最多两位小数的非负数字');
  await expect(page.getByTestId('sim-total')).toHaveText('80.00');
  await expect(page.getByTestId('total')).toHaveText('120.00');

  // 空上限
  await page.getByTestId('cap-input').fill('');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('cap-error')).toHaveText('请填写模拟照度上限');
  await expect(page.getByTestId('sim-total')).toHaveText('80.00');
  await expect(page.getByTestId('total')).toHaveText('120.00');
  await expect(rows.nth(0).getByTestId('lux-input')).toHaveValue('50');
});
