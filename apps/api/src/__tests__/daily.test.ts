/**
 * 每日结果与历史用例（任务书 F 节 5–9）。
 *
 * 最关键的两条：
 *   - 「与 shared 交叉验证」：测试自己拿 `getDailyColor` + `calculateScore`
 *     用**服务端分配的 userId** 独立算一遍，逐字段比对接口返回值；
 *   - 「并发安全」：并发 N 个 `GET /api/daily`，最终表里只有 1 行、响应完全一致
 *     （SQLite → Postgres 迁移最容易出问题的地方）。
 */
import { calculateScore, getDailyColor, getDailyColorInfo, utcDate } from '@huedle/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { Store } from '../db';
import { computeStreak } from '../lib/streak';
import { authHeaders, makeHarness, registerUser, TEST_RATE_LIMIT } from './helpers';
import { getTestPool, registerTestDatabase } from './testDb';

registerTestDatabase();

const DAY = new Date('2026-03-04T05:06:07.000Z');
const DAY_STR = utcDate(DAY);

describe('GET /api/daily', () => {
  it('未认证 → 401', async () => {
    const { app } = await makeHarness();
    expect((await app.request('/api/daily')).status).toBe(401);
  });

  it('同一天调两次：响应完全一致，且 daily_results 只有 1 行', async () => {
    const { app, store, pool } = await makeHarness({ now: () => DAY });
    const { token } = await registerUser(app, 'alice');

    const first = await app.request('/api/daily', { headers: authHeaders(token) });
    const second = await app.request('/api/daily', { headers: authHeaders(token) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await first.text();
    const b = await second.text();
    expect(a).toBe(b);

    expect(await store.countDaily()).toBe(1);
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM daily_results');
    expect(rows.rows[0].n).toBe(1);
  });

  it('并发 8 个 GET /api/daily：只插出 1 行，且所有响应逐字节一致', async () => {
    const { app, store, pool } = await makeHarness({ now: () => DAY });
    const { token } = await registerUser(app, 'alice');

    const CONCURRENCY = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.request('/api/daily', { headers: authHeaders(token) }),
      ),
    );
    const bodies = await Promise.all(responses.map(res => res.text()));

    expect(responses.map(res => res.status)).toEqual(Array(CONCURRENCY).fill(200));
    expect(new Set(bodies).size).toBe(1);

    expect(await store.countDaily()).toBe(1);
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM daily_results');
    expect(rows.rows[0].n).toBe(1);
  });

  it('响应形状与前端 HistoryItem 一致（+ streak），且内容等于 shared 的独立重算', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const { token, user } = await registerUser(app, 'alice');

    const res = await app.request('/api/daily', { headers: authHeaders(token) });
    const body = (await res.json()) as {
      date: string;
      hex: string;
      cp: number;
      rarity: string;
      badgeIds: string[];
      streak: number;
    };

    // —— 独立重算：种子 = 服务端分配的 userId ——
    const expectedColor = getDailyColorInfo({ mode: 'user', userId: user.id }, DAY);
    const expectedScore = calculateScore(expectedColor);

    // 原有 5 个字段形状不变，只是多了一个 streak。
    expect(Object.keys(body).sort()).toEqual(['badgeIds', 'cp', 'date', 'hex', 'rarity', 'streak']);
    expect(body).toEqual({
      date: DAY_STR,
      hex: expectedColor.hex,
      cp: expectedScore.cp,
      rarity: expectedScore.rarity,
      badgeIds: expectedScore.badges.map(b => b.id),
      // 新用户当天刚生成记录 → 前端口径 computeStreak 为 1
      streak: 1,
    });
    // 也与最底层的 RGB 生成器对齐（防止 hex 转换处出岔）
    expect(body.hex).toBe(
      `#${Object.values(getDailyColor({ mode: 'user', userId: user.id }, DAY))
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`,
    );
  });

  it('两个不同用户的当天颜色不同（概率上）', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    const a = (await (await app.request('/api/daily', { headers: authHeaders(alice.token) })).json()) as { hex: string };
    const b = (await (await app.request('/api/daily', { headers: authHeaders(bob.token) })).json()) as { hex: string };

    expect(a.hex).not.toBe(b.hex);
  });

  it('客户端提交的 hex / cp / badgeIds 被完全无视', async () => {
    const { app, store } = await makeHarness({ now: () => DAY });
    const { token, user } = await registerUser(app, 'alice');
    const expected = calculateScore(getDailyColorInfo({ mode: 'user', userId: user.id }, DAY));

    // fetch 规范禁止 GET 带 body（Node 直接抛 TypeError），所以把「客户端提交值」
    // 塞在 query 与 header 里 —— 这是能在同一请求上触达 handler 的等价攻击面。
    const res = await app.request(
      `/api/daily?hex=%23000000&cp=999999&rarity=mythic&badgeIds=casino-six-kind&userId=attacker`,
      {
        headers: {
          ...authHeaders(token),
          'x-huedle-hex': '#000000',
          'x-huedle-cp': '999999',
          'x-huedle-badge-ids': 'casino-six-kind',
        },
      },
    );
    const body = (await res.json()) as { hex: string; cp: number; badgeIds: string[] };

    expect(body.hex).not.toBe('#000000');
    expect(body.cp).not.toBe(999999);
    expect(body.badgeIds).not.toEqual(['casino-six-kind']);
    expect(body.hex).toBe(getDailyColorInfo({ mode: 'user', userId: user.id }, DAY).hex);
    expect(body.cp).toBe(expected.cp);
    expect(body.badgeIds).toEqual(expected.badges.map(b => b.id));

    // 也没有任何接口接受客户端提交的结果：POST /api/daily 根本不存在
    const post = await app.request('/api/daily', {
      method: 'POST',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ hex: '#000000', cp: 999999, badgeIds: ['casino-six-kind'] }),
    });
    expect(post.status).toBe(404);
    expect(await store.countDaily()).toBe(1);
  });

  it('账户种子只认服务端 userId：用户名不参与种子', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const { token, user } = await registerUser(app, 'alice');
    const body = (await (await app.request('/api/daily', { headers: authHeaders(token) })).json()) as { hex: string };

    // 用用户名当种子算出来的是另一个颜色（若实现里混进了 name，这条会挂）
    const byName = getDailyColor({ mode: 'user', userId: user.name }, DAY);
    const byNameHex = `#${[byName.r, byName.g, byName.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    expect(body.hex).not.toBe(byNameHex);
  });
});

/**
 * `streak` 口径必须与前端 `apps/web/src/lib/storage.ts` 的 `computeStreak` **完全一致**，
 * 因此期望值直接沿用前端 `streak.test.ts` 里那几条（连续 3 天 → 3、断档 → 2、今天不在 → 0）。
 */
describe('GET /api/daily 的 streak（与前端 computeStreak 同口径）', () => {
  /** 以权威写入路径预置某一天的存档；streak 只关心 `date`，其余字段给合法值即可。 */
  async function seedDay(store: Store, userId: string, date: string): Promise<void> {
    await store.insertDailyIfAbsent({
      userId,
      date,
      hex: '#000000',
      cp: 1,
      rarity: 'trash',
      badgeIdsJson: '[]',
      createdAt: `${date}T00:00:00.000Z`,
    });
  }

  it('今天有记录 → 1；同一天再调用仍是 1，且响应逐字节一致', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const { token } = await registerUser(app, 'alice');

    const first = await app.request('/api/daily', { headers: authHeaders(token) });
    const firstText = await first.text();
    const second = await app.request('/api/daily', { headers: authHeaders(token) });
    const secondText = await second.text();

    expect((JSON.parse(firstText) as { streak: number }).streak).toBe(1);
    expect((JSON.parse(secondText) as { streak: number }).streak).toBe(1);
    expect(secondText).toBe(firstText);
  });

  it('连续 3 天（含今天）→ 3', async () => {
    const { app, store } = await makeHarness({ now: () => DAY });
    const { token, user } = await registerUser(app, 'alice');
    await seedDay(store, user.id, '2026-03-03');
    await seedDay(store, user.id, '2026-03-02');

    const body = (await (await app.request('/api/daily', { headers: authHeaders(token) })).json()) as {
      streak: number;
    };
    expect(body.streak).toBe(3);
  });

  it('中间断档：只数到今天往回的第一个连续段 → 2', async () => {
    const { app, store } = await makeHarness({ now: () => DAY });
    const { token, user } = await registerUser(app, 'alice');
    // 有 03-03 与 03-01，缺 03-02 → 03-02 处断链
    await seedDay(store, user.id, '2026-03-03');
    await seedDay(store, user.id, '2026-03-01');

    const body = (await (await app.request('/api/daily', { headers: authHeaders(token) })).json()) as {
      streak: number;
    };
    expect(body.streak).toBe(2);
  });

  it('今天没记录 → 0（端点总会补上今天，故在纯函数层对齐前端定义）', () => {
    expect(computeStreak(new Set(['2026-03-02', '2026-03-03']), '2026-03-04')).toBe(0);
  });

  it('只看自己的记录：别人的连续天数不算进来', async () => {
    const { app, store } = await makeHarness({ now: () => DAY });
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await seedDay(store, bob.user.id, '2026-03-03');
    await seedDay(store, bob.user.id, '2026-03-02');

    const body = (await (await app.request('/api/daily', { headers: authHeaders(alice.token) })).json()) as {
      streak: number;
    };
    expect(body.streak).toBe(1); // alice 只有今天
  });

  it('往返成本：当天已有记录时整条请求只打 2 次库（认证 JOIN + listDaily），streak 不再额外查', async () => {
    const { app, pool } = await makeHarness({ now: () => DAY });
    const { token } = await registerUser(app, 'alice');
    // 先暖一次，让今天的记录落库
    await app.request('/api/daily', { headers: authHeaders(token) });

    const spy = vi.spyOn(pool, 'query');
    try {
      const res = await app.request('/api/daily', { headers: authHeaders(token) });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { streak: number }).streak).toBe(1);
      // 认证 1 次（JOIN）+ listDaily 1 次；若 streak 又单独发了查询，这里会是 3。
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('GET /api/history', () => {
  it('需要认证', async () => {
    const { app } = await makeHarness();
    expect((await app.request('/api/history')).status).toBe(401);
  });

  it('新用户为空数组；多天记录按日期降序返回', async () => {
    const pool = getTestPool();
    const store = new Store(pool);

    const dayA = new Date('2026-01-01T12:00:00.000Z');
    const dayB = new Date('2026-01-05T12:00:00.000Z');
    const appA = createApp({ store, rateLimit: TEST_RATE_LIMIT, now: () => dayA });
    const appB = createApp({ store, rateLimit: TEST_RATE_LIMIT, now: () => dayB });

    const { token, user } = await registerUser(appA, 'alice');

    const empty = await appA.request('/api/history', { headers: authHeaders(token) });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    await appA.request('/api/daily', { headers: authHeaders(token) });
    await appB.request('/api/daily', { headers: authHeaders(token) });

    const res = await appA.request('/api/history', { headers: authHeaders(token) });
    const items = (await res.json()) as Array<{ date: string; hex: string }>;

    expect(items).toHaveLength(2);
    expect(items.map(i => i.date)).toEqual(['2026-01-05', '2026-01-01']);

    // 每一条都与 shared 的重算一致
    for (const item of items) {
      const at = new Date(`${item.date}T12:00:00.000Z`);
      const expected = getDailyColorInfo({ mode: 'user', userId: user.id }, at);
      expect(item.hex).toBe(expected.hex);
    }
  });

  it('只看得到自己的历史', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    await app.request('/api/daily', { headers: authHeaders(alice.token) });

    const aliceHistory = await app.request('/api/history', { headers: authHeaders(alice.token) });
    expect(await aliceHistory.json()).toHaveLength(1);

    const bobHistory = await app.request('/api/history', { headers: authHeaders(bob.token) });
    expect(await bobHistory.json()).toEqual([]);
  });

  it('响应形状不变：每条仍是 5 个字段，**没有** streak（streak 只加在 /api/daily）', async () => {
    const { app } = await makeHarness({ now: () => DAY });
    const { token } = await registerUser(app, 'alice');
    await app.request('/api/daily', { headers: authHeaders(token) });

    const items = (await (await app.request('/api/history', { headers: authHeaders(token) })).json()) as Array<
      Record<string, unknown>
    >;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!).sort()).toEqual(['badgeIds', 'cp', 'date', 'hex', 'rarity']);
  });
});
