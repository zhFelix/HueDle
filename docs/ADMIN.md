# 本地管理后台：形态、只读统计、加徽章流水线

> 本文是**开发前的设计契约**，不是实现。
>
> 范围硬边界（用户原话）：**只读统计 + 添加 badge**，**管理后台在本地**。
>
> 三条不可违背的约束，本文所有决策都必须服从：
> ① 绝不能进生产（不加 `/admin` 到 `apps/api`，不加 `/admin` 页面到 `apps/web`）；
> ② 「添加 badge」本质是**改源码 + 重跑枚举 + 重生成文档 + 跑测试**，不是插数据库；
> ③ 不引入任何新依赖（只用 monorepo 已有的）。

**修订记录**

| 版本 | 变更 |
|---|---|
| v1 | 初版：形态裁决（CLI + 静态 HTML 报告，不做 Web 服务）、8 条只读统计指标、加徽章流水线与失败回滚分类、文件所有权与「能否只新建」结论、测试策略、安全边界、待拍板项 |
| v2 | **补充实现了「只读统计」的本地 UI**（§1.1 的裁决在这一点上被修改，理由与边界见下方 §1.7）。**加徽章仍是 CLI**，v1 关于它的论证不受影响。另修正 §4.1 的 `addbadge/*` 标注为「计划中」，并去掉已不存在的 `render/markdown.ts` |
| v3 | **加徽章实现为「CLI + UI 表单」，但管道跑在 detached 子进程里**（§1.7 末尾的补充）。§1.5 的三条约束仍然全部照做，另外补齐了 §1.7 说的「任务与回滚的持久化设计」：状态文件（轮询，不用 SSE/WebSocket）+ `O_EXCL` 锁 + 子进程自持的回滚。§4.1 的 `addbadge/*` 已全部落地 |

---

## 0. 前置事实核对（写设计前先读代码的结论）

这一节不是背景介绍，是后面所有决策的依据。每一条都可在代码里复核。

| # | 事实 | 来源 |
|---|---|---|
| F1 | 徽章共 **128** 条、10 个家族。`check` 形态实测：**70 条**是「单表达式且只用 `helpers.ts` + `ColorInfo` 字段/字面量」，**34 条**是「单表达式但引用了本文件私有 helper」，**24 条**是「多语句块体」。34 条里：`onRanks` 11、`exactHex` 10、`spread` 5、`allCharsIn` 3、`hasTripleRun` 2、`allCharsDistinct` 1、`countDigit` 1、`fullChannelCount` 1 | 对 `packages/shared/src/badges/*.ts` 逐对象解析统计（见 §3.2 的覆盖率论证） |
| F2 | `enumerate` **先写盘、后断言**：`pricing.gen.ts` 写于第 419 行、`docs/research/PRICING-CURRENT.md` 写于第 815 行，而硬断言在 844–875 行（`sameEpViolations===0`、`monotonicityViolations===0`、`bucketsSelfConsistent===true`、`minAtomCount>0`、`emptyBadges===[]`） | `packages/shared/scripts/enumerate.test.ts` |
| F3 | 默认测试套件只含 `src/**/*.test.ts`（秒级）；枚举在 `scripts/**`，用自己的配置与 15 分钟超时，**不会**拖慢 `pnpm test` | `packages/shared/vitest.config.ts`、`vitest.enumerate.config.ts`、`package.json` scripts |
| F4 | `docs/BADGES.md` 由 `pnpm run docs`（`UPDATE_DOCS=1`）生成，`docs.test.ts` 与磁盘文件**逐字节**比较 —— 改了徽章不跑 `docs`，测试必红 | `packages/shared/src/badges/__tests__/docs.test.ts` |
| F5 | `supersession` 只写 `docs/research/SUPERSESSION-AUDIT.md`，**不失败、不改代码**；「100% 被取代」是必须人读的结论 | `packages/shared/scripts/supersession.test.ts` 文件头 |
| F6 | **每个家族文件里都恰好有一条对象是 4 空格缩进**（其余 2 空格） | `gray.ts:60`、`casino.ts:198`、`channel.ts:62`、`culture.ts:68`、`extreme.ts:60`、`lucky.ts:76`、`math.ts:101`、`pattern.ts:112`、`perception.ts:65`、`pure.ts:55` |
| F7 | `typescript@7.0.2` 是**原生端口**：包内**没有** `lib/typescript.js`，只有 `bin/tsc`、`lib/tsc.js`、`dist/api/sync`（`unstable`）。**进程内没有官方 TS 编译器 API**，写盘前无法用 `ts.createSourceFile` 校验语法 | `packages/shared/node_modules/typescript/package.json` 的 `exports`/`files` + 实测 `import ts from 'typescript'` 失败 |
| F8 | `pg`、`tsx`、`@huedle/shared` 已在 `apps/api` 的依赖里；`@huedle/shared` 亦在 `apps/web`。**不需要任何新的外部包** | `apps/api/package.json`、`packages/shared/package.json` |
| F9 | `process.loadEnvFile()` 是本仓库既定的读 `.env` 方式（不引 dotenv），Dockerfile 也以它解释为何锁 Node 24 | `apps/api/src/lib/env.ts:17`、`Dockerfile` |
| F10 | Dockerfile 用 `COPY . .` —— **仓库里任何位置的文件都会进生产镜像**，除非写进 `.dockerignore`（该文件已排除 `docs` 与 `**/*.test.ts`，先例明确） | `Dockerfile`、`.dockerignore` |
| F11 | 部署产物：GitHub Pages 上传的是 `apps/web/dist`；前端路由表只有 6 条（`/`、`/me`、`/history`、`/badges`、`/about`、`/login`） | `.github/workflows/deploy-pages.yml`、`apps/web/src/router.ts` |
| F12 | 会话过期**有强制校验**（`expiresAt <= now()` → 拒），所以库里堆积的过期会话是清理债，不是安全洞 | `apps/api/src/lib/auth.ts:56` |
| F13 | 表只有 3 张：`users` / `sessions` / `daily_results`；`badge_ids` 是 **text 里的 JSON 数组**，可用 `jsonb_array_elements_text(badge_ids::jsonb)` 展开成行 | `apps/api/src/db/schema.ts` |
| F14 | `apps/api` 的 vitest 只 include `src/**/*.test.ts`，tsconfig 只 include `src` —— 放在 `apps/api/tools/**` 的代码**默认不进 CI 的测试与类型检查** | `apps/api/vitest.config.ts`、`apps/api/tsconfig.json` |
| F15 | 仓库**没有任何** prettier / eslint / editorconfig 配置 | 根目录、`packages/shared` 实测均无 |

---

## 1. 形态选择与理由

### 1.1 结论

**做 CLI（`tools/admin`）；不加 Web 服务。**
统计以文本表格输出；需要视觉呈现时，`--html` 生成**一个自包含的静态 HTML 文件**，用 `file://` 打开。
加徽章是 CLI 的一条子命令，跑一条有 4 个阶段的流水线。

> ⚠️ **v2 补充**：后来为**只读统计**加了一个本地 UI（§1.7）。
> §1.2 的三条论证今天依然成立——它们主要针对**「把加徽章也做成 Web」**，
> 而那件事仍然被否掉。只读统计之所以能开这个口子，是因为它**没有写路径**，
> 于是 §1.2 第 1 条（认证无解）那个最难的问题直接消失了。
> **下面的论证原文未改**——它是这个决定的理由，不该被结果覆盖。

### 1.2 为什么是 CLI（按重要性排序）

1. **认证问题在 Web 形态下无解，在 CLI 形态下不存在。**
   约束⑤禁止「第一个管理员自动产生」（那是提权漏洞）。于是 Web 只有两条路：要么有一个凭据来源（token 文件 / 环境变量 / 密码），要么没有任何认证。前者意味着要自建凭据分发、登录、会话、CSRF、CORS、TLS 一整套东西——而**这套东西的存在本身就是「有一个可被访问的入口」**；后者等于把生产库用户数据放在一个零认证的端口上。
   CLI 的认证是**操作系统的文件权限**：「能在这台机器上执行这条命令」＝「已经拥有这台机器的 shell」。这一个决定消掉了整张认证面。

2. **这活是一次有状态的批处理，不是请求-响应。**
   加一条徽章＝改源码 → 跑约 4.5 分钟的枚举（题面；`ADD-BADGE.md` 写约 3 分钟）→ 重生成文档 → 跑测试。Web 要做它，就必须把这 4.5 分钟做成后台任务 + 进度推送 + 断线重连 + 任务持久化 + 「刷新页面时任务是否还在」——全是净新增的、可出 bug 的面。
   同样的取舍逻辑在本仓库已经用过一次：`NEW-FEATURES.md` §1.2 为了「不引入弹窗这种新交互范式」而选择行内展开。这里的选择是它的放大版。

3. **写盘前的干跑（§3.3 D-L1）只有 CLI 能便宜地做。**
   候选 `check` 必须在**写入任何文件之前**跑一遍 2²⁴ 全色域，才能让「hits=0 / 恒真 / 抛异常 / 与既有徽章必然蕴含」在污染仓库之前就被拦住。这要求候选规则能作为**进程内的函数**被调用；CLI 里这是天然的（同一份 spec 编译出的谓词闭包），Web 里则要先序列化到服务端再 eval，或干脆放弃这道防线。

4. **审计与可中断性。** stdout/stderr 天然是审计日志；进程死了就是死了，不会留下一个半开的页面等人点下一步。

### 1.3 代价（明确写出来）

- 没有可交互的表格排序/筛选/图表。统计是文本表格；HTML 报告是**静态**的（无 JS、无外部请求，因为不引依赖也没有前端构建）。
- 加徽章要先把条件写成一份 **JSON spec**（或 `--ts` 逃生舱，见 §3.2），不能「在输入框里打了试」。**这正是取舍的核心**：换来的是输入可以被单测覆盖、被 diff、被 review。
- 不熟悉终端的协作者用不了。本项目当前只有 1–2 名维护者，可接受；若将来有非技术运营，按 §7 Q1 重新评估。

### 1.4 被否选项及原因

| 选项 | 结论 | 原因 |
|---|---|---|
| 在 `apps/api` 加 `/admin` 路由 | ❌ 直接违反① | Railway 上是面向全体用户的服务。管理端点一旦在那里，正确性就取决于认证与 CORS 配置不出错——这是把「永远不该暴露」变成「只要没配错就不暴露」。而且 `apps/api` 的中间件、限流、错误处理都是为玩家请求设计的。 |
| 在 `apps/web` 加 `/admin` 页面 | ❌ 直接违反① | GitHub Pages 是纯静态、无认证、产物对所有人生效。即便页面里没有数据，路由与文案也进了产物，且「改源码」的能力在浏览器里根本不存在。 |
| 独立的本机 Web 服务 | ⚠️ 可行但不推荐 | 见 §1.5。它能满足约束①②③，但要用一整节否定性约束来证明「它不会被部署、不会被外部访问」，而 CLI 只需要一条：「没有任何 npm script 启动它」。 |
| 只在数据库里插一条记录来「加徽章」 | ❌ 概念错误（约束②） | 徽章的 `check` 是 TypeScript 函数，`cp`/`rarity` 来自 2²⁴ 全色域枚举。数据库根本不存在「徽章表」。 |

### 1.5 若坚持要做 Web：唯一合法的形状

本文**不实现** Web 版本，但把约束写死，避免下一个人自己发明一个更差的：

- **监听地址必须且只能是 `127.0.0.1:4321`**（或 `127.0.0.1:0` 让内核分配空闲端口后打印实际端口）。
  - `127.0.0.1` 是内核层的不路由：同网段任何机器在 TCP 层就够不着，这不是应用层过滤，也不依赖防火墙。
  - **绝不能是 `0.0.0.0`**：那会让咖啡厅/办公网里任何人在浏览器里打开一个**零认证**的「生产库浏览器」——用户名、每个用户每天抽到什么颜色、`cp`、`badge_ids` 全部可读。
  - 不用固定端口 3001/5173，避免与 `apps/api dev`、`vite dev` 撞车或造成「以为没在跑其实在跑」。
  - 流量不出本机 → 不需要 TLS；不需要 TLS 就不要假装有 TLS。
- 启动时若检测到 `NODE_ENV=production` 或 `RAILWAY_*`/`RENDER`/`FLY_*` 等部署平台变量 → **拒绝启动**。
- 不注册任何写端点（连 POST 都不提供）；不发 CORS 头；不 daemon 化、不写 pid 文件；不被任何 `package.json` 的 `start`/`build`/`prepublish` 引用。
- 仍然不做「第一个管理员」。它没有账户，没有角色，没有身份存储。

### 1.6 「统计」的数据怎么拿（回答 B）

**直连 Postgres 只读，不走 `apps/api` 的 HTTP。**

| 方案 | 结论 |
|---|---|
| 走 `apps/api`（新增只读端点） | ❌ 违反①，且把长期统计查询打进生产 API 的连接池（`max: 10`，见 `db/index.ts:18`）、限流与错误处理路径。 |
| 直连生产 Postgres | ✅ 采用。**这不是新增暴露面**：`apps/api/.env` 里本来就有连接串，开发机上已经具备这个能力（`pnpm -C apps/api migrate` 就是这么跑的）。工具没有扩大权限，只是让既有权限被**正确地**使用（只读事务，见 §6.3）。 |
| 不做统计 | 否——统计是本次需求的一半。 |

连接方式：运行时 `process.loadEnvFile('<repo>/apps/api/.env')`（复用 Node 内置方式，不引 dotenv，不复制 `.env` 到 `tools/admin`——避免出现第二份凭据），然后 `createPool()` 同款配置 + `max: 2`（低于 API 的 10，避免和线上抢连接）。

---

### 1.7 v2 补充：为什么「只读统计」可以做成 UI，而加徽章不行

§1.5 已经给出了 Web 的**唯一合法形状**（只绑 `127.0.0.1`、部署环境拒绝启动、无 CORS、
非 GET/HEAD 一律 405）。v2 实现的 UI **逐条照做了**。但真正让这件事变得可接受的是另一个性质：

**只读统计没有写路径。** 于是 §1.2 第 1 条那个最难的问题——「凭据从哪来」——
**直接消失了**：没有写操作，没有可被滥用的能力；一个只能看你已经拥有的数据的页面，
即使被同机上的别人打开，损失也只是「被看」。

而 §1.2 第 2 条（这活是有状态的批处理）**依然成立**，所以：

| | 形态 | 为什么 |
|---|---|---|
| 只读统计 | **CLI + 本地 UI** | 无写路径 → 认证问题不存在 |
| **加徽章** | **仍然只有 CLI** | 有状态批处理：改源码 → 4.5 分钟枚举 → 回滚。做成 Web 需要一个后台任务系统、进度推送、断线重连、状态持久化——**每一样都是新的攻击面与新的一致性风险** |

**换句话说：v2 放开的是「看」，没有放开「写」。**这条界线不是偶然的，是有意的——
如果哪天真要把加徽章搬上 Web，§1.5 那三条约束**不够**，必须先补上任务与回滚的持久化设计。

### v3 补充：加徽章搬上 Web 的**前提**已经补齐

v3 实现了「CLI + UI 表单」的加徽章，并且逐条补上了上面那句「必须先补上的东西」：

| 风险 | v3 的做法 |
|---|---|
| 「刷新页面时任务是否还在」 | 管道**跑在 detached 子进程里**，与 HTTP 请求生命周期无关；浏览器/终端断开都照跑 |
| 进度推送与断线重连 | **不用 SSE/WebSocket**：进度写 `out/addbadge/status.json`，UI 只轮询它（无连接状态） |
| 任务持久化 | `status.json`（阶段/进度/结论）+ `jobs/<runId>.json`（冻结的 spec）+ `logs/<runId>.log` |
| 并发提交 | `O_EXCL` 锁：已有管道在跑就**拒绝**，不排队、不并发；pid 消失的 stale 锁会被检出并报告，绝不静默 |
| 回滚 | 由**子进程自己**完成（快照 + `git restore` + md5 校验 + 跑一遍 `packages/shared test`），不依赖任何客户端 |
| 认证 | 仍然没有。写入口只有 `POST /badge/submit`，且额外要求「同源 Origin/Host + 页面内表单令牌」——跨站页面拿不到令牌 |


## 2. 只读统计的指标清单

原则：**每个指标都能导出一个人要做的决定**。为此剔除了「用户总数」这类无法行动的计数。

统计一律在 `BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '30s'; …; ROLLBACK` 里执行（§6.3）。

### M1 每日抽取量 + 唯一约束哨兵

```sql
SELECT date, COUNT(*) AS draws, COUNT(DISTINCT user_id) AS players
  FROM daily_results
 WHERE date >= $1
 GROUP BY date ORDER BY date;
```

**回答**：产品今天还有没有人用；某天骤降＝当天抽取链路/部署出了问题。
**为什么第二个数字不是废话**：`daily_results` 有 `UNIQUE(user_id, date)`（`schema.ts:43`），所以 `draws` 必须**恒等于** `players`。一旦不等，说明约束被人为去掉或被直接写过库——这条统计兼作 schema 哨兵。

### M2 新增用户 vs 回访用户

```sql
WITH firsts AS (SELECT user_id, MIN(date) AS first_date FROM daily_results GROUP BY user_id)
SELECT d.date,
       COUNT(*) FILTER (WHERE f.first_date = d.date) AS new_players,
       COUNT(*) FILTER (WHERE f.first_date <  d.date) AS returning_players
  FROM daily_results d JOIN firsts f USING (user_id)
 WHERE d.date >= $1 GROUP BY d.date ORDER BY d.date;
```

**回答**：增长是从哪来的。新增恒为 0 → 一切「拉新」讨论都不必做；新增 > 0 而回访恒为 0 → 问题发生在第一天（留存），不是渠道。

### M3 沉默用户分桶 + 一次性用户占比

```sql
SELECT CASE WHEN gap = 0 THEN '0' WHEN gap <= 7 THEN '1-7'
            WHEN gap <= 30 THEN '8-30' ELSE '31+' END AS bucket,
       COUNT(*) AS users,
       COUNT(*) FILTER (WHERE days = 1) AS one_day_users
  FROM (SELECT user_id,
               (CURRENT_DATE - MAX(date::date)) AS gap,
               COUNT(DISTINCT date) AS days
          FROM daily_results GROUP BY user_id) t
 GROUP BY 1 ORDER BY 1;
```

**回答**：召回值不值得做；以及「只抽过一天」的用户占比——它决定「留存」是不是真问题（如果绝大多数用户只来一天，做连续签到类功能是白做）。

### M4 徽章实际命中率 vs 理论概率（最重要的一条）

```sql
SELECT b.badge_id, COUNT(*) AS hit_days
  FROM daily_results d,
       jsonb_array_elements_text(d.badge_ids::jsonb) AS b(badge_id)
 WHERE d.date >= $1
 GROUP BY 1 ORDER BY 2 DESC;
```

Node 侧与 `PRICING[id].hits / TOTAL_COLORS` 比对，输出**差异最大的前 N 条**。

**回答**：
- 线上跑的徽章表与仓库里的代码**是不是同一份**（部署漂移——`pricing.gen.ts` 是生成文件，忘了重新部署就会静默不一致）；
- 有没有 `check` 写错（某条被写成了恒真/近恒真）；
- 玩家实际体验到的稀有度是否符合预期。

**两条必须写进输出的限制**：
1. 新增徽章**不会**补进旧记录（`ADD-BADGE.md` 第 225–230 行「抽出即定」），所以必须限定在**改动生效日之后**的窗口内比较，否则新徽章的「实际命中」必然偏低。
2. 样本小时 z 值无意义：窗口内 `draws < 200` 时**不给结论**，只给原始计数。

### M5 幽灵徽章 id（存档里有、代码里没有）

```sql
SELECT b.badge_id, COUNT(*) AS n, MIN(d.date) AS first_seen
  FROM daily_results d,
       jsonb_array_elements_text(d.badge_ids::jsonb) AS b(badge_id)
 GROUP BY 1 ORDER BY 2 DESC;
```

Node 侧用 `new Set(allBadges.map(b => b.id))` 过滤出不在代码里的 id。

**回答**：存档里是否在积累**已删除/已改名**的 id。`restoreScore` 会**静默丢弃**它们（`NEW-FEATURES.md` F7 记录的口径），后果是玩家「图鉴缺一格、分变少」而没人知道为什么。一旦非空 → 决定是否给徽章引入墓碑（tombstone）。这是当前明确接受的取舍在生产数据里的**量化后果**。

### M6 稀有度构成的时间漂移

```sql
SELECT date_trunc('week', date::date) AS wk, rarity, COUNT(*) AS n
  FROM daily_results
 GROUP BY 1, 2 ORDER BY 1, 2;
```

**回答**：徽章表/枚举改动是否改变了玩家每天抽到的东西。某一档的周占比突变＝分位表或阈值变了，且玩家能感觉到。这也是「结果已冻结」这条承诺（`ADD-BADGE.md` 第 225 节）的**对照物**：冻结意味着曲线在改动日之后才有台阶，没有台阶才要担心。

### M7 cp 分布漂移与离群

```sql
SELECT date, MIN(cp) AS min, percentile_cont(0.5) WITHIN GROUP (ORDER BY cp) AS p50,
       MAX(cp) AS max, percentile_cont(0.99) WITHIN GROUP (ORDER BY cp) AS p99
  FROM daily_results
 WHERE date >= $1 GROUP BY date ORDER BY date;
```

**回答**：cp 是否随时间整体抬升——这是**新增徽章最容易被忽略的副作用**（新徽章给所有命中它的颜色加正分；历史冻结，但新抽到的颜色分更高，于是「同样的稀有感觉，今天的分数比以前高」）。以及有没有不可能的离群值（数据污染/伪造）。

### M8 数据完整性哨兵

```sql
SELECT
  COUNT(*) FILTER (WHERE hex !~ '^#[0-9A-F]{6}$')                    AS bad_hex,
  COUNT(*) FILTER (WHERE date !~ '^\d{4}-\d{2}-\d{2}$')             AS bad_date,
  COUNT(*) FILTER (WHERE date::date > CURRENT_DATE)                 AS future_date,
  COUNT(*) FILTER (WHERE jsonb_typeof(badge_ids::jsonb) <> 'array') AS bad_badge_ids,
  COUNT(*) FILTER (WHERE cp < 0 OR cp > 1e12)                       AS bad_cp,
  (SELECT COUNT(*) FROM sessions WHERE expires_at <= $1)            AS expired_sessions
  FROM daily_results;
```

另加一条约束自检（必须为 0）：

```sql
SELECT COUNT(*) FROM (SELECT user_id, date FROM daily_results
                       GROUP BY 1, 2 HAVING COUNT(*) > 1) x;
```

**回答**：其余 7 条统计的**前提**是否成立。任何 `bad_*` 非 0 都意味着有东西绕过 API 直接写了库——正是 `schema.ts:49–84` 那段「锁死 Data API」注释要防的场景。`expired_sessions` 是清理债而非漏洞（F12）。

> 统计输出默认**只含聚合数字**；含用户名的明细需要显式 `--include-names`（PII，见 §7 Q8）。

---

## 3. 加徽章的完整流程

权威流程是 `docs/ADD-BADGE.md`。本节做的是**把它自动化**，不是另发明一套；每一步都对应那份清单里的一行。

### 3.1 入口

```bash
pnpm -C tools/admin run add-badge -- --spec new-badge.json      # 默认路径（结构化 spec）
pnpm -C tools/admin run add-badge -- --ts "c => c.r === 128"    # 逃生舱（单表达式）
pnpm -C tools/admin run stats -- --days 30 [--html out/report.html]
pnpm -C tools/admin run rollback -- --snapshot <dir>            # 手动回滚（流水线失败时会自动调它）
```

**不自动 commit**。流水线结束时打印 `git status --porcelain`、`git diff --stat` 与建议的 commit message，由人 review 后提交。

### 3.2 `check` 怎么产生（回答 C）

#### (a) 手写表达式字符串 —— 否，作为默认路径

不是因为「危险」（反正是本地），而是因为**在写盘之前根本无法验证它在语法上是对的**：
- 没有 TS 解析器可用：`typescript@7.0.2` 是原生端口，进程内没有官方 API（F7）；
- 因此手写字符串的语法错误只能在**写完文件之后**由 `tsc` 发现——即「先破坏仓库，再检查」。这与本设计的核心原则（§3.3 D-L1：能在写盘前发现的问题绝不留到写盘后）冲突。

#### (b) 结构化条件构造器 —— 是，默认路径

输入是一份 JSON spec：

```json
{
  "id": "gray-mid-echo",
  "name": "灰中信使",
  "description": "三通道极差 ≤ 2，且最小值落在 120–136",
  "family": "gray",
  "group": null,
  "when": { "all": [
    { "le": [{ "spread": true }, 2] },
    { "between": [{ "minChannel": true }, 120, 136] }
  ] }
}
```

`build.ts` 是一个**纯函数**，把同一个 spec 编译成两个后端：

```ts
toSource(spec): string          // 渲染成与现有文件同格式的 TypeScript 源码
toPredicate(spec): (c: ColorInfo) => boolean   // 编译成可执行的 JS 闭包
```

`toPredicate()` 是整套设计的关键：**它让「写入之前先跑 2²⁴ 全色域」成为可能**（§3.3 D-L1）。手写字符串做不到这一点（没有编译器 API）。

**覆盖面（实测，见 F1）**：

| 形态 | 条数 | 构造器能否表达 |
|---|---:|---|
| 单表达式，只用 `helpers.ts` + `ColorInfo` 字段/字面量 | 70 | ✅ 直接表达 |
| 单表达式，但用了本文件私有 helper，而该 helper 可被归约（`exactHex` 10、`spread` 5、`allCharsIn` 3、`hasTripleRun` 2、`allCharsDistinct` 1、`countDigit` 1、`fullChannelCount` 1 ＝ 23 条） | 23 | ✅ 需把词汇表扩到这 7 个形状 |
| 同上前提但归约不了（`onRanks` 11） | 11 | ❌ 需要六字符频次/顺子语义 |
| 多语句块体（casino 5、pattern 10、math 5、extreme 2、channel 1、culture 1） | 24 | ❌ 需要局部 helper 与循环 |

即：**词汇表合理的构造器覆盖约 93/128 ≈ 73%，剩下约 35 条（27%）表达不了。**

**结论：构造器是常用路径，不是唯一路径。** 剩下 27% 的正确做法就是**在家族文件里手写 3–10 行本地 helper**（`casino.ts` / `pattern.ts` 现在就是这么做的）。工具对这部分的价值不是「生成逻辑」，而是「**插入位置 + 格式一致 + 全色域验证 + 回滚**」。
把 27% 硬塞进构造器（例如做「筹码顺子」的专用表单）会让工具长成一个半吊子 DSL——列为非目标。

#### (c) 逃生舱 `--ts`

允许，但只允许**单表达式**，且必须先通过白名单检查：

- 字符白名单：`A-Za-z0-9_$ . , ( ) [ ] = > & | ! < > + - * / % ? : ' " # 空格`
- 标识符白名单：`helpers.ts` 的 16 个函数 + `c`/`color` + `r`/`g`/`b`/`hex`/`hsl`/`h`/`s`/`l` + `Math`/`Number`/`Set`
- 明确禁止：`import`、`require`、`process`、`globalThis`、`eval`、反引号、`{`/`}`、`;`、换行注释、`=>` 嵌套函数体
- 校验失败 → **拒绝写盘**。

**这不是安全边界，是防呆。** 真正的防线是写盘后的三层验证与回滚（§3.3 D-L2/L3）。`--ts` 路径同样要过全色域干跑——干跑通过把表达式包进 `new Function('c', 'isPrime', …, 'return (' + expr + ')')` 来求值（参数全是白名单里的名字，所以这是**安全的 eval**）。

#### (d) 写入格式（必须与现有文件一致）

| 决策 | 内容 | 理由 |
|---|---|---|
| 目标文件 | `packages/shared/src/badges/<family>.ts` | —— |
| `family` 字段 | **取自文件名**，不读用户输入；spec 里若也写了且不一致 → 拒绝 | `ADD-BADGE.md` 字段约束「`family` 必须与所在文件一致」 |
| 插入点 | 数组**末尾**，即最后一个 `\n];\n` 之前 | 末尾插入是最小 diff（不移动任何既有行）；且 `defs.ts` 的拼接顺序决定图鉴与 `BADGES.md` 的顺序，新徽章稳定地出现在家族最后 |
| 缩进模板 | **同文件中最后一个已存在对象的前导空白**（从原文提取），不是硬编码 2 空格 | F6：每个家族文件里恰好有一条是 4 空格。硬编码 2 会与相邻行不一致；用「末元素模板」保证局部一致 |
| `check` 折行 | 整行 ≤ 100 字符 → 一行 `check: c => <expr>,`；否则按现有风格折成 `check: c =>\n<indent+2><expr>,` | 与 `gray.ts:23` / `math.ts` 现有两种写法一致 |
| 尾随逗号 | 必须有 | 现有 128 条全部有 |
| 文本操作 | **纯插入**：要求 `\n];\n` 匹配唯一，否则拒绝（不猜测、不用正则去修格式） | 不做 AST 重排、不跑格式化器（F15：仓库没有 prettier/eslint 配置） |
| 写盘后自检 | `原文 + 新增块 === 新文件内容`（字节级）、文件仍以 `];\n` 结尾、`id: '<id>'` 出现次数恰好 +1 | 三道自检任一失败 → 立即回滚 |

> **关于 F6 那处历史缩进不一致**：它是既有瑕疵，**不在本次范围内**。本工具只保证「不新增不一致」；统一缩进应当是一次独立的纯格式化提交（§7 Q6）。

### 3.3 流水线：4 个阶段、12 个失败分支

```
阶段 0  干跑（只读，零写盘）        ← 能在这里拦下的，绝不留到后面
阶段 1  写入 + 快照
阶段 2  枚举（分钟级，写 pricing.gen.ts）
阶段 3  文档 / 取代审计 / 测试
阶段 4  收尾（打印 diff，不 commit）
```

#### 阶段 0：干跑（零写盘）

| 步 | 内容 |
|---|---|
| S0.1 | 读 `git rev-parse HEAD` 与受影响路径的 `git status --porcelain` |
| S0.2 | **spec 校验**：必填字段、`id` 为 kebab-case、`name` 2–6 字、`description` 非空、`family` 与文件名一致、`id` 全局唯一（扫全部家族文件）、`name` 同家族内不重复 |
| S0.3 | **全色域干跑**：用 `toPredicate()` 遍历 `v = 0 … 0xFFFFFF`（与 `enumerate.test.ts` 完全相同的循环与 `toColorInfo`，否则 hits 对不上），得到 `hits`，并检测：`check` 抛异常 / `hits === 0` / `hits === 2²⁴` |
| S0.4 | **冗余检测**（`ADD-BADGE.md` 第 165–175 行的反冗余铁律现在只有同 `group` 内检测）：在同一趟遍历里记录新徽章与**每一条既有徽章**的共命中数，算出最大 Jaccard **与包含关系**。`group` 内包含＝允许（阶梯规则）；`group` 外包含＝**拒绝**，并给出建议（改宽判定 / 建 group） |
| 门禁 | 以上任一失败 → 退出码 `2`，工作区**零改动** |

> 干跑是这套设计最重要的一道防线：题面最担心的两个场景（枚举抛错、命中数太少）**根本到不了写盘**。

#### 阶段 1：写入

| 步 | 内容 |
|---|---|
| S1.1 | **快照**受影响路径：`<family>.ts`、`pricing.gen.ts`、`docs/research/PRICING-CURRENT.md`、`docs/BADGES.md`、`docs/research/SUPERSESSION-AUDIT.md`（后四个是后续步骤会写的生成物） |
| S1.2 | 按 §3.2(d) 生成代码块并插入 |
| S1.3 | 写盘后三自检（见 §3.2(d) 最后一行） |
| S1.4 | `pnpm -C packages/shared run typecheck`（`tsc --noEmit`）→ 失败即回滚（**类型 A**） |

#### 阶段 2：枚举

| 步 | 内容 |
|---|---|
| S2.1 | `pnpm -C packages/shared run enumerate`，**子进程超时 ≥ 20 分钟**（vitest 内部上限 15 分钟，见 `enumerate.test.ts:877`；比它短会在写盘中途被杀） |
| S2.2 | 成功 → 从输出解析 `hits === 0` 行、`不同 cp 取值数`、`pricing.gen md5`；断言 hits > 0 |
| S2.3 | **幂等性检查**：再跑一次 `enumerate`，`pricing.gen.ts` 的 md5 必须相同（`enumerate.test.ts` 第 13 行声明输出是确定性的）。抓的是「谓词里混进了时间/随机」这类浮动 |
| S2.4 | 失败 → 按下方失败分类表处理 |

#### 阶段 3：文档 / 取代审计 / 测试

| 步 | 内容 |
|---|---|
| S3.1 | `pnpm -C packages/shared run docs`（重写 `docs/BADGES.md`） |
| S3.2 | `pnpm -C packages/shared run supersession`（写审计报告）。**若报告指出新徽章 100% 被取代 → 必须回滚**（`ADD-BADGE.md:206`：被 100% 取代＝永远拿不到分，必须改判定条件） |
| S3.3 | `pnpm -C packages/shared test`（默认套件，秒级）。失败时：若失败文件只有 `docs.test.ts` → 自动重跑一次 `docs` 再判；仍红则回滚 |

#### 阶段 4：收尾

| 步 | 内容 |
|---|---|
| S4.1 | 打印受影响文件清单、`git diff --stat`、新徽章的 `hits` / 概率 / `cp` / `rarity`（从 `pricing.gen.ts` 读，不自己算） |
| S4.2 | 打印建议 commit message 与「下一步：自行 review 后提交」 |
| S4.3 | 成功 → 删除快照；失败 → 保留快照并打印其绝对路径 |

### 3.4 失败分支表（回答 D 的前半）

| # | 失败 | 枚举前是否已写盘 | 处置 | 退出码 |
|---|---|---|---|---|
| 1 | spec 校验失败 | 否 | 打印字段错误 | 2 |
| 2 | 干跑 hits=0 / 恒真 / `check` 抛异常 | 否 | 打印 3 个命中/未命中样例颜色 | 2 |
| 3 | 与既有徽章在 `group` 外构成必然蕴含 | 否 | 打印包含关系与建议 | 2 |
| 4 | 写盘后 `tsc --noEmit` 失败 | 是（1 个文件） | 回滚 | 2 |
| 5 | 枚举中 `check` 抛异常 | `pricing.gen.ts` 未变（写盘在其后） | 回滚 | 2 |
| 6 | 枚举断言失败：`hits===0`、`ep` 一致性 | **是（2 个文件）** | 回滚 | 2 |
| 7 | 枚举断言失败：`bucketsSelfConsistent` / `minAtomCount` | 是（2 个文件） | **保留现场**，打印报告路径，要求人工判断 | **3** |
| 8 | 枚举被杀 / 超时（可能半写） | 是 | 先记录 `pricing.gen.ts` 的 md5 与快照比对，再回滚 | 2 |
| 9 | `supersession` 报新徽章 100% 被取代 | 是 | 回滚（判定条件太窄，改规则再来） | 2 |
| 10 | `docs` 步骤失败 | `docs/BADGES.md` 未写 | 重试一次；仍失败则回滚 | 2 |
| 11 | `test` 失败 | 是 | 按 §3.3 S3.3 判；无法归因到 `docs` → 回滚 | 2 |
| 12 | 幂等性 md5 不一致 | 是 | 回滚（非确定性输出） | 2 |
| — | 回滚本身失败 | — | **绝不静默**：打印「工作区未完全还原，请人工介入」+ 快照路径 | **4** |

**类型 B（分支 7）为什么不自动回滚**：`bucketsSelfConsistent` / `minAtomCount` 是**全局平衡**问题，你的徽章可能只是压垮骆驼的最后一根稻草（`enumerate.test.ts:847–861` 记录了「底部原子 ≥ 1% 从硬断言降级」的两次实测：76 条时 1.0537%、126 条时 0.3797%）。自动回滚会把**复核材料删掉**，而这类失败的正确反应是「重新校准分位表」，不是「当没发生」。所以这一支**保持工作区脏**并明确告诉你脏在哪。

### 3.5 回滚策略（回答 D 的后半）

所有失败分支共用一个 `rollback()`，执行顺序固定：

1. **还原**：对快照记录的每个路径
   - 若运行前这些路径在 git 里**干净**（`git status --porcelain -- <paths>` 为空）→ `git restore --source=<记录的 HEAD> -- <path>`（最快、最可靠，且能证明回到原样）；
   - 否则从 `os.tmpdir()/huedle-admin-<ts>/` 的快照逐字节复制回去。
2. **验证还原**：对所有受影响路径 `git diff --exit-code` 必须为 0（快照模式则逐文件 md5 与快照一致）。
3. **验证回到绿**：跑 `pnpm -C packages/shared test`，必须全绿。
4. 打印「已回滚 + 证据（HEAD、md5、测试结果）」；任一步失败 → 退出码 4 + 人工介入提示。

**回滚不是「把文件复制回去」，是「复制回去 + 证明回到绿」。**

**前置拒绝**：如果受影响路径里有**用户未提交的改动**，默认**拒绝运行**并提示先提交/暂存（把选择权交给人）；`--snapshot` 显式选择快照模式绕过（不会覆盖用户的劳动，因为快照是内存/临时目录里的副本）。

**兜底重算**：`enumerate` 的输出是确定性的（F2 + `enumerate.test.ts:13`）。极端情况下（例如快照本身损坏）可以「把徽章文件回滚 → 重跑 enumerate」来重建 `pricing.gen.ts`——代价是又一次 4.5 分钟，但它是**可自愈**的最后一道保险。

---

## 4. 文件所有权表

### 4.1 新建文件（全部在 `tools/admin/` 下）

| 文件 | 作用 |
|---|---|
| `tools/admin/package.json` | 新 workspace 包；deps 复用 `pg`/`tsx`/`@huedle/shared`/`vitest`（**零新外部包**） |
| `tools/admin/tsconfig.json`、`vitest.config.ts` | 自己的类型检查与测试配置 |
| `tools/admin/README.md` | 用法、退出码表、回滚说明 |
| `tools/admin/src/cli.ts`、`src/argv.ts` | 入口与参数解析（`node:util.parseArgs`，不引 commander） |
| `tools/admin/src/db.ts` | `loadEnvFile` + 只读连接池 + SQL 入口校验 + 连接串脱敏 |
| `tools/admin/src/stats.ts` | M1–M8 的指标定义（id / 标题 / SQL / 说明），**纯数据** |
| `tools/admin/src/render/{markdown,html}.ts` | 纯函数渲染（表格 → 文本 / 自包含 HTML） |
| **（v3 已全部落地）** | 下表是 v1 为加徽章流水线规划的落位，v3 已按此表实现；另新增 `compile.ts`（两条路径合流 + 写盘前静态检查）、`state.ts`（状态文件 + 锁）、`submit.ts` / `child.ts`（detached 子进程）、`watch.ts`（只读状态文件的观察者）、`commands.ts`（子命令编排）。权威使用说明见 `tools/admin/src/addbadge/README.md`。 |
| `tools/admin/src/addbadge/spec.ts` | 条件 spec 的类型 + 手写校验器（不用 zod/ajv） |
| `tools/admin/src/addbadge/build.ts` | `toSource()` / `toPredicate()` 两个后端 |
| `tools/admin/src/addbadge/families.ts` | 家族文件与 id/name 清单的读取（只读） |
| `tools/admin/src/addbadge/insert.ts` | 末尾插入 + 缩进模板 + 三自检 |
| `tools/admin/src/addbadge/dryrun.ts` | 2²⁴ 干跑 + 包含/Jaccard 检测 |
| `tools/admin/src/addbadge/pipeline.ts` | 阶段编排、失败分类、退出码 |
| `tools/admin/src/addbadge/rollback.ts` | 快照与还原（git 快路径 + 复制兜底） |
| `tools/admin/out/.gitignore` | 内容一行 `*`，挡住报告/快照入库（**新建**文件，所以不需要改根 `.gitignore`） |
| `tools/admin/src/**/*.test.ts` | 单测（见 §5） |

### 4.2 既有文件（必须改的，全部是追加一行）

| 文件 | 改动 | 必要性 |
|---|---|---|
| `pnpm-workspace.yaml` | `packages:` 下加一行 `- 'tools/*'` | 否则工具解析不到 `pg` / `@huedle/shared`（pnpm 不做根级 hoist） |
| `.dockerignore` | 加 `tools` | Dockerfile 用 `COPY . .`，**不改这里工具就会进生产镜像**（F10）。这是「不进生产」唯一的强制手段，不能省 |
| `pnpm-lock.yaml` | 自动新增一个 importer 段 | 无新外部包，只有新 workspace 包。见 §7 Q2 |
| `.github/workflows/ci.yml` | 加一步 `pnpm -C tools/admin test`（纯函数部分） | 建议但可选 |
| `docs/ADD-BADGE.md` | 顶部加一句「本清单已有自动化入口 `tools/admin`」 | 可选；保持权威文档与工具不漂移 |

### 4.3 「能不能只新建」——结论：**做不到纯新建**

最少要动 **1 个**既有文件（`pnpm-workspace.yaml`）——除非接受下面的 Z 方案。

**Z 方案（真·零改动，不推荐）**：不建 `package.json`，用 `pnpm -C apps/api exec tsx ../../tools/admin/cli.ts` 启动；`@huedle/shared` 走相对路径 `../../packages/shared/src/index`（tsx 能处理无扩展名内部 import）；`pg` 通过 `createRequire(new URL('../../apps/api/package.json', import.meta.url))` 取得（**无类型**）；另建 `tools/admin/tsconfig.json` 用 `paths`/`typeRoots` 指到 `apps/api` 的 `node_modules` 才有点类型检查。

代价：没有自己的 `package.json` → 没有 `pnpm -C tools/admin test`；`pg` 无类型；依赖解析靠「路径知识」，`apps/api` 目录结构调整会**静默**弄坏它。
**收益只是一行 `pnpm-workspace.yaml`。不值得。** 推荐最小改动方案。

### 4.4 明令禁止的位置

| 位置 | 为什么禁止 |
|---|---|
| `apps/api/src/**` | 会进生产镜像的源码树（`COPY . .`），正是约束①要防的东西。它还会被 `apps/api` 的 tsconfig/vitest include 自动收进去（F14），等于把管理面焊进被部署的包。 |
| `apps/web/src/**` | 会被 vite 打进 GitHub Pages 产物，直接违反①。 |
| `apps/api/tools/**` | 能复用 `apps/api` 的依赖与 `package.json`（零 lockfile 改动），但同样被 `COPY . .` 带进镜像，且**默认不在任何 CI 的类型检查/测试范围内**（F14）。除非 §7 Q2 的答案是否定的，否则不选它。 |

---

## 5. 测试策略

### 5.1 能单测（无数据库、无 2²⁴，秒级，进 CI）

| 对象 | 测法 |
|---|---|
| spec 校验器 | 表驱动：未知键、缺字段、类型错、`id` 非 kebab-case、`name` 超长、`family` 与文件名不一致、`id` 重复 → 逐条断言拒绝 |
| `toSource()` | **字节级黄金样本**：固定 spec → 期望字符串（含缩进、折行、尾随逗号）。改渲染器必须先改样本，逼人 review |
| `toSource()` ↔ `toPredicate()` **语义等价** | 对固定的 4096 色样本断言「`toPredicate()` 的结果 === `new Function('c','isPrime',…,'return (' + toSource(...) + ')')` 的结果」。这是唯一能防「渲染器写对了文本、写错了语义」的测试，且**不需要 TS 解析器** |
| `insert.ts` | 对**每个真实家族文件**（测试里读真实文件）在内存里插入，断言：① 新 id 出现次数 +1；② 原文其余字节不变（公共前后缀校验）；③ 文件仍以 `];\n` 结尾；④ 新元素的缩进等于末元素缩进 |
| `rollback.ts` | 在临时目录造一个假仓库，注入一个必然失败的枚举步骤，断言所有文件字节还原 + md5 一致 |
| 渲染层（markdown/html） | 纯函数表格渲染；HTML 断言**不含** `<script`、`http://`、`https://` |
| SQL 文本 | 快照 + 「每条统计的 SQL 必须以 `SELECT` 或 `WITH` 开头」——这是只读承诺的**可回归**保证 |
| 退出码 | 每个失败分支的退出码是契约，用假 pipeline 断言 |

### 5.2 必须靠真实执行验证（不能单测）

| 对象 | 为什么 |
|---|---|
| 真连库 + `BEGIN READ ONLY` **真的拒绝写入** | 必须断言一条 `INSERT` 真的抛 SQLSTATE `25006`。「只读」不能靠读代码相信 |
| 干跑的正确性 | 对**全部 128 条既有徽章**跑干跑，`hits` 必须与 `pricing.gen.ts` 逐条相等（这是干跑循环与枚举器同口径的黄金证明） |
| 完整加徽章流程 | 写盘 → typecheck → enumerate → docs → supersession → test → md5 幂等，必须真跑一次（建议在临时 clone 里，见 §7 Q4） |
| 回滚的真实性 | 故意用 `hits = 0` 的候选跑完整流程，确认工作区字节还原且 `pnpm -C packages/shared test` 全绿。这是回滚代码**唯一**的验证方式 |
| 不回归 | `pnpm -C packages/shared test`（177 例）与 `pnpm -C apps/api test`（60 例）保持全绿 |

### 5.3 CI 边界

- `tools/admin` 的测试**只跑纯函数部分**，不连库（凭据只存在于开发者机器的 `apps/api/.env`，CI 不该有）。
- 因此 `tools/admin` 的 `test` 脚本**不得有副作用**（不连库、不写文件、不跑 2²⁴）——因为 `pnpm -r test` 会遍历到它。

---

## 6. 安全边界

### 6.1 为什么它不可能被部署

1. **GitHub Pages**：产物是 `apps/web/dist`（`deploy-pages.yml` 的 `upload-pages-artifact`）。`tools/admin` 不在 `apps/web` 的构建图里，vite 不会打包它；前端路由表（`router.ts`）只有 6 条，没有也不会有 admin。
2. **Railway**：产物由 `Dockerfile` 的 `COPY . .` + `CMD pnpm -C apps/api start` 决定。**这里唯一的真实风险是 `COPY . .` 会把 `tools/` 一并拷进镜像**，所以 `.dockerignore` 必须加 `tools`（§4.2）。该文件本来就有「排除 docs、排除 `**/*.test.ts`」的先例，一致性没问题。
3. **没有任何脚本会启动它**：唯一入口是 `tools/admin` 自己的 script。根 `package.json` 的 `test`/`typecheck` 用 `pnpm -r` 遍历 workspace——这会把 `tools/admin` 带上，是**好事**（CI 里有单测），前提是它的 `test` 无副作用（§5.3）。
4. **默认零监听**：默认实现里没有 HTTP server，连端口都不存在。

### 6.2 为什么它不可能被外部访问

1. **没有监听，就没有攻击面**（默认形态）。
2. **数据库访问不是新增暴露面**：`apps/api/.env` 里本来就有连接串，开发机上已经具备这个能力（`pnpm -C apps/api migrate` 就是这么跑的）。工具没有扩大权限，只是让既有权限被正确地用（只读事务）。
3. **凭据处理**：只在运行时 `process.loadEnvFile('<repo>/apps/api/.env')`；**不复制** `.env` 到 `tools/admin`（避免第二份凭据）；日志与错误信息**绝不打印连接串**（打印前脱敏成 `host:port/db`）；报告默认只含聚合数字，含用户名的明细需要 `--include-names`；报告写到 `tools/admin/out/`，该目录用**新建**的 `out/.gitignore`（内容 `*`）挡住入库。
4. **不做「第一个管理员自动产生」**：这个工具**没有管理员概念**——没有账户、没有登录、没有角色、不存任何身份。谁能运行它＝谁能在这台机器上执行命令。判定权完整地留在操作系统与 shell 权限里。

### 6.3 只读是服务端强制的

| 层 | 手段 |
|---|---|
| 连接级 | pool 的 `options` 里带 `-c default_transaction_read_only=on`；`max: 2` |
| 事务级 | 每条统计在 `BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '30s'; …; ROLLBACK` 里执行。任何写操作被 PG 以 `25006` 拒绝——这是**服务端**保证，不是我们的自觉 |
| 应用级 | 单一 SQL 执行入口校验「必须以 `SELECT`/`WITH` 开头」；所有统计 SQL 都是**常量**，不接受用户拼接（沿用 `store.ts` 的参数化铁律，虽然统计没有参数来自用户输入） |
| 资源级 | `statement_timeout = 30s` 防止一条统计拖住生产库；串行执行，不并发轰炸 |

> 进阶加固（可选，需要运维配合）：单独创建一个只读 DB 角色。**不在默认方案里**，因为它需要人的操作，而 §6.3 的三层已经给了同等级别的保证。

---

## 7. 不确定 / 需要人拍板的地方

按「不拍板就会做错」的程度排序。前两项建议动工前决定。

| # | 问题 | 我的建议 | 不决定的后果 |
|---|---|---|---|
| **Q1** | **CLI 还是 Web？** 用户说的是「管理后台」，我判成 CLI + 静态 HTML 报告 | **CLI**（理由见 §1.2；核心是认证面与写盘前干跑） | 若真做 Web，就欠下 §1.5 那一整节否定性约束；若判错，非技术使用者用不了这个工具 |
| **Q2** | **新 workspace 包带来的 `pnpm-lock.yaml` importer 变更可接受吗？** | **可接受**（零新外部包，只有新 importer）。不可接受就走 `apps/api/tools/**`，但要接受 §4.4 的两个后果 | 选错会让「不引入依赖」这条约束被认定违反，或让工具落在被部署的包内 |
| **Q3** | **`--ts` 逃生舱留不留？** | **留**，默认关闭且需显式 flag。砍掉它也不会挡住任何徽章（那 27% 本来就要手写），只是少一条便利路径 | 砍掉后有人会绕过工具直接手改文件，反而失去验证与回滚 |
| **Q4** | **完整流程的验收要不要在临时 clone 里跑？** | **要**（避免污染工作区）。代价：临时 clone 要再 `pnpm install` 一次（需要网络/缓存） | 直接在主工作区跑，失败回滚即是验收；但验收本身会成为一次真实的风险操作 |
| **Q5** | **类型 B 失败（分位档位不自洽）回滚还是保留现场？** | **保留现场**（§3.4）。这是流程决定，不是技术决定 | 自动回滚会删掉复核材料；保留则工作区会脏，需要人接手 |
| **Q6** | **`docs/badges/<family>.md`（家族备注，如 `gray.md`）要不要一起更新？** `gray.ts` 顶部注释明确指向它，但 `ADD-BADGE.md` 的清单没提 | **按现状不更新**，只在工具输出里提醒一次「若本家族有备注文件，请人工同步」 | 家族备注会与新增徽章漂移（现有文档已经有过期内容的前科） |
| **Q7** | **F6 的缩进不一致要不要顺手统一？** | **不要**（本工具只保证不新增不一致）。单独一次纯格式化提交 | 混进功能 diff 会让 review 看见 10 处无关改动 |
| **Q8** | **统计里要不要含用户名的明细？** | **默认只聚合**，`--include-names` 显式开启 | 默认打印用户名＝把 PII 写进可能被分享的报告文件 |
| **Q9** | **流水线要不要 `--yes` 全自动串起 4 个阶段？** | **默认串行全自动**，但每阶段在成功后打印一行耗时，失败即停 | 每步人工确认会让一次加徽章变成 5 次交互，人会开始绕过工具 |
| **Q10** | **要不要顺手做「改名 / 删除徽章」的自动化？** | **不要，列为非目标**。改名会让存档里的旧 id 变成幽灵（M5），需要先有墓碑机制 | 做一半会制造 M5 类型的脏数据 |

### 非目标（明确列出，防止范围蔓延）

不做：任何形式的认证/角色/账户；任何写数据库的能力；用户管理（改密码、删用户、清会话）；徽章改名或删除的自动化；把 27% 的复杂 `check`（casino 顺子、pattern 结构）塞进条件构造器；图表库；定时任务；Web 服务（默认）；自动 commit/push。

---

## 附：与现有文档的关系

| 文档 | 关系 |
|---|---|
| `docs/ADD-BADGE.md` | **权威流程**。本文 §3 是它的自动化与失败分支补全；两者冲突时以 `ADD-BADGE.md` 的规则为准 |
| `docs/BADGE-SPEC.md` | 作者契约。注意其 §3「CP 校准表/全局配额」已过时（`ADD-BADGE.md` 顶部已标注） |
| `docs/PRICING-SPEC.md` | 枚举与定价的规范；本文不改它 |
| `docs/NEW-FEATURES.md` | §9 的已知问题（`useHistory` 多实例）与本文无关；但它 F1–F11 的取证方式是本文 §0 的模板 |
| `docs/DESIGN.md` | 部署与数据模型；本文只读它 |
