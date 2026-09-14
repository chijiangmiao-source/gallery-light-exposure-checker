/**
 * 浏览器草稿：把保护专员尚未完成的录入（展品名、班次、限额、时间点照度表、
 * 停照区间）序列化为带结构版本的 JSON 契约持久化到浏览器存储。
 *
 * 契约设计：
 * - 仅保存“输入文本”，不保存核算结论、模拟方案等派生态；恢复后仍须通过原核算
 *   操作校验并生成结论，避免沿用旧结论或过期模拟；
 * - 顶层携带 contractVersion；字段缺失、类型不符或内容损坏时，解析方必须拒绝
 *   （不抛异常、不写入表单），由界面提示草稿不可用并允许清除记录；
 * - 草稿只要求“结构合法”，不要求“业务合法”——录入中途的半成品（空字段、
 *   时间点不齐等）也应当能被保存与恢复，业务校验仍归 validateForm。
 */

export const DRAFT_STORAGE_KEY = 'exhibit-exposure-console:draft:v1';
/** 当前草稿契约版本；结构发生不兼容变更时递增并在解析处分流。 */
export const DRAFT_CONTRACT_VERSION = 1;

export interface DraftRow {
  time: string;
  lux: string;
}

export interface DraftBlackout {
  start: string;
  end: string;
}

/** 草稿负载：与 FormInput 的录入字段一一对应（全部为字符串，原样保存输入文本）。 */
export interface DraftData {
  name: string;
  shiftStart: string;
  shiftEnd: string;
  limit: string;
  rows: DraftRow[];
  blackouts: DraftBlackout[];
}

/** 落盘的完整草稿信封：版本 + 负载 + 簿记时间戳（仅用于展示，不参与恢复判定）。 */
export interface DraftEnvelope {
  contractVersion: number;
  savedAt: string;
  data: DraftData;
}

/** 解析结果：ok 为负载；corrupt 为结构损坏（含非法 JSON、版本不符、字段缺失 / 类型不符）。 */
export type DraftParseResult =
  | { ok: true; data: DraftData; savedAt: string }
  | { ok: false };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** 严格校验负载结构：任一标量字段缺失 / 类型不符即整体拒绝（不做部分恢复）。 */
export function validateDraftData(raw: unknown): DraftData | null {
  if (!isRecord(raw)) return null;

  const { name, shiftStart, shiftEnd, limit, rows, blackouts } = raw;
  if (!isString(name) || !isString(shiftStart) || !isString(shiftEnd) || !isString(limit)) {
    return null;
  }
  if (!Array.isArray(rows) || rows.length < 2) return null;
  for (const r of rows) {
    if (!isRecord(r) || !isString(r.time) || !isString(r.lux)) return null;
  }
  if (!Array.isArray(blackouts)) return null;
  for (const b of blackouts) {
    if (!isRecord(b) || !isString(b.start) || !isString(b.end)) return null;
  }
  // 通过校验后返回一份规范化副本，避免调用方继续持有外部可变引用
  return {
    name,
    shiftStart,
    shiftEnd,
    limit,
    rows: rows.map((r) => ({ time: r.time, lux: r.lux })),
    blackouts: blackouts.map((b) => ({ start: b.start, end: b.end })),
  };
}

/** 构造草稿信封（不含存储副作用，便于往返序列化测试）。 */
export function createDraftEnvelope(data: DraftData, savedAt: string): DraftEnvelope {
  return { contractVersion: DRAFT_CONTRACT_VERSION, savedAt, data };
}

/** 序列化为 JSON 文本。 */
export function serializeDraft(data: DraftData, savedAt: string): string {
  return JSON.stringify(createDraftEnvelope(data, savedAt));
}

/**
 * 解析草稿 JSON 文本并按契约严格校验。
 * 任何损坏（非法 JSON、非对象、版本不符、字段缺失 / 类型不符、保存时间缺失或不可解析）
 * 统一返回 { ok: false }，绝不抛出，调用方据此提示“草稿不可用”而非写入半成品。
 */
export function parseDraft(text: string | null | undefined): DraftParseResult {
  if (typeof text !== 'string' || text.length === 0) return { ok: false };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isRecord(json)) return { ok: false };
  if (json.contractVersion !== DRAFT_CONTRACT_VERSION) return { ok: false };
  // 保存时间为必填簿记字段：缺失、类型错误或不可解析均判草稿不可用
  if (!isString(json.savedAt) || Number.isNaN(Date.parse(json.savedAt))) {
    return { ok: false };
  }
  const data = validateDraftData(json.data);
  if (!data) return { ok: false };
  return { ok: true, data, savedAt: json.savedAt };
}

/**
 * 判断一份草稿是否含有任何用户输入（空表单不产生草稿提示，与现有版本启动行为一致）。
 * 仅依据结构合法的负载判断；调用方应先通过 parseDraft。
 */
export function draftHasContent(data: DraftData): boolean {
  if (
    data.name.trim() !== '' ||
    data.shiftStart.trim() !== '' ||
    data.shiftEnd.trim() !== '' ||
    data.limit.trim() !== ''
  ) {
    return true;
  }
  if (data.blackouts.length > 0) return true;
  return data.rows.some((r) => r.time.trim() !== '' || r.lux.trim() !== '');
}

// ---------------------------------------------------------------------------
// 浏览器存储适配
// ---------------------------------------------------------------------------

/** 存储所需的最小接口（localStorage 天然满足；测试可注入内存假实现）。 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 解析浏览器 localStorage 适配；环境不可用（隐私模式 / 禁用存储）时返回 null。 */
export function createBrowserDraftStorage(): DraftStorage | null {
  try {
    const storage = window.localStorage;
    // 探测一次可写性：部分浏览器在隐私模式下访问即抛异常
    const probeKey = `${DRAFT_STORAGE_KEY}:probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

/** 存储读取结果：无记录、结构损坏（含版本不符、保存时间损坏）或可用草稿。 */
export type StoredDraft =
  | { status: 'absent' }
  | { status: 'corrupt' }
  | { status: 'ok'; data: DraftData; savedAt: string };

/** 从存储读取草稿并区分“无记录 / 损坏 / 可用”（不抛异常）。 */
export function loadDraft(storage: DraftStorage): StoredDraft {
  let text: string | null = null;
  try {
    text = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { status: 'absent' };
  }
  if (text === null) return { status: 'absent' };
  const parsed = parseDraft(text);
  if (!parsed.ok) return { status: 'corrupt' };
  return { status: 'ok', data: parsed.data, savedAt: parsed.savedAt };
}

/** 写入草稿；存储抛异常（配额已满等）时静默失败，绝不阻塞用户录入。 */
export function saveDraft(storage: DraftStorage, data: DraftData, savedAt: string): boolean {
  try {
    storage.setItem(DRAFT_STORAGE_KEY, serializeDraft(data, savedAt));
    return true;
  } catch {
    return false;
  }
}

/** 清除草稿记录。 */
export function clearDraft(storage: DraftStorage): void {
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 忽略：记录本就要丢弃
  }
}
