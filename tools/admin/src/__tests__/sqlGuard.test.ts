import { describe, expect, it } from 'vitest';
import { assertReadOnlySql, SqlGuardError } from '../db';
import { METRICS } from '../stats';

describe('SQL 入口守卫：只放行 SELECT / WITH', () => {
  it.each([
    'SELECT 1',
    'select 1',
    '  \n\tSELECT date FROM daily_results',
    'WITH firsts AS (SELECT 1) SELECT * FROM firsts',
    'with x as (select 1) select * from x',
    'SELECT 1;',
  ])('放行：%s', sql => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it.each([
    ['DELETE FROM daily_results', 'DELETE'],
    ['UPDATE users SET name = $1', 'UPDATE'],
    ['DROP TABLE users', 'DROP'],
    ['INSERT INTO users (id) VALUES ($1)', 'INSERT'],
    ['TRUNCATE daily_results', 'TRUNCATE'],
    ['', '空串'],
    ['   ', '纯空白'],
    ['-- comment\nSELECT 1', '行注释开头'],
    ['/* comment */ SELECT 1', '块注释开头'],
    ['select 1; DROP TABLE users', '分号后的第二条语句'],
  ])('拒绝：%s（%s）', sql => {
    expect(() => assertReadOnlySql(sql)).toThrow();
  });

  it('拒绝时抛的是 SqlGuardError，便于退出码归类', () => {
    expect(() => assertReadOnlySql('DELETE FROM users')).toThrow(SqlGuardError);
  });
});

describe('M1–M8 的 SQL 都是常量且以 SELECT/WITH 开头（只读承诺可回归）', () => {
  it('恰好 8 条，id 为 M1–M8', () => {
    expect(METRICS.map(m => m.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']);
  });

  it.each(METRICS.map(m => [m.id, m.sql] as const))('%s 通过应用级守卫', (_id, sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it.each(METRICS.map(m => [m.id, m.sql] as const))('%s 不含参数拼接（只有 $n 占位符）', (_id, sql) => {
    // 不允许模板插值留下的痕迹：字符串里出现 ${ 就说明有人在拼 SQL。
    expect(sql).not.toContain('${');
  });

  it('附加查询同样通过守卫', () => {
    for (const metric of METRICS) {
      const extra = metric.extra;
      if (extra) expect(() => assertReadOnlySql(extra.sql)).not.toThrow();
    }
  });
});
