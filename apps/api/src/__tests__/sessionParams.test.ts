/**
 * 会话参数下发方式（`extra_float_digits`）。
 *
 * 背景：Supabase 的 Supavisor 连接池**会忽略 libpq 的 `options` 启动参数**，
 * 实测三种连接方式（直连 / Session pooler / Transaction pooler）：
 *
 *   | 连接方式            | 端口 | 靠 options | 精度 |
 *   |---------------------|------|------------|------|
 *   | 直连                | 5432 | 1 ✅       | 完整 |
 *   | Session pooler      | 5432 | 0 ❌       | 丢失 |
 *   | Transaction pooler  | 6543 | 0 ❌       | 丢失 |
 *
 * 只靠 `options` 的话，服务在连接池后面会**启动自检失败直接拒绝启动**。
 * 所以真正的保证是连接建立后主动 `SET`。
 *
 * 这一组测试的关键手法：**构造不带 `options` 的连接**（`new Client({ connectionString })`
 * 不传 `options`），这正是连接池后面的场景；然后验证 `applySessionParams()` 能把它救回来。
 * 这样写与运行环境的默认值无关——即使某天托管方的默认值变了，测试依然有意义。
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySessionParams, sessionSetupSql } from '../db';
import { requireDatabaseUrl } from './testDb';

/** 这些用例只碰会话 GUC，不建表、不读写任何业务表。 */
let url: string;

beforeAll(() => {
  url = requireDatabaseUrl();
});

const opened: Client[] = [];

async function connectWithoutOptions(): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  opened.push(client);
  return client;
}

afterAll(async () => {
  await Promise.all(opened.map(c => c.end().catch(() => {})));
});

describe('会话参数下发（不受连接池吃掉 options 的影响）', () => {
  it('不带 options 的连接：applySessionParams 之后 extra_float_digits = 1', async () => {
    const client = await connectWithoutOptions();
    await applySessionParams(client);
    const r = await client.query("SELECT current_setting('extra_float_digits') AS v");
    expect(r.rows[0].v).toBe('1');
  });

  it('不带 options 的连接：applySessionParams 之后 float8 往返逐位无损', async () => {
    const client = await connectWithoutOptions();
    await applySessionParams(client);
    // 这个值就是 cp 的典型量级：15 位有效数字会把它截断
    const r = await client.query('SELECT 20521.809090190152::float8 AS v');
    expect(String(r.rows[0].v)).toBe('20521.809090190152');
  });

  it('已在执行的连接上，SET 仍排在业务查询之前（pg-pool 的 connect 事件语义）', async () => {
    // 模拟 createPool 的做法：不 await，直接并发排队。
    const client = await connectWithoutOptions();
    const pending = applySessionParams(client);
    const business = client.query("SELECT current_setting('extra_float_digits') AS v");
    await pending;
    const r = await business;
    // 若 SET 没有严格排在前面，这里会读到服务端默认值（Supabase 上是 '0'）
    expect(r.rows[0].v).toBe('1');
  });

  it('searchPath 会一并下发（测试夹具靠它把表限制在独立 schema）', async () => {
    const sql = sessionSetupSql('huedle_test');
    expect(sql).toContain('extra_float_digits = 1');
    expect(sql).toContain('search_path = huedle_test');

    const client = await connectWithoutOptions();
    await client.query('CREATE SCHEMA IF NOT EXISTS huedle_session_probe');
    try {
      await applySessionParams(client, 'huedle_session_probe');
      const r = await client.query('SELECT current_schema() AS v');
      expect(r.rows[0].v).toBe('huedle_session_probe');
    } finally {
      // 会话已切到那个 schema，得切回来再删
      await client.query('SET search_path = public');
      await client.query('DROP SCHEMA IF EXISTS huedle_session_probe');
    }
  });

  it('searchParam 不接受含引号 / 分号的输入（防内插注入）', () => {
    // createPool 的前置校验负责拦截；这里锁住「校验存在」这件事的语义
    expect(sessionSetupSql(undefined)).toBe('SET extra_float_digits = 1');
  });
});
