# HueDle 设计文档

> 每天随机抽一种颜色，看看它藏着哪些稀有徽章。
> 支持本地模式与登录模式，两种模式使用不同的随机种子逻辑。

本文档是项目的**主设计文档**，汇总原始需求与后续修订。徽章的具体实现契约见
[BADGE-SPEC.md](./BADGE-SPEC.md)，徽章表见 [BADGES.md](./BADGES.md)（待集成）。

**修订记录**

| 版本 | 变更 |
|---|---|
| v1 | 初版：双模式、family 去重计分、低稀有度阈值 |
| v2 | `family` 不再限制加分，仅作图鉴分类；所有命中徽章全部计分；稀有度阈值整体拉高；单徽章 CP 相应调低（见第 6 节） |

---

## 1. 项目定位

HueDle 是一个受 RNGdle 启发的**每日随机颜色收集游戏**。

- 每位玩家每天独立随机抽取一种 RGB 颜色；
- 不同玩家同一天可能抽到相同颜色，也可能不同；
- 每天一次，UTC 00:00 重置；
- 刷新页面结果不变；
- 不能重抽、不能购买、不能追加；
- CP 只用于评分和稀有度，**不是货币**。

---

## 2. 双模式设计

| 维度 | 本地模式 | 登录模式 |
|---|---|---|
| 用户标识 | localStorage 随机 UUID | 服务端账户 ID |
| 种子 | `日期 + 匿名 ID` | `日期 + 用户 ID` |
| 结果来源 | 前端计算 | 前端计算（种子来自服务端）或服务端下发 |
| 跨设备 | 不一致 | 一致 |
| 后端依赖 | 无 | 需要认证与同步 |
| 历史记录 | localStorage | 服务端数据库 |
| 迁移 | **不合并**（两种模式抽到的是不同颜色，见 §11.4） | —— |

### 2.1 为什么用不同种子逻辑

- **本地模式**：没有账户系统，用 `crypto.randomUUID()` 生成匿名 ID 存入 localStorage。
  种子 = `日期 + 匿名 ID`。同一设备同一天结果固定；换设备或清缓存会重置。
- **登录模式**：种子 = `日期 + 用户 ID`。用户 ID 由服务端分配，同一账户在任何设备上同一天结果一致。

两种模式**共用同一套颜色生成算法、徽章系统和评分逻辑**，只有种子来源不同。

---

## 3. 核心规则

1. 用户首次访问时，生成本地匿名 ID，存入 `localStorage`。
2. 用户可选择登录。登录后，使用服务端用户 ID 作为种子。
3. 每日种子：

```ts
// 本地模式
seed = `${utcDate}:local:${anonymousId}`

// 登录模式
seed = `${utcDate}:user:${userId}`
```

4. 同一天同一身份，结果固定；**首次抽取后即冻结**，刷新不变（无条件，见第 8 节）。
5. 跨天自动获得新颜色。
6. 每天只有一次抽取机会，不提供重抽、购买、追加。
7. CP 只用于评分和稀有度，不是货币。
8. 登录**不合并**本地历史——两种模式抽到的是不同的颜色，见第 11 节。

---

## 4. 技术选型

| 层 | 选择 |
|---|---|
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| 样式 | Tailwind CSS |
| 状态 | Pinia |
| 本地存储 | localStorage |
| 后端 | Node.js + Fastify / Hono |
| 数据库 | SQLite（开发）/ PostgreSQL（生产） |
| 认证 | JWT 或 Session |
| 分享图 | Canvas API |
| 测试 | Vitest |
| 部署 | 前端 Vercel，后端 Fly.io / Railway |

---

## 5. 目录结构

```text
huedle/
├─ apps/
│  ├─ web/                      # 前端
│  │  ├─ src/
│  │  │  ├─ components/
│  │  │  │  ├─ ColorCard.vue
│  │  │  │  ├─ BadgeList.vue
│  │  │  │  ├─ RarityBadge.vue
│  │  │  │  ├─ ShareCard.vue
│  │  │  │  └─ HistoryList.vue
│  │  │  ├─ composables/
│  │  │  │  ├─ useDailyColor.ts
│  │  │  │  ├─ useBadges.ts
│  │  │  │  ├─ useHistory.ts
│  │  │  │  └─ useAuth.ts
│  │  │  ├─ data/
│  │  │  │  ├─ badges.ts
│  │  │  │  └─ rarity.ts
│  │  │  ├─ lib/
│  │  │  │  ├─ seed.ts
│  │  │  │  ├─ color.ts
│  │  │  │  ├─ scoring.ts
│  │  │  │  ├─ identity.ts
│  │  │  │  └─ share.ts
│  │  │  ├─ pages/
│  │  │  │  ├─ Home.vue
│  │  │  │  ├─ History.vue
│  │  │  │  ├─ BadgeBook.vue
│  │  │  │  ├─ Login.vue
│  │  │  │  └─ About.vue
│  │  │  ├─ stores/
│  │  │  ├─ App.vue
│  │  │  └─ main.ts
│  │  └─ package.json
│  └─ api/                      # 后端
│     ├─ src/
│     │  ├─ routes/{auth,daily,history}.ts
│     │  ├─ db/
│     │  ├─ lib/
│     │  └─ index.ts
│     └─ package.json
├─ packages/
│  └─ shared/                   # 前后端共享类型与算法
│     └─ src/
│        ├─ types.ts
│        ├─ color.ts
│        ├─ seed.ts
│        ├─ scoring.ts
│        └─ badges/
│           ├─ helpers.ts
│           ├─ index.ts
│           └─ <family>.ts      # 家族文件（gray…casino，每族一个）
├─ docs/
│  ├─ DESIGN.md                 # 本文件
│  ├─ BADGE-SPEC.md             # 徽章实现契约
│  ├─ BADGES.md                 # 徽章总表（集成产出）
│  └─ badges/<family>.md        # 各家族文档
├─ package.json
└─ README.md
```

---

## 6. 计分模型（v2 修订）

### 6.1 改动对比

| 维度 | 旧方案 | 新方案 |
|---|---|---|
| 加分规则 | 同 family 只取最高分 | **所有命中徽章都加分** |
| family 作用 | 分组限分 | **仅用于图鉴分类** |
| 稀有度阈值 | 偏低 | **整体拉高** |
| 高分颜色 | 较难出现 | 可能由多条叠加出很高 CP |

### 6.2 计分逻辑

```ts
export function calculateScore(color: ColorInfo, badges: Badge[] = allBadges): ScoreResult {
  const hits = badges.filter(b => b.check(color)).sort(byCpDesc);

  // 同一 group 只保留 CP 最高的一条；无 group 的全部保留
  const bestByGroup = new Map<string, Badge>();
  const scoringBadges: Badge[] = [];
  for (const badge of hits) {
    if (!badge.group) { scoringBadges.push(badge); continue; }
    const current = bestByGroup.get(badge.group);
    if (!current || badge.cp > current.cp) bestByGroup.set(badge.group, badge);
  }
  scoringBadges.push(...bestByGroup.values());
  scoringBadges.sort(byCpDesc);

  const cp = scoringBadges.reduce((sum, b) => sum + b.cp, 0);
  const supersededBadges = hits.filter(b => !new Set(scoringBadges).has(b));

  return { badges: hits, scoringBadges, supersededBadges, cp, rarity: getRarity(cp) };
}
```

`family` 保留在 `Badge` 接口里，但只用于：

- 图鉴分类展示（如「数学家族 3/10」）；
- 前端筛选和分组；
- **不参与计分**。

实际实现见 [scoring.ts](../packages/shared/src/scoring.ts)。

### 6.2.1 `family` 与 `group` 的分工（v2 新增）

这是本项目**最容易混淆的一处**，来自 RNGdle 的教训（见 [研究笔记](./research/RNGDLE-NOTES.md) 第 5 节）：

| 字段 | 职责 | 是否参与计分 |
|---|---|---|
| `family` | **主题分类**（灰阶 / 数学 / 文化…），图鉴分组与筛选 | 否 |
| `group` | **取代组**（supersession），同组只取最高 CP | 是 |

- RNGdle 把这两件事分别放在 `badge sets`（16 个，不计分）和 `family`（取最高）里；
- HueDle 沿用了 `family` 这个名字做主题分类，因此取代职责另开 `group` 字段，**两者正交**。

**使用 `group` 的严格条件**：只在成员之间存在命中集合的**包含或高度重叠**，
且语义上是**同一条规则的不同强度/阈值档位**时使用。典型形状是阶梯：
`has-pair` / `two-pair` / `three-kind` / `four-kind` / `five-kind`。

**不要把主题相关或只是恰好相关的徽章同组**——后者（如 `pure-only-red` 天然蕴含
`pattern-echo`）是不同维度，玩家应当同时拿到两笔分。

registry 测试会强制校验：每个 group ≥2 名成员，且成员必须在大规模采样上**真的被同时命中过**。
所以**凑不出合法的 group 就不要加**。

### 6.3 单徽章 CP 与全局配额（**已被概率定价取代，见 6.5**）

> ⚠️ 本节描述的是 v2 的**手填模型**，正在被 [PRICING-SPEC.md](./PRICING-SPEC.md) 的概率定价取代。
> 保留在此仅为记录迁移前的状态。

~~因为允许叠加，单个徽章的 CP 必须克制，否则一条神话徽章直接顶到天花板。~~

| rarity | ~~单徽章 CP 区间~~ | 设计意图 |
|---|---|---|
| common | ~~5–15~~ | 基础特征 |
| uncommon | ~~20–40~~ | 命中 2–3 条的量级 |
| rare | ~~50–100~~ | 明显特殊 |
| epic | ~~120–200~~ | 强特征 |
| anomaly | ~~250–400~~ | 极窄条件 |
| mythic | ~~500–800~~ | 唯一/精确色 |

**全局配额**（mythic ≤ 4、每家族 epic ≤ 2）同样作废——稀有度不再由作者选择。

### 6.4 为什么手填 CP 失败了

实测暴露的问题：**`#000000` 与 `#002FA7` 的抽到概率完全相同（都是 `1/2²⁴`），
CP 却是 2337 vs 876，稀有度差两档。**

根因：手填 CP 被 rarity 区间**封顶在 800**，于是一条 `p = 6×10⁻⁸` 的规则和一条
`p = 0.27` 的规则只差一个数量级，而真实跨度是 **10⁷**。20 条一叠，噪声盖过信号。

结论：总分衡量的是「命中规则的条数」，而不是「这个颜色有多难抽到」。
**稀有度这个词的最低要求是同概率同分，手填模型做不到。**

### 6.5 概率定价（**现行模型**）

完整规则见 **[PRICING-SPEC.md](./PRICING-SPEC.md)**，要点：

```
N  = 2^24 = 16,777,216          # 颜色空间
p  = hits / N                    # 由全色域枚举实测
ep = 100 / p                     # 该徽章的 CP（推导值，不手填）
```

- **徽章 rarity** = `ep` 的十进制分档（`1e3 / 1e4 / 1e5 / 1e6 / 1e7`），
  等价于 `p` 的分档（`0.1 / 0.01 / 0.001 / 1e-4 / 1e-5`），与空间大小无关；
- **抽取 rarity** = 总分在全色域分布中的**百分位**
  （`1 / 50 / 75 / 90 / 95 / 99`），比绝对阈值更稳、永远不会因扩表失效；
- `BadgeRarity` 与 `ScoreRarity` 拆成**两个独立类型**（后者多一个最低档 `trash`）。

> ⚠️ 旧版阈值（0–20 / 21–80 / 81–200 / 201–500 / 501–1000 / 1000+）已作废，请勿再引用。

### 6.6 反冗余与取代机制

去掉 family 限分后，需要两套互补的机制：

1. **`group` 取代（机制层）** —— 见 6.2.1。同一条规则的不同强度档位归入同一 group，由引擎取最高分。
   这样作者可以**自然地写重叠的「至少型」规则**，而不必把条件掰成互斥的「恰好型」。
2. **反冗余规范 + 自动审计（纪律层）** —— 不同维度的徽章仍可能单向包含
   （如 `pure-only-red` ⊆ `pattern-echo`）。这类**允许共存**，但需要可观测：
   用全色域枚举出的共现矩阵与 Jaccard 相似度来暴露它们（见 [研究笔记](./research/RNGDLE-NOTES.md) 第 6.5 节）。

> 关键区分：`group` 解决的是「同一条规则被重复计分」，不是「两条规则相关」。
> 把后者也塞进 group 会静默吞掉玩家得分。

---

## 7. 核心算法

### 7.1 身份标识

```ts
// apps/web/src/lib/identity.ts
const ANON_KEY = 'huedle:anonymousId';

export function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}
```

```ts
interface User {
  id: string;
  name: string;
}
```

### 7.2 种子与颜色生成

```ts
// packages/shared/src/seed.ts
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Identity =
  | { mode: 'local'; anonymousId: string }
  | { mode: 'user'; userId: string };

export function getDailyColor(identity: Identity, date = new Date()): RGB {
  const day = date.toISOString().slice(0, 10);

  const seed =
    identity.mode === 'local'
      ? `${day}:local:${identity.anonymousId}`
      : `${day}:user:${identity.userId}`;

  const value = fnv1a(seed) % 0x1000000;

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}
```

**关键点**

- 本地模式：种子依赖本机匿名 ID，换设备结果不同；
- 登录模式：种子依赖账户 ID，跨设备一致；
- 两种模式共用同一套颜色生成与评分逻辑。

### 7.3 颜色转换

```ts
export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

export interface ColorInfo extends RGB {
  hex: string;   // "#002FA7"，大写带 #
  hsl: HSL;      // h∈[0,360) s,l∈[0,100]
}

export function toColorInfo(rgb: RGB): ColorInfo {
  const hex = `#${[rgb.r, rgb.g, rgb.b]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

  return { ...rgb, hex, hsl: rgbToHsl(rgb) };
}
```

---

## 8. 前端每日流程

```ts
// apps/web/src/composables/useDailyColor.ts
export async function playDaily(user: User | null) {
  const today = new Date().toISOString().slice(0, 10);

  const identity = user
    ? { mode: 'user' as const, userId: user.id }
    : { mode: 'local' as const, anonymousId: getAnonymousId() };

  // 检查今天是否已抽
  const stored = await loadTodayResult(today);
  if (stored) return stored;

  const rgb = getDailyColor(identity);
  const color = toColorInfo(rgb);
  const result = calculateScore(color);

  await saveResult({ date: today, ...result });

  return result;
}
```

### 结果读取优先级（**抽出即定**）

| 模式 | 读取顺序 |
|---|---|
| 本地模式 | localStorage 中的 `huedle:daily`；**存在即权威** |
| 登录模式 | 服务端 `GET /api/daily`；失败则回退本地缓存 |

**「冻结」是同一条规则在两端的体现**：当天**首次**抽取时算出结果并落盘，
此后无论哪一端都以存档为准，**不再重算**。纯函数只负责产出那唯一一次的结果。

这样「刷新不变」才是**无条件**的——即使之后部署了新徽章、修了某条 `check`、
重跑了定价，玩家这一天已经看到的结果也不会中途变化。
存档里的 `cp` 与命中集合是权威值；展示用的徽章对象按 id 从当前徽章表解析
（`name` / `description` 允许随版本更新），取代关系由存档的命中集合按 group 规则推出。

---

## 9. 后端接口

### 9.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录，返回 token |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 获取当前用户 |

### 9.2 每日结果

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/daily` | 获取今日结果（若未抽则生成并保存） |
| GET | `/api/history` | 获取历史记录 |

### 9.3 每日结果生成（服务端）

> 与本地模式共用同一条**冻结**规则：当天已有记录就原样返回，**不再重算**。
> 若之后发布新徽章，新规则只影响尚未抽取的日期与账户。

```ts
app.get('/api/daily', async (req, res) => {
  const user = req.user;
  const today = new Date().toISOString().slice(0, 10);

  let record = await db.getDaily(user.id, today);

  if (!record) {
    const rgb = getDailyColor({ mode: 'user', userId: user.id });
    const color = toColorInfo(rgb);
    const result = calculateScore(color);

    record = await db.saveDaily({
      userId: user.id,
      date: today,
      hex: color.hex,
      cp: result.cp,
      rarity: result.rarity,
      badgeIds: result.badges.map(b => b.id),
    });
  }

  res.json(record);
});
```

---

## 10. 数据库设计

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  password    TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE daily_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  hex         TEXT NOT NULL,
  cp          REAL NOT NULL,          -- 未取整的浮点：ep 之和，见 PRICING-SPEC
  rarity      TEXT NOT NULL,
  badge_ids   TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_user_date ON daily_results(user_id, date);
```

---

## 11. 模式切换（**不做历史迁移**）

### 11.1 未登录时
- 使用 `anonymousId` 作为种子；
- 结果存入 localStorage；
- 历史记录存 localStorage。

### 11.2 登录后
- 使用服务端 `userId` 作为种子；
- 结果存服务端，同时缓存到 localStorage；
- **本地历史不合并**（理由见 11.4），只做一次性提示。

### 11.3 登出后
- 恢复使用 `anonymousId`（该 ID **登录时不清除**）；
- 本地历史与今日结果**原样恢复**——因为一切都是 `(身份, 日期)` 的纯函数，
  登出后重算一遍就是同一个颜色、同一条历史，**什么都不会丢**。

### 11.4 为什么删除「合并本地历史」

原设计有 `POST /api/migrate` + `migrateLocalHistory()`。**已废弃**，三条独立理由：

**① 两种模式抽到的根本不是同一个颜色。**

```
本地：seed = `${day}:local:${anonymousId}`
账户：seed = `${day}:user:${userId}`
```

同一天本地拿到 A、账户拿到 B，是**两次不同的抽取**，不是同一结果的不同存储。
合并会让同一天出现两条不同结果，而 `daily_results` 有 `UNIQUE(user_id, date)` —— 直接冲突。
（原设计的 `migrateLocalHistory()` 没有任何冲突解决逻辑，本身就欠定义。）

**② 本地历史在构造上不可信。**

颜色 = `fnv1a(day + ':local:' + anonymousId) % 2²⁴`，而 `anonymousId` **由客户端生成**。
玩家可以暴力枚举 `anonymousId` 直到得到想要的颜色，再伪造一条高 CP 记录提交。
**让客户端往账户历史里写行，是信任边界漏洞**，不是功能问题。

**③ 「绑定匿名 ID 到账户」是更糟的替代方案。**

若为了保留连续性而把 `anonymousId` 当作账户未来的种子，等于**让客户端选择账户种子**：
玩家可以预先 grind 出一个能在未来任意日期产出稀有颜色的 ID，且永久生效。
**账户种子必须由服务端分配**，客户端永远不能影响它。

### 11.5 登录时的行为约定

- 保留 `huedle:anonymousId`，不清除；
- 给一次提示：「本地记录不会并入账户——两种模式抽到的是不同的颜色」；
- 明确「每天一次」的准确表述：

> **每个身份每天一次。切换身份，就是切换到该身份对应的那一次。**
> 本地抽了今天再登录，会看到账户身份的今日颜色——那不是"多抽了一次"，
> 而是两个身份各自的今日颜色。

### 11.6 服务端必须自行重算

客户端提交的结果**一律不可信**（同理，客户端可以只发一个假 CP 过来）。
`GET /api/daily` 必须服务端用 `userId` 自己生成（见第 9.3 节），客户端算的只用于展示。

---

## 12. 徽章系统

每条徽章是一个纯函数，前后端共享。

**作者手写的部分（`BadgeDef`）与派生的定价（`Badge`）是分开的** ——
作者只写规则，`cp` / `rarity` 由全色域枚举出的概率注入，见 [PRICING-SPEC.md](./PRICING-SPEC.md) 第 5 节：

```ts
// 作者手写（packages/shared/src/badges/<family>.ts）
export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  family: Family;   // 仅用于图鉴分类，不参与计分
  group?: string;   // 取代组：同组只取最高 CP
  check: (color: ColorInfo) => boolean;
}

// 由 barrel 合成（packages/shared/src/badges/index.ts）
export interface Badge extends BadgeDef {
  cp: number;          // = ep = 100 / p，p 来自 2²⁴ 枚举
  rarity: BadgeRarity; // 由 cp 按十进制分档导出
}
```

`packages/shared/src/badges/index.ts` 负责把两者合成，并在定价缺失时**直接抛错**
（而不是静默给 0 分）——静默降级是这类系统里最难发现的 bug。

### 12.1 十大分类

| family | 中文 | 条数 | 代表色 | 玩什么 |
|---|---|---|---|---|
| `gray` | 灰阶 | 6 | `#808080` | R=G=B 的不同维度 |
| `extreme` | 极端 | 6 | `#FF0000` | 色域边界 |
| `pure` | 纯色 | 6 | `#FF0000` | 单通道点亮 |
| `channel` | 通道 | 6 | `#00FF00` | 通道序与关系 |
| `math` | 数学 | 10 | `#010101` | 数论与位模式 |
| `perception` | 感知 | 8 | `#FF6600` | 视觉感知维度 |
| `pattern` | 模式 | 8 | `#A5A5A5` | 十六进制结构 |
| `culture` | 文化 | 8 | `#002FA7` | 真实文化色 |
| `lucky` | 玄学 | 6 | `#FFD700` | 数字梗 |
| `casino` | 牌型 | 12 | `#C8102E` | 十六进制字符的扑克牌型 |

总数会随增补变化，**不要在这里写死**——以 [BADGES.md](./BADGES.md) 的「徽章总数」为准（自动生成）。

### 12.2 图鉴展示

family 作为分类维度：

```text
数学家族        3 / 12
├─ 二进制之美   已收集
├─ 质数三连     已收集
├─ 回文色       未收集
└─ ...

文化家族        1 / 8
├─ 克莱因蓝     已收集
└─ ...
```

---

## 13. 页面与组件

| 页面 | 功能 |
|---|---|
| Home | 今日取色、结果展示、分享 |
| History | 历史记录（本地或服务端） |
| BadgeBook | 徽章图鉴（按 family 分组） |
| Login | 登录 / 注册 |
| About | 规则说明 |

核心组件：`ColorCard`、`BadgeList`、`RarityBadge`、`ShareCard`、`HistoryList`。

---

## 14. 本地存储

| Key | 内容 | 模式 |
|---|---|---|
| `huedle:anonymousId` | 匿名 ID | 本地 |
| `huedle:daily` | 当天颜色与日期 | 本地 |
| `huedle:history` | 历史抽取记录 | 本地 |
| `huedle:streak` | 连续天数 | 本地 |
| `huedle:token` | 登录 token | 登录 |

```ts
interface HistoryItem {
  date: string;
  hex: string;
  cp: number;
  rarity: ScoreRarity;
  badgeIds: string[];
}
```

---

## 15. 分享逻辑

分享卡片展示：

- 今日颜色色块 + HEX；
- 命中的徽章列表；
- 总 CP 和稀有度；
- 一句引导语："你今天抽到了什么颜色？"

好友点开后看到的是自己的结果，可能相同也可能不同。

---

## 16. 开发里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | monorepo 结构（web + api + shared）、Vite + Vue 3 + TS + Tailwind、路由、Pinia | 🚧 web 脚手架进行中（shared 已完成） |
| 2 | 核心算法：双模式种子、颜色生成与转换、单元测试 | ✅ **完成**（`seed.ts` 17 例 + `color.ts` 13 例 + `helpers.ts` 13 例） |
| 3 | 本地模式：匿名 ID、每日抽取、本地历史、刷新不变 | 🚧 进行中 |
| 4 | 徽章与评分 | ✅ **完成且超出原计划**：起始 76 条 / 10 家族（后经多次增补，当前数量见 [BADGES.md](./BADGES.md)），并已从「手填 CP」迁移到**概率定价**（2²⁴ 全色域枚举导出 `ep = 100/p`），取代组与死徽章审计全绿 |
| 5 | 登录模式：注册/登录/登出、服务端每日结果、历史查看 | 未开始（`apps/api` 尚未创建） |
| 6 | 分享与图鉴：Canvas 分享卡片、徽章图鉴、连续天数 | 未开始 |
| 7 | 测试与部署：Vitest 覆盖核心算法、前后端部署、端到端测试 | 🚧 单元测试已充分；部署未开始 |

### 16.1 相对原始计划的偏差（记录在案）

- **阶段 4 的规模与模型都变了**：原计划「徽章规则 30+/60+、CP 手填、稀有度阈值估计」，
  实际首批做了 76 条徽章，并因实测发现「同概率不同分」的问题，把定价整体改成概率推导
  （见 [PRICING-SPEC.md](./PRICING-SPEC.md)）。
- **新增了原始计划没有的机制**：`group` 取代组（对应 RNGdle 的 supersession）。
- **多了一整套可复现的验证流水线**：全色域枚举（`run enumerate`）、取代审计
  （`run supersession`）、文档一致性（`run docs`），均有脚本与 CI 化的测试。

---

## 17. 测试重点

- 本地模式：同一天同一匿名 ID，多次调用返回相同颜色
- 登录模式：同一天同一 userId，多次调用返回相同颜色
- 本地模式和登录模式使用不同种子，结果不同
- 跨天后返回新颜色
- **刷新后结果不变（无条件）**：存档写入后，即使徽章表变化也不得改动该日的 `cp` / `rarity`
- **存档是权威**：日期对不上的存档视为无；非法存档退回首次抽取而不白屏
- 同一天不能重复抽取
- 徽章规则边界
- **所有命中徽章均计分，同 `group` 只取最高（v2）**
- **`group` 成员必须真的重叠**（全色域穷举，成员互斥的分组判失败）
- **定价不变量（v3）**：`cp === epFromHits(hits)`、`rarity === badgeRarityFromEp(cp)`、
  同 `hits` 必同 `ep`、`hits` 越少 `ep` 越大、无 `hits === 0` 的死徽章
- **抽取档位自洽（v3）**：用分位表反算各 `ScoreRarity` 档占比必须落在定义区间内
- **无计分死徽章（v3）**：不存在被同组 100% 取代的成员
- **登出后本地结果可完整恢复**（同一天同匿名 ID 得到同一颜色与同一历史）
- **本地历史不会被并入账户**（`POST /api/migrate` 已废弃，见 §11.4）
- **服务端不采信客户端提交的结果**，必须用 `userId` 自行重算

---

## 18. 注意事项

- 两种模式共用颜色生成与评分逻辑，仅种子来源不同。
- 本地模式无需后端，登录模式需要后端。
- 每日一次，UTC 00:00 重置。
- 刷新不变，不能重抽、不能购买、不能追加。
- CP 不是货币，只是评分。
- 本地模式的匿名 ID 不可用于跨设备同步。
- 登录模式的结果以服务端为准。
- `family` 仅作图鉴分类，不参与计分（v2）。

---

## 19. 一句话总结

HueDle 是一个支持双模式的每日随机颜色收集游戏：本地模式用 localStorage 匿名 ID 作为种子，
无需登录即可游玩；登录模式用服务端用户 ID 作为种子，跨设备一致。两种模式共用同一套颜色生成、
徽章和评分系统，仅种子逻辑不同。所有命中的徽章都会叠加计分（同 `group` 只取最高），
`family` 只用于图鉴分类。每条徽章的 CP 由它的**实测概率**导出（`ep = 100/p`，p 来自 2²⁴ 全色域枚举），
因此**同概率必然同分**，作者无法手挑稀有度；抽取稀有度由总分的**百分位**决定
（神话恒为前 1%）。每天一次，刷新不变，不能购买，不能重抽。
