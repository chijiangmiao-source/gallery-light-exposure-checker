import { describe, expect, it } from 'vitest';
import {
  computeExposure,
  countErrors,
  fmt2,
  parseLocalDateTime,
  validateForm,
  type FormInput,
} from '../../src/lib/exposure';

/** 构造一个基础合法表单：08:00–10:00，三段照度 50/70/50，总量 120。 */
function baseForm(): FormInput {
  return {
    name: '唐代绢画',
    shiftStart: '2026-09-14T08:00',
    shiftEnd: '2026-09-14T10:00',
    limit: '120',
    rows: [
      { time: '2026-09-14T08:00', lux: '50' },
      { time: '2026-09-14T09:00', lux: '70' },
      { time: '2026-09-14T10:00', lux: '50' },
    ],
  };
}

function crossDayForm(limit: string): FormInput {
  return {
    name: '宋代青瓷',
    shiftStart: '2026-09-14T22:00',
    shiftEnd: '2026-09-15T02:00',
    limit,
    rows: [
      { time: '2026-09-14T22:00', lux: '100' },
      { time: '2026-09-15T00:00', lux: '200' },
      { time: '2026-09-15T02:00', lux: '100' },
    ],
  };
}

describe('parseLocalDateTime', () => {
  it('解析精确到分钟的本地日期时间', () => {
    const d = parseLocalDateTime('2026-09-14T22:00');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(14);
    expect(d!.getHours()).toBe(22);
    expect(d!.getMinutes()).toBe(0);
  });

  it('拒绝非法日期与非法格式', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-13-01T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-09-14 10:00')).toBeNull();
    expect(parseLocalDateTime('2026-09-14T10:00:30')).toBeNull();
    expect(parseLocalDateTime('10:00')).toBeNull();
  });
});

describe('跨日班次核算', () => {
  it('跨午夜分段：分钟数与总量正确', () => {
    const { parsed, errors } = validateForm(crossDayForm('600'));
    expect(countErrors(errors)).toBe(0);
    expect(parsed).not.toBeNull();

    const result = computeExposure(parsed!);
    expect(result.segments).toHaveLength(2);
    // 22:00 → 次日 00:00、00:00 → 02:00 各 120 分钟
    expect(result.segments[0].minutes.toString()).toBe('120');
    expect(result.segments[1].minutes.toString()).toBe('120');
    // (100+200)/2 × 120/60 = 300；(200+100)/2 × 120/60 = 300
    expect(fmt2(result.segments[0].exposure)).toBe('300.00');
    expect(fmt2(result.segments[1].exposure)).toBe('300.00');
    expect(fmt2(result.total)).toBe('600.00');
    expect(result.pass).toBe(true);
    expect(result.diffKind).toBe('remaining');
    expect(fmt2(result.diff)).toBe('0.00');
  });

  it('跨日仍要求末点等于班次结束', () => {
    const form = crossDayForm('600');
    form.rows[2].time = '2026-09-15T01:59';
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.rowErrors[2].time).toBe('末个时间点必须等于班次结束时间');
  });

  it('跨日班次结束早于开始（未跨日）时报错', () => {
    const form = crossDayForm('600');
    form.shiftEnd = '2026-09-14T21:00';
    form.rows[2].time = '2026-09-14T21:00';
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.shiftEnd).toContain('晚于班次开始');
  });
});

describe('临界舍入（四舍五入到 0.01）', () => {
  function oneMinuteForm(lux: string, limit: string): FormInput {
    return {
      name: '纸质文献',
      shiftStart: '2026-09-14T10:00',
      shiftEnd: '2026-09-14T10:01',
      limit,
      rows: [
        { time: '2026-09-14T10:00', lux },
        { time: '2026-09-14T10:01', lux },
      ],
    };
  }

  it('0.005 恰好半位，四舍五入为 0.01', () => {
    // 0.3 lx × 1 min → 0.3/60 = 0.005
    const { parsed } = validateForm(oneMinuteForm('0.3', '0.01'));
    const result = computeExposure(parsed!);
    expect(result.totalRaw.toString()).toBe('0.005');
    expect(fmt2(result.segments[0].exposure)).toBe('0.01');
    expect(fmt2(result.total)).toBe('0.01');
  });

  it('0.004833… 不足半位，舍为 0.00', () => {
    // 0.29 lx × 1 min → 0.0048333…
    const { parsed } = validateForm(oneMinuteForm('0.29', '0.01'));
    const result = computeExposure(parsed!);
    expect(fmt2(result.segments[0].exposure)).toBe('0.00');
    expect(fmt2(result.total)).toBe('0.00');
  });

  it('0.015 四舍五入为 0.02', () => {
    // 0.9 lx × 1 min → 0.015
    const { parsed } = validateForm(oneMinuteForm('0.9', '0.02'));
    const result = computeExposure(parsed!);
    expect(fmt2(result.total)).toBe('0.02');
  });

  it('总量先累加未舍入段值再舍入，而非累加已舍入段值', () => {
    // 两段各 0.29 lx × 1 min = 0.004833…，单段显示 0.00；
    // 未舍入累加 0.009666… → 总量 0.01，而不是 0.00 + 0.00 = 0.00
    const form: FormInput = {
      name: '丝织品',
      shiftStart: '2026-09-14T10:00',
      shiftEnd: '2026-09-14T10:02',
      limit: '0.01',
      rows: [
        { time: '2026-09-14T10:00', lux: '0.29' },
        { time: '2026-09-14T10:01', lux: '0.29' },
        { time: '2026-09-14T10:02', lux: '0.29' },
      ],
    };
    const { parsed } = validateForm(form);
    const result = computeExposure(parsed!);
    expect(fmt2(result.segments[0].exposure)).toBe('0.00');
    expect(fmt2(result.segments[1].exposure)).toBe('0.00');
    expect(fmt2(result.total)).toBe('0.01');
    // 判定与差额基于累加后舍入的总量
    expect(result.pass).toBe(true);
    expect(fmt2(result.diff)).toBe('0.00');
  });
});

describe('判定与差额', () => {
  function twoMinuteForm(lux: string, limit: string): FormInput {
    return {
      name: '漆器',
      shiftStart: '2026-09-14T10:00',
      shiftEnd: '2026-09-14T10:02',
      limit,
      rows: [
        { time: '2026-09-14T10:00', lux },
        { time: '2026-09-14T10:02', lux },
      ],
    };
  }

  it('总量等于限额判合格，剩余额 0.00', () => {
    // 0.6 lx × 2 min → 0.02
    const { parsed } = validateForm(twoMinuteForm('0.6', '0.02'));
    const result = computeExposure(parsed!);
    expect(fmt2(result.total)).toBe('0.02');
    expect(result.pass).toBe(true);
    expect(result.diffKind).toBe('remaining');
    expect(fmt2(result.diff)).toBe('0.00');
  });

  it('精确总量略高于限额但舍入后相等时，仍判超限', () => {
    // 0.42 lx × 2 min → 0.014：舍入显示 0.01 与限额相等，但精确值 0.014 > 0.01
    const { parsed } = validateForm(twoMinuteForm('0.42', '0.01'));
    const result = computeExposure(parsed!);
    expect(result.totalRaw.toString()).toBe('0.014');
    expect(fmt2(result.total)).toBe('0.01');
    expect(result.pass).toBe(false);
    expect(result.diffKind).toBe('excess');
    // 超出量 0.004 按同一 0.01 规则显示为 0.00
    expect(fmt2(result.diff)).toBe('0.00');
  });

  it('精确总量略低于限额但舍入后相等时，判合格', () => {
    // 0.29 lx × 2 min → 0.009666…：舍入显示 0.01 与限额相等，精确值低于限额
    const { parsed } = validateForm(twoMinuteForm('0.29', '0.01'));
    const result = computeExposure(parsed!);
    expect(fmt2(result.total)).toBe('0.01');
    expect(result.pass).toBe(true);
    expect(result.diffKind).toBe('remaining');
    expect(fmt2(result.diff)).toBe('0.00');
  });

  it('总量超出限额 0.01 判超限，超出量 0.01', () => {
    const { parsed } = validateForm(twoMinuteForm('0.6', '0.01'));
    const result = computeExposure(parsed!);
    expect(result.pass).toBe(false);
    expect(result.diffKind).toBe('excess');
    expect(fmt2(result.diff)).toBe('0.01');
  });

  it('基础表单总量 120，限额 120 合格', () => {
    const { parsed } = validateForm(baseForm());
    const result = computeExposure(parsed!);
    expect(fmt2(result.total)).toBe('120.00');
    expect(result.pass).toBe(true);
  });
});

describe('表单校验', () => {
  it('合法表单（含跨日）通过', () => {
    expect(validateForm(baseForm()).parsed).not.toBeNull();
    expect(validateForm(crossDayForm('600')).parsed).not.toBeNull();
  });

  it('必填：展品名、时间点、照度、限额', () => {
    const form = baseForm();
    form.name = '  ';
    form.limit = '';
    form.rows[1].time = '';
    form.rows[1].lux = '';
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.name).toBe('请填写展品名');
    expect(errors.limit).toBe('请填写允许暴露量');
    expect(errors.rowErrors[1].time).toBe('请填写时间点');
    expect(errors.rowErrors[1].lux).toBe('请填写照度');
  });

  it('时间边界：首点须等于班次开始', () => {
    const form = baseForm();
    form.rows[0].time = '2026-09-14T08:05';
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.rowErrors[0].time).toBe('首个时间点必须等于班次开始时间');
  });

  it('顺序：中间点必须严格递增', () => {
    const form = baseForm();
    form.rows[1].time = '2026-09-14T08:00'; // 与首点相等
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.rowErrors[1].time).toBe('时间点必须严格晚于上一行时间点');

    const form2 = baseForm();
    form2.rows[1].time = '2026-09-14T07:30'; // 倒退
    const outcome2 = validateForm(form2);
    expect(outcome2.parsed).toBeNull();
    expect(outcome2.errors.rowErrors[1].time).toBe('时间点必须严格晚于上一行时间点');
  });

  it('照度范围：0 与 5000 合法，超出或小数位过多报错', () => {
    const okLow = baseForm();
    okLow.rows[0].lux = '0';
    expect(validateForm(okLow).parsed).not.toBeNull();

    const okHigh = baseForm();
    okHigh.rows[0].lux = '5000';
    expect(validateForm(okHigh).parsed).not.toBeNull();

    const tooHigh = baseForm();
    tooHigh.rows[0].lux = '5000.01';
    expect(validateForm(tooHigh).errors.rowErrors[0].lux).toBe('照度须在 0 至 5000 lx 之间');

    const negative = baseForm();
    negative.rows[0].lux = '-1';
    expect(validateForm(negative).errors.rowErrors[0].lux).toBe('照度须为最多两位小数的非负数字');

    const tooManyDp = baseForm();
    tooManyDp.rows[0].lux = '1.234';
    expect(validateForm(tooManyDp).errors.rowErrors[0].lux).toBe('照度须为最多两位小数的非负数字');
  });

  it('限额范围：0.01 与 100000 合法，超出报错', () => {
    const okMin = baseForm();
    okMin.limit = '0.01';
    expect(validateForm(okMin).errors.limit).toBeUndefined();

    const okMax = baseForm();
    okMax.limit = '100000';
    expect(validateForm(okMax).errors.limit).toBeUndefined();

    const zero = baseForm();
    zero.limit = '0';
    expect(validateForm(zero).errors.limit).toBe('允许暴露量须在 0.01 至 100000 lx·h 之间');

    const tooBig = baseForm();
    tooBig.limit = '100000.01';
    expect(validateForm(tooBig).errors.limit).toBe('允许暴露量须在 0.01 至 100000 lx·h 之间');

    const tooManyDp = baseForm();
    tooManyDp.limit = '0.001';
    expect(validateForm(tooManyDp).errors.limit).toBe('允许暴露量须为最多两位小数的非负数字');
  });

  it('一次提交合并标出多类错误，且不产生结论', () => {
    const form: FormInput = {
      name: '',
      shiftStart: '2026-09-14T08:00',
      shiftEnd: '2026-09-14T10:00',
      limit: '0',
      rows: [
        { time: '2026-09-14T08:00', lux: '6000' },
        { time: '2026-09-14T07:59', lux: '' },
        { time: '2026-09-14T10:00', lux: '50' },
      ],
    };
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.name).toBeTruthy();
    expect(errors.limit).toBeTruthy();
    expect(errors.rowErrors[0].lux).toBe('照度须在 0 至 5000 lx 之间');
    expect(errors.rowErrors[1].time).toBe('时间点必须严格晚于上一行时间点');
    expect(errors.rowErrors[1].lux).toBe('请填写照度');
    expect(countErrors(errors)).toBe(5);
  });

  it('非法日期时间点被标出', () => {
    const form = baseForm();
    form.rows[1].time = '2026-02-30T09:00';
    const { parsed, errors } = validateForm(form);
    expect(parsed).toBeNull();
    expect(errors.rowErrors[1].time).toBe('时间点须为精确到分钟的完整本地日期时间');
  });
});
