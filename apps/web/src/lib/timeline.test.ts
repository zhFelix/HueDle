/**
 * `lib/timeline.ts` 的纯函数单测。
 *
 * 覆盖任务要求的 7 类：① 排布 ② 缺口 ③ 排序健壮 ④ 空 / 单天 ⑤ 跨月跨年
 * ⑥ tooltip 文本 ⑦ 纯函数（不改输入、确定性）。
 *
 * 断言的日期全部写死（不用「今天」），`today` 一律显式注入——
 * 这条测试不依赖系统时钟，换任何时区、任何一天跑都是同一个结果。
 */
import { describe, expect, it } from 'vitest';
import type { HistoryItem } from './storage';
import {
  DEFAULT_DAYS_PER_ROW,
  buildTimeline,
  countGapDays,
  countRecordedDays,
  layoutTimeline,
  timelineAriaLabel,
  timelineLinks,
  timelineTitle,
  type TimelineEntryDay,
} from './timeline';

function item(date: string, over: Partial<HistoryItem> = {}): HistoryItem {
  return { date, hex: '#002fa7', cp: 100, rarity: 'common', badgeIds: [], ...over };
}

/** 只有日期的序列，便于断言排序。 */
function dates(entries: readonly HistoryItem[], today?: string): string[] {
  return buildTimeline(entries, today).map(day => day.date);
}

/** 从 `2026-03-01` 起连续 `n` 天，第 i 天（0 起）的 hex 是 `#00000i`。 */
function consecutive(n: number): HistoryItem[] {
  return Array.from({ length: n }, (_, i) =>
    item(new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10), {
      hex: `#${String(i).padStart(6, '0')}`,
    }),
  );
}

describe('① 排布：连续 5 天 → 5 个色块，按日期从左到右', () => {
  it('每天一块，顺序升序，全部是有记录的色块（无缺口）', () => {
    const days = buildTimeline(
      [
        item('2026-03-01'),
        item('2026-03-02'),
        item('2026-03-03'),
        item('2026-03-04'),
        item('2026-03-05'),
      ],
      '2026-03-05',
    );

    expect(days).toHaveLength(5);
    expect(days.every(day => day.kind === 'entry')).toBe(true);
    expect(days.map(day => day.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    expect(countRecordedDays(days)).toBe(5);
    expect(countGapDays(days)).toBe(0);
  });

  it('连续 100 天 → 100 个色块、0 个缺口、日期无重复且严格 +1 天', () => {
    const input: HistoryItem[] = [];
    for (let i = 0; i < 100; i += 1) {
      // 用 UTC 生成日期串，避免手写 `String(i+1)` 在 100 上超出两位。
      input.push(item(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)));
    }
    const days = buildTimeline(input, '2026-01-01');

    expect(days).toHaveLength(100);
    expect(countGapDays(days)).toBe(0);
    expect(new Set(days.map(day => day.date)).size).toBe(100);
  });

  it('色块的 hex 归一化为大写、cp / rarity 原样带出', () => {
    const days = buildTimeline([item('2026-03-04', { hex: '#00abc7', cp: 42, rarity: 'mythic' })]);

    expect(days[0]).toEqual<TimelineEntryDay>({
      kind: 'entry',
      date: '2026-03-04',
      hex: '#00ABC7',
      cp: 42,
      rarity: 'mythic',
      isToday: false,
    });
  });
});

describe('② 缺口：中间断 2 天 → 缺口有占位块，总数正确', () => {
  it('断 2 天 → 总 7 格（5 有记录 + 2 缺口），缺口日期正确且没有色值', () => {
    const days = buildTimeline(
      [
        item('2026-03-01', { hex: '#111111' }),
        item('2026-03-02', { hex: '#222222' }),
        item('2026-03-05', { hex: '#555555' }),
        item('2026-03-06', { hex: '#666666' }),
        item('2026-03-07', { hex: '#777777' }),
      ],
      '2026-03-07',
    );

    expect(days).toHaveLength(7);
    expect(countRecordedDays(days)).toBe(5);
    expect(countGapDays(days)).toBe(2);

    const gaps = days.filter(day => day.kind === 'gap');
    expect(gaps.map(day => day.date)).toEqual(['2026-03-03', '2026-03-04']);
    // 缺口不伪造颜色：没有 hex 字段，也就不会是 NaN / undefined 字符串。
    for (const gap of gaps) {
      expect(gap).not.toHaveProperty('hex');
      expect(timelineTitle(gap)).toBe(`${gap.date} · 没有记录`);
    }

    // 缺口两侧仍是有记录的日子，顺序不被打乱。
    expect(days[2]?.kind).toBe('gap');
    expect(days[3]?.kind).toBe('gap');
    expect(days[4]?.date).toBe('2026-03-05');
  });

  it('中间大量断档（2016-03-04 → 2026-03-04）→ 3653 格，3651 是缺口，不卡死', () => {
    const days = buildTimeline([item('2016-03-04'), item('2026-03-04')], '2026-03-04');

    expect(days).toHaveLength(3653);
    expect(countRecordedDays(days)).toBe(2);
    expect(countGapDays(days)).toBe(3651);
    expect(days[0]?.date).toBe('2016-03-04');
    expect(days[days.length - 1]?.date).toBe('2026-03-04');
  });

  it('两端没有记录的日子不补：跨度严格是最早记录 ~ 最晚记录', () => {
    const days = buildTimeline([item('2026-03-04')], '2026-03-10');

    expect(days.map(day => day.date)).toEqual(['2026-03-04']);
  });
});

describe('③ 排序健壮：不信任调用方给的顺序', () => {
  it('乱序输入 → 输出仍严格升序，且与顺序无关', () => {
    const shuffled = [
      item('2026-03-05'),
      item('2026-03-01'),
      item('2026-03-03'),
      item('2026-03-02'),
      item('2026-03-04'),
    ];

    expect(dates(shuffled)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    // 倒序输入得到完全一样的结果。
    expect(dates([...shuffled].reverse())).toEqual(dates(shuffled));
  });

  it('同日重复 → 去重成一天（保留排序后先出现的那条）', () => {
    const days = buildTimeline([item('2026-03-04', { hex: '#aaaaaa' }), item('2026-03-04', { hex: '#bbbbbb' })]);

    expect(days).toHaveLength(1);
    expect(days[0]?.kind === 'entry' && days[0].hex).toBe('#AAAAAA');
  });

  it('非法日期被丢掉，不会把整条时间线带崩', () => {
    const days = buildTimeline([
      item('2026-03-04'),
      item('not-a-date'),
      item('2026-3-5'),
      item(''),
    ]);

    expect(days.map(day => day.date)).toEqual(['2026-03-04']);
  });
});

describe('④ 空历史 / 单天：不崩、不出现 NaN', () => {
  it('无历史 → 空数组（组件据此渲染空态、不渲染滚动容器）', () => {
    const days = buildTimeline([]);

    expect(days).toEqual([]);
    expect(countRecordedDays(days)).toBe(0);
    expect(countGapDays(days)).toBe(0);
  });

  it('单天 → 1 格，无缺口，标题里没有 NaN', () => {
    const days = buildTimeline([item('2026-03-04')], '2026-03-04');

    expect(days).toHaveLength(1);
    expect(days[0]?.isToday).toBe(true);
    expect(timelineTitle(days[0]!)).toBe('2026-03-04 · #002FA7');
    expect(timelineTitle(days[0]!)).not.toContain('NaN');
  });

  it('脏字段（cp = NaN、hex 缺失）也不会产出 NaN', () => {
    const dirty = { date: '2026-03-04', cp: Number.NaN, rarity: 'common', badgeIds: [] } as unknown as HistoryItem;
    const days = buildTimeline([dirty], '2026-03-04');
    const day = days[0];

    expect(day?.kind).toBe('entry');
    expect(day?.kind === 'entry' && Number.isFinite(day.cp)).toBe(true);
    expect(JSON.stringify(days)).not.toContain('NaN');
  });

  it('全部输入非法 → 与空历史同结果（不抛）', () => {
    expect(() => buildTimeline([item('x'), item('2026-13-45')])).not.toThrow();
  });
});

describe('⑤ 跨月 / 跨年 / 闰日：连续', () => {
  it('2026-12-31 → 2027-01-01 连续（注入日期标今天）', () => {
    const days = buildTimeline([item('2026-12-31'), item('2027-01-01')], '2027-01-01');

    expect(days.map(day => day.date)).toEqual(['2026-12-31', '2027-01-01']);
    expect(countGapDays(days)).toBe(0);
    expect(days[1]?.isToday).toBe(true);
  });

  it('跨年整段（2026-12-30 ~ 2027-01-02）→ 4 格 0 缺口', () => {
    const days = buildTimeline(
      [item('2026-12-30'), item('2026-12-31'), item('2027-01-01'), item('2027-01-02')],
      '2026-12-30',
    );

    expect(days.map(day => day.date)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(countGapDays(days)).toBe(0);
  });

  it('跨闰日（2028-02-28 ~ 2028-03-01）→ 3 格 0 缺口', () => {
    const days = buildTimeline(
      [item('2028-02-28'), item('2028-02-29'), item('2028-03-01')],
      '2028-02-29',
    );

    expect(days.map(day => day.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(countGapDays(days)).toBe(0);
  });

  it('跨月但不连续的日期会被正确识别为缺口（2026-02-28 → 2026-03-02）', () => {
    const days = buildTimeline([item('2026-02-28'), item('2026-03-02')], '2026-03-02');

    expect(days.map(day => day.date)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
    expect(days[1]?.kind).toBe('gap');
  });
});

describe('⑥ tooltip 文本：格式正确，且不含内部术语', () => {
  /** 玩家界面上永远不该出现的词（UI-COPY 第 1 节三类红线）。 */
  const FORBIDDEN = [
    'localStorage',
    'sessionStorage',
    'HistoryItem',
    'badgeIds',
    'restoreScore',
    'useHistory',
    'useDailyColor',
    'getDaily',
    'UTC',
    '服务端',
    '保存在',
    '本地模式',
    '登录模式',
  ];

  it('有记录：`{date} · {hex}`，aria-label 是 `{date} {hex}`', () => {
    const days = buildTimeline([item('2026-03-04', { hex: '#002fa7' })], '2026-03-04');

    expect(timelineTitle(days[0]!)).toBe('2026-03-04 · #002FA7');
    expect(timelineAriaLabel(days[0]!)).toBe('2026-03-04 #002FA7');
  });

  it('缺口：`{date} · 没有记录`，不出现 hex 占位符', () => {
    const days = buildTimeline([item('2026-03-04'), item('2026-03-06')], '2026-03-04');
    const gap = days.find(day => day.kind === 'gap');

    expect(gap).toBeDefined();
    expect(timelineTitle(gap!)).toBe('2026-03-05 · 没有记录');
    expect(timelineAriaLabel(gap!)).toBe('2026-03-05 没有记录');
    expect(timelineTitle(gap!)).not.toContain('#');
  });

  it('全年 365 天的每一条 title / aria-label 都不含内部术语、也没有 NaN / undefined', () => {
    const input: HistoryItem[] = [];
    for (let i = 0; i < 365; i += 1) input.push(item(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)));
    const days = buildTimeline(input, '2026-01-01');

    expect(days).toHaveLength(365);
    for (const day of days) {
      const title = timelineTitle(day);
      const label = timelineAriaLabel(day);

      expect(title).toMatch(/^\d{4}-\d{2}-\d{2} · (#[0-9A-F]{6}|没有记录)$/);
      expect(label).toMatch(/^\d{4}-\d{2}-\d{2} (#[0-9A-F]{6}|没有记录)$/);
      for (const word of FORBIDDEN) {
        expect(title, `title 不应含「${word}」`).not.toContain(word);
        expect(label, `aria-label 不应含「${word}」`).not.toContain(word);
      }
      expect(title).not.toContain('NaN');
      expect(title).not.toContain('undefined');
    }
  });
});

describe('⑦ 纯函数：不改输入、不读时钟、确定性', () => {
  it('不修改调用方传入的数组与其元素', () => {
    const input = [item('2026-03-05'), item('2026-03-01'), item('2026-03-03')];
    const before = JSON.parse(JSON.stringify(input)) as HistoryItem[];
    const orderBefore = input.map(entry => entry.date);

    buildTimeline(input);

    expect(input).toEqual(before);
    expect(input.map(entry => entry.date)).toEqual(orderBefore);
  });

  it('同一输入 → 同一输出；不注入 today 时所有 isToday 都是 false', () => {
    const input = [item('2026-03-04'), item('2026-03-05')];

    expect(buildTimeline(input)).toEqual(buildTimeline(input));
    expect(buildTimeline(input).every(day => day.isToday === false)).toBe(true);
  });

  it('注入 today 只影响 isToday，不影响排布', () => {
    const input = [item('2026-03-04'), item('2026-03-05')];
    const withToday = buildTimeline(input, '2026-03-05');
    const withoutToday = buildTimeline(input);

    expect(withToday.map(day => day.date)).toEqual(withoutToday.map(day => day.date));
    expect(withToday.map(day => day.isToday)).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// ⑧ / ⑨ 折行 + 相邻渐变（本轮新增的两条语义）
// ---------------------------------------------------------------------------

describe('⑧ 折行：N 天按每行容量切成预期行数', () => {
  it('7 天 / 每行 3 → 3 行，行大小 3 / 3 / 1，且所有天都还在（不丢不重）', () => {
    const days = buildTimeline(consecutive(7), '2026-03-07');
    const rows = layoutTimeline(days, 3);

    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.cells.length)).toEqual([3, 3, 1]);
    expect(rows.map(row => row.index)).toEqual([0, 1, 2]);
    expect(rows.flatMap(row => row.cells.map(cell => cell.day.date))).toEqual(
      days.map(day => day.date),
    );
  });

  it('容量 ≥ 天数 → 1 行；容量 = 1 → 每天一行', () => {
    const days = buildTimeline(consecutive(5), '2026-03-05');

    expect(layoutTimeline(days, 5)).toHaveLength(1);
    expect(layoutTimeline(days, 99)).toHaveLength(1);
    expect(layoutTimeline(days, 1)).toHaveLength(5);
    expect(layoutTimeline(days, 1).every(row => row.cells.length === 1)).toBe(true);
  });

  it('缺口也占一格：5 天有记录 + 2 缺口 = 7 格，按容量 3 折成 3 行', () => {
    const days = buildTimeline(
      [item('2026-03-01'), item('2026-03-02'), item('2026-03-05'), item('2026-03-06'), item('2026-03-07')],
      '2026-03-07',
    );

    expect(days).toHaveLength(7);
    expect(layoutTimeline(days, 3).map(row => row.cells.length)).toEqual([3, 3, 1]);
  });

  it('容量非法（0 / 负数 / NaN / Infinity）不崩，也不产出 NaN', () => {
    const days = buildTimeline(consecutive(4), '2026-03-04');

    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rows = layoutTimeline(days, bad);
      expect(rows.flatMap(row => row.cells)).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toContain('NaN');
    }
    // Infinity / NaN 退回兜底容量（4 天一行放得下）。
    expect(layoutTimeline(days, Number.POSITIVE_INFINITY)).toHaveLength(1);
    expect(layoutTimeline(days, DEFAULT_DAYS_PER_ROW)).toHaveLength(1);
  });

  it('空历史 → 0 行（不是 1 行空格子）', () => {
    expect(layoutTimeline([], 10)).toEqual([]);
    expect(layoutTimeline([], 0)).toEqual([]);
  });
});

describe('⑨ 渐变连接：只在「同一行内、相邻且都有记录」的两天之间', () => {
  it('相邻两天都有记录 → 后一格带 from→to 渐变，颜色就是两天的 hex', () => {
    const days = buildTimeline(
      [item('2026-03-01', { hex: '#111111' }), item('2026-03-02', { hex: '#222222' })],
      '2026-03-02',
    );
    const cells = layoutTimeline(days, 30)[0]!.cells;

    expect(cells[0]!.isRowStart).toBe(true);
    expect(cells[0]!.link).toBeNull();
    expect(cells[1]!.link).toEqual({ from: '#111111', to: '#222222' });
    expect(timelineLinks(layoutTimeline(days, 30))).toEqual([{ from: '#111111', to: '#222222' }]);
  });

  it('缺口打断链条：跨缺口的两天之间没有渐变（这是本组件存在的意义）', () => {
    const days = buildTimeline(
      [
        item('2026-03-01', { hex: '#111111' }),
        item('2026-03-02', { hex: '#222222' }),
        item('2026-03-05', { hex: '#555555' }),
        item('2026-03-06', { hex: '#666666' }),
      ],
      '2026-03-06',
    );
    // 01 / 02 / 缺 03 / 缺 04 / 05 / 06
    const cells = layoutTimeline(days, 30)[0]!.cells;

    expect(cells.map(cell => cell.day.kind)).toEqual(['entry', 'entry', 'gap', 'gap', 'entry', 'entry']);
    // 每一格左侧有没有渐变（null = 硬边）。
    expect(cells.map(cell => cell.link)).toEqual([
      null,
      { from: '#111111', to: '#222222' },
      null, // 缺口本身不画
      null,
      null, // 缺口之后的那天：左边是缺口，链条必须断
      { from: '#555555', to: '#666666' },
    ]);

    const links = timelineLinks(layoutTimeline(days, 30));
    // 02 → 05 不是邻居（中间隔着 03 / 04 两个缺口），绝不能连起来。
    expect(links).not.toContainEqual({ from: '#222222', to: '#555555' });
    expect(links).toHaveLength(2);
  });

  it('换行处断开：行首不继承上一行的渐变，行尾不指向下一行', () => {
    // 8 天全部连续，但容量 3 会把 03|04 与 06|07 切开。
    const days = buildTimeline(consecutive(8), '2026-03-08');
    const rows = layoutTimeline(days, 3);

    expect(rows.map(row => row.cells.length)).toEqual([3, 3, 2]);

    // 每一行的第一格：行首、无渐变。
    for (const row of rows) {
      expect(row.cells[0]!.isRowStart).toBe(true);
      expect(row.cells[0]!.link).toBeNull();
    }

    const links = timelineLinks(rows);
    // 行内相邻的连接都在。
    expect(links).toContainEqual({ from: '#000001', to: '#000002' });
    expect(links).toContainEqual({ from: '#000004', to: '#000005' });
    // 跨行的两对（02→03、05→06）不存在。
    expect(links).not.toContainEqual({ from: '#000002', to: '#000003' });
    expect(links).not.toContainEqual({ from: '#000005', to: '#000006' });
    // 8 天共 7 对相邻，被两条行边界切断 2 对（02→03、05→06）→ 还剩 5 段渐变。
    expect(links).toHaveLength(5);
  });

  it('大量断档 + 折行：跨缺口与跨行的连接都不存在，也不出现 NaN', () => {
    const days = buildTimeline([item('2016-03-04', { hex: '#aaaaaa' }), item('2026-03-04', { hex: '#bbbbbb' })], '2026-03-04');
    const rows = layoutTimeline(days, 30);

    expect(rows).toHaveLength(Math.ceil(3653 / 30));
    expect(rows.flatMap(row => row.cells)).toHaveLength(3653);
    // 只有两端有记录，且它们之间隔着 3651 个缺口 → 一个连接都不该有。
    expect(timelineLinks(rows)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain('NaN');
  });

  it('单天 → 1 行 1 格，没有渐变', () => {
    const rows = layoutTimeline(buildTimeline([item('2026-03-04')], '2026-03-04'), 30);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells).toHaveLength(1);
    expect(rows[0]!.cells[0]!.link).toBeNull();
    expect(rows[0]!.cells[0]!.isRowStart).toBe(true);
  });
});
