import { Decimal } from 'decimal.js';

/**
 * 展品照度暴露核算核心逻辑（纯函数，不依赖 DOM）。
 *
 * 规则：
 * - 相邻区间暴露量 = (前值 + 后值) ÷ 2 × 分钟差 ÷ 60，使用 decimal.js 十进制定点运算；
 * - 各段与总量展示时四舍五入到 0.01 lx·h，但总量必须先累加未舍入段值再舍入；
 * - 判定以未舍入的精确总量为准：精确总量 ≤ 限额判合格，否则超限（即使舍入后的
 *   显示值与限额相等）；剩余额 / 超出量按同一 0.01 规则展示。
 */

export const LUX_MIN = new Decimal(0);
export const LUX_MAX = new Decimal(5000);
export const LIMIT_MIN = new Decimal('0.01');
export const LIMIT_MAX = new Decimal(100000);

export const ROUND_MODE = Decimal.ROUND_HALF_UP;

/** 完整本地日期时间，精确到分钟：YYYY-MM-DDTHH:mm */
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** 非负数字，最多两位小数 */
const AMOUNT_2DP_RE = /^\d+(\.\d{1,2})?$/;

/** 解析本地日期时间字符串；非法日期（如 02-30）或格式不符返回 null。 */
export function parseLocalDateTime(value: string): Date | null {
  const m = DATETIME_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

/** 解析“最多两位小数的非负数字”；不合法返回 null。 */
export function parseAmount2(value: string): Decimal | null {
  const v = value.trim();
  if (!AMOUNT_2DP_RE.test(v)) return null;
  return new Decimal(v);
}

/** 四舍五入到 0.01。 */
export function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, ROUND_MODE);
}

/** 以两位小数展示。 */
export function fmt2(d: Decimal): string {
  return d.toFixed(2);
}

/** 以 YYYY-MM-DD HH:mm 展示本地时间。 */
export function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 表单校验
// ---------------------------------------------------------------------------

export interface RowInput {
  time: string;
  lux: string;
}

export interface FormInput {
  name: string;
  shiftStart: string;
  shiftEnd: string;
  limit: string;
  rows: RowInput[];
}

export interface RowErrors {
  time?: string;
  lux?: string;
}

/** 一次提交的全部错误：字段级 + 逐行合并标出。 */
export interface FormErrors {
  name?: string;
  shiftStart?: string;
  shiftEnd?: string;
  limit?: string;
  /** 时间点表整体错误（如行数不足） */
  rows?: string;
  /** 与输入行一一对应 */
  rowErrors: RowErrors[];
}

export function countErrors(e: FormErrors): number {
  let n = 0;
  if (e.name) n += 1;
  if (e.shiftStart) n += 1;
  if (e.shiftEnd) n += 1;
  if (e.limit) n += 1;
  if (e.rows) n += 1;
  for (const r of e.rowErrors) {
    if (r.time) n += 1;
    if (r.lux) n += 1;
  }
  return n;
}

export interface ParsedRow {
  time: Date;
  lux: Decimal;
  /** 用户原始输入，用于算式展示 */
  luxText: string;
}

export interface ParsedForm {
  name: string;
  shiftStart: Date;
  shiftEnd: Date;
  limit: Decimal;
  rows: ParsedRow[];
}

export interface ValidationResult {
  errors: FormErrors;
  /** 仅当完全合法时存在 */
  parsed: ParsedForm | null;
}

export function validateForm(input: FormInput): ValidationResult {
  const errors: FormErrors = { rowErrors: input.rows.map(() => ({})) };

  // 展品名
  const name = input.name.trim();
  if (!name) errors.name = '请填写展品名';

  // 班次起止
  const startText = input.shiftStart.trim();
  let shiftStart: Date | null = null;
  if (!startText) {
    errors.shiftStart = '请填写班次开始时间';
  } else {
    shiftStart = parseLocalDateTime(startText);
    if (!shiftStart) errors.shiftStart = '班次开始须为精确到分钟的完整本地日期时间';
  }

  const endText = input.shiftEnd.trim();
  let shiftEnd: Date | null = null;
  if (!endText) {
    errors.shiftEnd = '请填写班次结束时间';
  } else {
    shiftEnd = parseLocalDateTime(endText);
    if (!shiftEnd) errors.shiftEnd = '班次结束须为精确到分钟的完整本地日期时间';
  }

  if (shiftStart && shiftEnd && shiftEnd.getTime() <= shiftStart.getTime()) {
    errors.shiftEnd = '班次结束必须晚于班次开始（允许跨日）';
  }

  // 允许暴露量
  let limit: Decimal | null = null;
  const limitText = input.limit.trim();
  if (!limitText) {
    errors.limit = '请填写允许暴露量';
  } else {
    const parsed = parseAmount2(limitText);
    if (!parsed) {
      errors.limit = '允许暴露量须为最多两位小数的非负数字';
    } else if (parsed.lt(LIMIT_MIN) || parsed.gt(LIMIT_MAX)) {
      errors.limit = '允许暴露量须在 0.01 至 100000 lx·h 之间';
    } else {
      limit = parsed;
    }
  }

  // 时间点表
  if (input.rows.length < 2) {
    errors.rows = '至少需要两个时间点，首末须分别等于班次起止';
  }

  const times: (Date | null)[] = [];
  const luxes: (Decimal | null)[] = [];

  input.rows.forEach((row, i) => {
    const rowErr = errors.rowErrors[i];

    const timeText = row.time.trim();
    if (!timeText) {
      rowErr.time = '请填写时间点';
      times.push(null);
    } else {
      const t = parseLocalDateTime(timeText);
      if (!t) {
        rowErr.time = '时间点须为精确到分钟的完整本地日期时间';
        times.push(null);
      } else {
        times.push(t);
      }
    }

    const luxText = row.lux.trim();
    if (!luxText) {
      rowErr.lux = '请填写照度';
      luxes.push(null);
    } else {
      const lux = parseAmount2(luxText);
      if (!lux) {
        rowErr.lux = '照度须为最多两位小数的非负数字';
        luxes.push(null);
      } else if (lux.lt(LUX_MIN) || lux.gt(LUX_MAX)) {
        rowErr.lux = '照度须在 0 至 5000 lx 之间';
        luxes.push(null);
      } else {
        luxes.push(lux);
      }
    }
  });

  // 时间边界：首末点分别等于班次起止
  if (input.rows.length >= 1 && shiftStart && times[0] && times[0].getTime() !== shiftStart.getTime()) {
    errors.rowErrors[0].time = '首个时间点必须等于班次开始时间';
  }
  const last = input.rows.length - 1;
  if (input.rows.length >= 1 && shiftEnd && times[last] && times[last].getTime() !== shiftEnd.getTime()) {
    errors.rowErrors[last].time = '末个时间点必须等于班次结束时间';
  }

  // 顺序：严格递增（仅比较均可解析的相邻行）
  for (let i = 1; i < input.rows.length; i += 1) {
    const prev = times[i - 1];
    const cur = times[i];
    if (prev && cur && cur.getTime() <= prev.getTime()) {
      errors.rowErrors[i].time = '时间点必须严格晚于上一行时间点';
    }
  }

  if (countErrors(errors) > 0) {
    return { errors, parsed: null };
  }

  return {
    errors,
    parsed: {
      name,
      shiftStart: shiftStart as Date,
      shiftEnd: shiftEnd as Date,
      limit: limit as Decimal,
      rows: input.rows.map((row, i) => ({
        time: times[i] as Date,
        lux: luxes[i] as Decimal,
        luxText: row.lux.trim(),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 暴露量核算
// ---------------------------------------------------------------------------

export interface SegmentResult {
  index: number;
  start: Date;
  end: Date;
  startLuxText: string;
  endLuxText: string;
  minutes: Decimal;
  /** 未舍入段值 */
  exposureRaw: Decimal;
  /** 展示用：四舍五入到 0.01 */
  exposure: Decimal;
}

export interface ExposureResult {
  segments: SegmentResult[];
  /** 未舍入总量 */
  totalRaw: Decimal;
  /** 总量：先累加未舍入段值再四舍五入到 0.01 */
  total: Decimal;
  limit: Decimal;
  pass: boolean;
  /** 剩余额（合格）或超出量（超限），0.01 精度 */
  diff: Decimal;
  diffKind: 'remaining' | 'excess';
}

export function computeExposure(parsed: ParsedForm): ExposureResult {
  const segments: SegmentResult[] = [];
  let totalRaw = new Decimal(0);

  for (let i = 0; i < parsed.rows.length - 1; i += 1) {
    const a = parsed.rows[i];
    const b = parsed.rows[i + 1];
    const minutes = new Decimal(b.time.getTime() - a.time.getTime()).div(60000);
    // (前值 + 后值) ÷ 2 × 分钟差 ÷ 60
    const exposureRaw = a.lux.plus(b.lux).div(2).times(minutes).div(60);
    totalRaw = totalRaw.plus(exposureRaw);
    segments.push({
      index: i,
      start: a.time,
      end: b.time,
      startLuxText: a.luxText,
      endLuxText: b.luxText,
      minutes,
      exposureRaw,
      exposure: round2(exposureRaw),
    });
  }

  const total = round2(totalRaw);
  // 判定使用未舍入的精确总量：略高于限额即超限，即使舍入后的显示值与限额相等
  const pass = totalRaw.lte(parsed.limit);
  const diff = pass ? parsed.limit.minus(totalRaw) : totalRaw.minus(parsed.limit);

  return {
    segments,
    totalRaw,
    total,
    limit: parsed.limit,
    pass,
    diff: round2(diff),
    diffKind: pass ? 'remaining' : 'excess',
  };
}

// ---------------------------------------------------------------------------
// 照度上限模拟
// ---------------------------------------------------------------------------

/** 校验模拟照度上限输入；合法时 cap 为解析值，否则 error 为提示文案。 */
export function validateCapInput(value: string): { cap: Decimal | null; error: string | null } {
  const v = value.trim();
  if (!v) return { cap: null, error: '请填写模拟照度上限' };
  const parsed = parseAmount2(v);
  if (!parsed) return { cap: null, error: '模拟照度上限须为最多两位小数的非负数字' };
  if (parsed.lt(LUX_MIN) || parsed.gt(LUX_MAX)) {
    return { cap: null, error: '模拟照度上限须在 0 至 5000 lx 之间' };
  }
  return { cap: parsed, error: null };
}

/** 被上限压低的时间点（原照度 > 上限）。 */
export interface CappedPoint {
  /** 行号（0 起） */
  index: number;
  time: Date;
  /** 原照度（用户原始输入文本） */
  originalLuxText: string;
  /** 压低后的照度文本（即上限） */
  cappedLuxText: string;
}

export interface CapSimulation {
  cap: Decimal;
  /** 每行模拟后的照度文本（未触顶行保持原输入），用于“应用到表格”写回 */
  cappedLuxTexts: string[];
  /** 模拟结果的核算（复用十进制梯形积分与精确判定） */
  result: ExposureResult;
  /** 减少量 = 原精确总量 − 模拟精确总量，0.01 精度 */
  reduction: Decimal;
  /** 被压低的时间点 */
  cappedPoints: CappedPoint[];
}

/**
 * 模拟统一调低现场照度上限：每个时间点照度取原值与上限的较小值，
 * 复用同一梯形积分与精确判定；减少量相对当前表格原值的精确总量计算。
 */
export function simulateCap(parsed: ParsedForm, cap: Decimal): CapSimulation {
  const original = computeExposure(parsed);

  const cappedRows: ParsedRow[] = parsed.rows.map((row) =>
    row.lux.gt(cap) ? { ...row, lux: cap, luxText: cap.toString() } : row,
  );
  const result = computeExposure({ ...parsed, rows: cappedRows });

  const cappedPoints: CappedPoint[] = [];
  parsed.rows.forEach((row, i) => {
    if (row.lux.gt(cap)) {
      cappedPoints.push({
        index: i,
        time: row.time,
        originalLuxText: row.luxText,
        cappedLuxText: cap.toString(),
      });
    }
  });

  return {
    cap,
    cappedLuxTexts: cappedRows.map((row) => row.luxText),
    result,
    reduction: round2(original.totalRaw.minus(result.totalRaw)),
    cappedPoints,
  };
}
