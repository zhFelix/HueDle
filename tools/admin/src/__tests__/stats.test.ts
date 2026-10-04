import { describe, expect, it } from 'vitest';
import {
  analyzeM1,
  analyzeM2,
  analyzeM3,
  analyzeM4,
  analyzeM5,
  analyzeM6,
  analyzeM7,
  analyzeM8,
  DEFAULT_CONTEXT,
  type Table,
} from '../analyze';

/** 断言表格里没有 NaN / undefined / null 泄漏到展示层。 */
function assertClean(table: Table): void {
  for (const row of table.rows) {
    for (const cell of row) {
      expect(cell).not.toContain('NaN');
      expect(cell).not.toContain('undefined');
      expect(cell).not.toContain('null');
      expect(cell).not.toBe('');
    }
  }
  for (const column of table.columns) expect(column).not.toContain('NaN');
}

const EMPTY_INPUTS: Array<[string, Table]> = [
  ['M1 空', analyzeM1([])],
  ['M2 空', analyzeM2([])],
  ['M3 空', analyzeM3([])],
  ['M4 空', analyzeM4([], DEFAULT_CONTEXT)],
  ['M5 空', analyzeM5([])],
  ['M6 空', analyzeM6([])],
  ['M7 空', analyzeM7([])],
  ['M8 空', analyzeM8(undefined, undefined)],
];

const SINGLE_ROW_INPUTS: Array<[string, Table]> = [
  ['M1 单行', analyzeM1([{ date: '2026-01-01', draws: 1, players: 1 }])],
  ['M2 单行', analyzeM2([{ date: '2026-01-01', new_players: 1, returning_players: 0 }])],
  ['M3 单行', analyzeM3([{ bucket: '0', users: 1, one_day_users: 1 }])],
  ['M4 单行', analyzeM4([{ badge_id: 'casino-pair', hit_days: 1 }], DEFAULT_CONTEXT)],
  ['M5 单行', analyzeM5([{ badge_id: 'casino-pair', n: 1, first_seen: '2026-01-01' }])],
  ['M6 单行', analyzeM6([{ wk: '2025-12-29', rarity: 'common', n: 1 }])],
  ['M7 单行', analyzeM7([{ date: '2026-01-01', min: 1, p50: 2, p99: 3, max: 4 }])],
  [
    'M8 单行',
    analyzeM8(
      {
        bad_hex: 0,
        bad_date: 0,
        future_date: 0,
        bad_badge_ids: 0,
        bad_cp: 0,
        expired_sessions: 3,
      },
      0,
    ),
  ],
];

describe('M1–M8 纯函数渲染器：空库 / 单行库不崩、不出现 NaN', () => {
  it.each(EMPTY_INPUTS)('%s', (_name, table) => {
    assertClean(table);
  });
  it.each(SINGLE_ROW_INPUTS)('%s', (_name, table) => {
    assertClean(table);
  });

  it('M7 的非法数值降级成 —（不产生 NaN）', () => {
    const table = analyzeM7([
      { date: '2026-01-01', min: Number.NaN, p50: Number.POSITIVE_INFINITY, p99: 0, max: 1 },
    ]);
    expect(table.rows[0]).toEqual(['2026-01-01', '—', '—', '0', '1']);
    assertClean(table);
  });

  it('M6 周内占比在分母为 0 时给 —', () => {
    const table = analyzeM6([{ wk: '2025-12-29', rarity: 'common', n: 0 }]);
    expect(table.rows[0]?.[3]).toBe('—');
    assertClean(table);
  });

  it('M8 全部为 0 时每格都是 0（哨兵可读）', () => {
    const table = analyzeM8(
      { bad_hex: 0, bad_date: 0, future_date: 0, bad_badge_ids: 0, bad_cp: 0, expired_sessions: 0 },
      0,
    );
    expect(table.rows.map(row => row[1])).toEqual(['0', '0', '0', '0', '0', '0', '0']);
  });
});

describe('M1 唯一约束哨兵', () => {
  it('draws === players → OK', () => {
    expect(analyzeM1([{ date: '2026-01-01', draws: 3, players: 3 }]).rows[0]?.[3]).toBe('OK');
  });
  it('draws ≠ players → 告警', () => {
    expect(analyzeM1([{ date: '2026-01-01', draws: 4, players: 3 }]).rows[0]?.[3]).toContain('⚠');
  });
});

describe('M4 样本门槛', () => {
  it('窗口 < 200 次抽取时不给结论，只列原始计数', () => {
    const table = analyzeM4([{ badge_id: 'casino-pair', hit_days: 3 }], {
      ...DEFAULT_CONTEXT,
      draws: 50,
      conclusive: false,
    });
    expect(table.columns).toEqual(['徽章', '实际命中(天)']);
    expect(table.caption).toContain('不给结论');
  });

  it('样本足够时按 |z| 排序并给出期望命中', () => {
    const table = analyzeM4(
      [
        { badge_id: 'casino-pair', hit_days: 400 },
        { badge_id: 'casino-pair', hit_days: 0 },
      ],
      { ...DEFAULT_CONTEXT, draws: 1000, conclusive: true },
    );
    expect(table.columns).toContain('偏差 z');
    assertClean(table);
  });
});

describe('M5 幽灵徽章过滤', () => {
  it('代码里存在的 id 不算幽灵', () => {
    const table = analyzeM5([{ badge_id: 'casino-pair', n: 5, first_seen: '2026-01-01' }]);
    expect(table.rows[0]?.[0]).toBe('（无）');
  });

  it('存档里有、代码里没有的 id 被列出', () => {
    const table = analyzeM5([
      { badge_id: 'casino-pair', n: 5, first_seen: '2026-01-01' },
      { badge_id: 'ghost-from-2024', n: 2, first_seen: '2024-01-01' },
    ]);
    expect(table.rows).toEqual([['ghost-from-2024', '2', '2024-01-01']]);
  });
});
