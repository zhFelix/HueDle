/**
 * 测试夹具：构造一份**形状完整**的 {@link StatsReport}，用于渲染层与脱敏断言。
 *
 * 注意：这里的示例数据里刻意放了密码与用户名，用来反向断言"报告里不会出现它们"。
 */
import type { StatsReport } from '../report';

export const SECRET_PASSWORD = 'sup3r-s3cret-pw';
export const SECRET_USERNAME = 'alice-the-player';
export const SECRET_CONNECTION = `postgresql://postgres.ref:${SECRET_PASSWORD}@db.example.com:5432/postgres`;

export function sampleReport(overrides: Partial<StatsReport> = {}): StatsReport {
  const base: StatsReport = {
    generatedAt: '2026-01-02T03:04:05.000Z',
    windowDays: 30,
    windowStart: '2025-12-03',
    connection: 'db.example.com:5432/postgres',
    totals: { draws: 12, players: 8 },
    sections: [
      {
        id: 'M1',
        title: '每日抽取量 + 唯一约束哨兵',
        question: '产品今天还有没有人用？',
        table: {
          columns: ['日期', '抽取数', '玩家数', '唯一约束'],
          rows: [['2026-01-01', '5', '5', 'OK']],
        },
        notes: ['draws 必须恒等于 players'],
      },
    ],
    names: [],
    namesRequested: false,
    warnings: [],
  };
  return { ...base, ...overrides };
}
