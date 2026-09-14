import { describe, expect, it } from 'vitest';
import {
  DRAFT_CONTRACT_VERSION,
  DRAFT_STORAGE_KEY,
  clearDraft,
  createDraftEnvelope,
  draftHasContent,
  loadDraft,
  parseDraft,
  saveDraft,
  serializeDraft,
  validateDraftData,
  type DraftData,
  type DraftStorage,
} from '../../src/lib/draft';

/** 覆盖各录入项的完整草稿（含跨日班次与停照区间）。 */
function fullDraft(): DraftData {
  return {
    name: '宋代青瓷',
    shiftStart: '2026-09-14T22:00',
    shiftEnd: '2026-09-15T02:00',
    limit: '500',
    rows: [
      { time: '2026-09-14T22:00', lux: '100' },
      { time: '2026-09-15T00:00', lux: '200' },
      { time: '2026-09-15T02:00', lux: '100' },
    ],
    blackouts: [{ start: '2026-09-14T23:00', end: '2026-09-14T23:30' }],
  };
}

/** 录入中途的半成品：空字段、空停照区间，结构合法但业务不合法，也应可往返。 */
function partialDraft(): DraftData {
  return {
    name: '',
    shiftStart: '',
    shiftEnd: '',
    limit: '',
    rows: [
      { time: '', lux: '' },
      { time: '', lux: '' },
      { time: '', lux: '' },
    ],
    blackouts: [],
  };
}

class MemoryStorage implements DraftStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  size(): number {
    return this.map.size;
  }
}

describe('草稿契约：往返序列化', () => {
  it('完整草稿序列化后解析，字段逐一保留（含跨日班次、多行与停照区间）', () => {
    const data = fullDraft();
    const savedAt = '2026-09-14T12:34:56.000Z';
    const text = serializeDraft(data, savedAt);
    const parsed = parseDraft(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toEqual(data);
    expect(parsed.savedAt).toBe(savedAt);

    const envelope = JSON.parse(text) as Record<string, unknown>;
    expect(envelope.contractVersion).toBe(DRAFT_CONTRACT_VERSION);
    expect(envelope.savedAt).toBe(savedAt);
    expect(envelope.data).toBeDefined();
  });

  it('信封工厂写入当前契约版本', () => {
    const env = createDraftEnvelope(fullDraft(), '2026-09-14T00:00:00.000Z');
    expect(env.contractVersion).toBe(1);
    expect(env.data.name).toBe('宋代青瓷');
  });

  it('半成品草稿（空字段、零停照区间）同样可往返：结构合法不代表业务合法', () => {
    const data = partialDraft();
    const parsed = parseDraft(serializeDraft(data, ''));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual(data);
  });

  it('解析结果是规范化副本，修改返回对象不影响再次解析', () => {
    const text = serializeDraft(fullDraft(), '');
    const a = parseDraft(text);
    const b = parseDraft(text);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    a.data.rows[0].lux = '9999';
    expect(b.data.rows[0].lux).toBe('100');
    expect(a.data).not.toEqual(b.data);
  });
});

describe('草稿契约：损坏与拒绝', () => {
  const corruptCases: [string, unknown][] = [
    ['null 文本', null],
    ['undefined 文本', undefined],
    ['空字符串', ''],
    ['非法 JSON', '{not-json'],
    ['JSON 是数字', '42'],
    ['JSON 是字符串', '"hello"'],
    ['JSON 是数组', '[]'],
    ['缺少 contractVersion', JSON.stringify({ savedAt: '', data: fullDraft() })],
    ['契约版本为旧版 0', JSON.stringify({ contractVersion: 0, savedAt: '', data: fullDraft() })],
    ['契约版本为未来版 2', JSON.stringify({ contractVersion: 2, savedAt: '', data: fullDraft() })],
    ['契约版本为字符串', JSON.stringify({ contractVersion: '1', data: fullDraft() })],
    ['缺少 data', JSON.stringify({ contractVersion: 1 })],
    ['data 为数组', JSON.stringify({ contractVersion: 1, data: [] })],
    ['缺少展品名', JSON.stringify({ contractVersion: 1, data: { ...partialDraft(), name: undefined } })],
    [
      '标量字段类型不符（limit 为数字）',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), limit: 500 } }),
    ],
    [
      'name 为数字',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), name: 123 } }),
    ],
    [
      'rows 不是数组',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), rows: {} } }),
    ],
    [
      'rows 仅一行',
      JSON.stringify({
        contractVersion: 1,
        data: { ...fullDraft(), rows: [{ time: '2026-09-14T22:00', lux: '100' }] },
      }),
    ],
    [
      'rows 为空数组',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), rows: [] } }),
    ],
    [
      '行缺少 time',
      JSON.stringify({
        contractVersion: 1,
        data: {
          ...fullDraft(),
          rows: [{ lux: '100' }, ...fullDraft().rows.slice(1)],
        },
      }),
    ],
    [
      '行 lux 为数字（类型不符）',
      JSON.stringify({
        contractVersion: 1,
        data: {
          ...fullDraft(),
          rows: fullDraft().rows.map((r, i) => (i === 0 ? { time: r.time, lux: 100 } : r)),
        },
      }),
    ],
    [
      '行本身是字符串',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), rows: ['a', 'b'] } }),
    ],
    [
      'blackouts 不是数组',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), blackouts: {} } }),
    ],
    [
      '缺少 blackouts 字段',
      JSON.stringify({ contractVersion: 1, data: { ...fullDraft(), blackouts: undefined } }),
    ],
    [
      '停照区间缺少 end',
      JSON.stringify({
        contractVersion: 1,
        data: { ...fullDraft(), blackouts: [{ start: '2026-09-14T23:00' }] },
      }),
    ],
    [
      '停照区间 start 为数字',
      JSON.stringify({
        contractVersion: 1,
        data: { ...fullDraft(), blackouts: [{ start: 1, end: '2026-09-14T23:30' }] },
      }),
    ],
    [
      '信封外层为 null',
      JSON.stringify(null),
    ],
  ];

  for (const [label, value] of corruptCases) {
    it(`拒绝损坏草稿：${label}`, () => {
      const text = typeof value === 'string' || value === null || value === undefined ? value : String(value);
      expect(parseDraft(text as string | null | undefined)).toEqual({ ok: false });
    });
  }

  it('savedAt 缺失或类型不符不影响负载恢复（簿记字段宽容处理）', () => {
    const noSavedAt = JSON.stringify({ contractVersion: 1, data: fullDraft() });
    const r1 = parseDraft(noSavedAt);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.savedAt).toBeNull();

    const badSavedAt = JSON.stringify({ contractVersion: 1, savedAt: 123, data: fullDraft() });
    const r2 = parseDraft(badSavedAt);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.savedAt).toBeNull();
  });

  it('validateDraftData 直接拒绝非对象与结构不符的负载', () => {
    expect(validateDraftData(null)).toBeNull();
    expect(validateDraftData('x')).toBeNull();
    expect(validateDraftData([])).toBeNull();
    expect(validateDraftData({ ...partialDraft(), rows: [{}] })).toBeNull();
    expect(validateDraftData(fullDraft())).not.toBeNull();
  });
});

describe('draftHasContent', () => {
  it('全空表单无内容', () => {
    expect(draftHasContent(partialDraft())).toBe(false);
  });

  it('任一字段有值即有内容', () => {
    expect(draftHasContent({ ...partialDraft(), name: 'x' })).toBe(true);
    expect(draftHasContent({ ...partialDraft(), limit: '120' })).toBe(true);
    expect(draftHasContent({ ...partialDraft(), rows: [{ time: '', lux: '50' }, { time: '', lux: '' }, { time: '', lux: '' }] })).toBe(true);
    expect(draftHasContent({ ...partialDraft(), blackouts: [{ start: '', end: '' }] })).toBe(true);
  });

  it('纯空白输入不视为有内容', () => {
    expect(
      draftHasContent({
        ...partialDraft(),
        name: '   ',
        rows: [
          { time: ' ', lux: ' ' },
          { time: '', lux: '' },
          { time: '', lux: '' },
        ],
      }),
    ).toBe(false);
  });
});

describe('浏览器存储适配（内存假实现）', () => {
  it('无记录时 loadDraft 返回 absent', () => {
    expect(loadDraft(new MemoryStorage())).toEqual({ status: 'absent' });
  });

  it('保存 → 读取往返：ok 并带保存时间', () => {
    const storage = new MemoryStorage();
    const savedAt = '2026-09-14T12:34:56.000Z';
    expect(saveDraft(storage, fullDraft(), savedAt)).toBe(true);
    const stored = loadDraft(storage);
    expect(stored.status).toBe('ok');
    if (stored.status === 'ok') {
      expect(stored.data).toEqual(fullDraft());
      expect(stored.savedAt).toBe(savedAt);
    }
  });

  it('记录损坏时 loadDraft 返回 corrupt 而非抛异常', () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, '{broken');
    expect(loadDraft(storage)).toEqual({ status: 'corrupt' });

    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ contractVersion: 99, data: fullDraft() }));
    expect(loadDraft(storage)).toEqual({ status: 'corrupt' });
  });

  it('clearDraft 清除记录，之后为 absent', () => {
    const storage = new MemoryStorage();
    saveDraft(storage, fullDraft(), '');
    clearDraft(storage);
    expect(loadDraft(storage)).toEqual({ status: 'absent' });
  });

  it('对 absent 调用清除也不抛异常', () => {
    const storage = new MemoryStorage();
    expect(() => clearDraft(storage)).not.toThrow();
  });

  it('写入抛异常（如配额已满）时 saveDraft 返回 false 且不抛出', () => {
    const throwing: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(() => saveDraft(throwing, fullDraft(), '')).not.toThrow();
    expect(saveDraft(throwing, fullDraft(), '')).toBe(false);
  });

  it('读取抛异常时 loadDraft 按 absent 处理', () => {
    const throwing: DraftStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadDraft(throwing)).toEqual({ status: 'absent' });
  });
});
