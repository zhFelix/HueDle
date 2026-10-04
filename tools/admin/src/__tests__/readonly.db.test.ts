/**
 * **必须靠真实执行验证**的那一条：只读不是"我们写的 SQL 都是 SELECT"，而是数据库拒绝写。
 *
 * 这里刻意绕过应用级守卫（{@link runInReadOnlyTransaction}），直接把写语句送进
 * `BEGIN READ ONLY` 事务，断言 PG 以 SQLSTATE `25006` 拒绝——只测自己的守卫函数不算数。
 *
 * 写语句即使"只读失效"也不会改变数据：
 *   - INSERT 的用户不存在 → 外键失败；
 *   - UPDATE / DELETE 的 WHERE 匹配不到任何行。
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminDbError,
  assertReadOnlySql,
  createReadOnlyPool,
  requireDatabaseUrl,
  runInReadOnlyTransaction,
  runReadOnlyBatch,
  runReadOnlyQuery,
} from '../db';

let pool: Pool;

beforeAll(() => {
  pool = createReadOnlyPool(requireDatabaseUrl());
});

afterAll(async () => {
  await pool.end();
});

const PROBE_DATE = '__admin_readonly_probe__';

describe('只读由数据库强制（SQLSTATE 25006）', () => {
  it('INSERT 被 PG 拒绝', async () => {
    const sql =
      'INSERT INTO daily_results (user_id, date, hex, cp, rarity, badge_ids, created_at) '
      + `VALUES ('__admin_readonly_probe__', '${PROBE_DATE}', '#000000', 1, 'common', '[]', '2026-01-01T00:00:00.000Z')`;

    // 应用级守卫确实会拦它；我们绕过守卫，验证拦截来自数据库。
    expect(() => assertReadOnlySql(sql)).toThrow();

    let caught: unknown;
    try {
      await runInReadOnlyTransaction(pool, sql);
    } catch (err) {
      caught = err;
    }

    expect(caught, 'INSERT 竟然没有被拒绝——只读没有生效').toBeInstanceOf(AdminDbError);
    expect((caught as AdminDbError).code).toBe('25006');
    expect((caught as Error).message).toMatch(/read-only transaction/i);
  });

  it('UPDATE 被 PG 拒绝', async () => {
    let caught: unknown;
    try {
      await runInReadOnlyTransaction(
        pool,
        `UPDATE daily_results SET rarity = rarity WHERE date = '${PROBE_DATE}'`,
      );
    } catch (err) {
      caught = err;
    }
    expect((caught as AdminDbError).code).toBe('25006');
  });

  it('DELETE 被 PG 拒绝', async () => {
    let caught: unknown;
    try {
      await runInReadOnlyTransaction(pool, `DELETE FROM daily_results WHERE date = '${PROBE_DATE}'`);
    } catch (err) {
      caught = err;
    }
    expect((caught as AdminDbError).code).toBe('25006');
  });

  it('被拒绝之后连接池仍可正常执行 SELECT（事务已干净回滚）', async () => {
    const rows = await runReadOnlyQuery<{ ok: number }>(pool, 'SELECT 1::int AS ok');
    expect(rows[0]?.ok).toBe(1);
  });

  it('事务级参数确实生效：transaction_read_only=on、statement_timeout=30s', async () => {
    // 托管连接池会吃掉 libpq 的 options，所以这两项必须靠事务内的 BEGIN READ ONLY / SET LOCAL。
    const rows = await runReadOnlyQuery<{ ro: string; timeout: string }>(
      pool,
      "SELECT current_setting('transaction_read_only') AS ro, current_setting('statement_timeout') AS timeout",
    );
    expect(rows[0]?.ro).toBe('on');
    expect(rows[0]?.timeout).toBe('30s');
  });
});

describe('共享/并行的只读事务仍然只读（runReadOnlyBatch）', () => {
  it('一个批次 = 一个只读事务：事务级只读与超时都生效', async () => {
    const [, settings] = await runReadOnlyBatch<{ ro: string; timeout: string }>(pool, [
      { sql: 'SELECT 1::int AS ok' },
      {
        sql: "SELECT current_setting('transaction_read_only') AS ro, current_setting('statement_timeout') AS timeout",
      },
      { sql: 'SELECT 2::int AS ok' },
    ]);
    expect(settings[0]?.ro).toBe('on');
    expect(settings[0]?.timeout).toBe('30s');
  });

  it('批次入口的应用级守卫拒绝写语句（甚至不会进事务）', async () => {
    await expect(
      runReadOnlyBatch(pool, [
        { sql: 'SELECT 1::int AS ok' },
        { sql: "DELETE FROM daily_results WHERE date = '__admin_readonly_probe__'" },
      ]),
    ).rejects.toThrow();
  });

  it('并发场景：一个共享只读事务在途时，另一个连接上的写仍被 PG 拒绝（25006）', async () => {
    // 用 pg_sleep 把第一个连接的只读事务按住 0.5s；期间在第二个连接上试写。
    const inFlight = runReadOnlyBatch(pool, [
      { sql: 'SELECT pg_sleep(0.5)' },
      { sql: 'SELECT 1::int AS ok' },
    ]);

    let caught: unknown;
    try {
      await runInReadOnlyTransaction(
        pool,
        'INSERT INTO daily_results (user_id, date, hex, cp, rarity, badge_ids, created_at) '
        + `VALUES ('__admin_readonly_probe__', '${PROBE_DATE}', '#000000', 1, 'common', '[]', '2026-01-01T00:00:00.000Z')`,
      );
    } catch (err) {
      caught = err;
    }

    await expect(inFlight).resolves.toHaveLength(2);
    expect(caught, '并发只读事务进行中时写入竟然没被拒绝').toBeInstanceOf(AdminDbError);
    expect((caught as AdminDbError).code).toBe('25006');
    expect((caught as Error).message).toMatch(/read-only transaction/i);
  });

  it('批次返回顺序与入参一一对应（并行分片不会错位）', async () => {
    const rows = await runReadOnlyBatch<{ n: number }>(pool, [
      { sql: 'SELECT 1::int AS n' },
      { sql: 'SELECT 2::int AS n' },
      { sql: 'SELECT 3::int AS n' },
    ]);
    expect(rows.map(r => r[0]?.n)).toEqual([1, 2, 3]);
  });
});
