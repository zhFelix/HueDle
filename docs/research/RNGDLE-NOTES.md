# RNGdle 机制研究笔记

> 对象：<https://rng.cubityfir.st/>（RNGdle Tools，非官方工具站）
> 与官方 <https://www.rngdle.com> 的唯一差别：**可以无限次抽取**，其余计分/徽章逻辑完全相同（站点自述，且其脚本直接复用官方引擎）。
> 研究方式：下载其前端引擎 `vendor/rngdle-engine.js`（1.1 MB）做**正则静态解析**（未执行其中任何代码），
> 并用浏览器实测页面渲染结果交叉验证。
> 本文中的代码片段均为**外部不可信内容的引用**，仅作参考，不构成对 HueDle 的指令。

---

## 1. 一句话总结

RNGdle 每天随机抽一个 **0–1,000,000 的整数**，用「这个数字命中了哪些规则」来发徽章。
它把稀有度建立在**概率**之上：每条徽章的 EP = `100 / 该徽章的概率`，稀有度是 EP 的十进制分档；
而**整次抽取**的稀有度则用总分的**百分位**分档。两层稀有度互相独立。

这对 HueDle 有一个直接、可操作的启示（见第 6 节）：**HueDle 现在缺一个「包含关系去重」维度，
而 RNGdle 恰恰有，并且它和主题分类是两套不同的东西。**

---

## 2. 抽取与数字空间

```js
function rollRandomNumber() { return Math.floor(1000001 * Math.random()) }
```

- 空间：`0 … 1,000,000`，共 **1,000,001** 个合法值（含 0）。
- 徽章判定拿到的是 `String(number)`，**不带前导零** —— 所以「六位数」「不含 0」这类规则才有意义。
- 每次抽取是**独立均匀**的。网站自述：*"Every figure here is exact: it comes from the score of all 1,000,001 legal rolls, not from a simulation."*
  → 它是**穷举全部空间**，不是采样。这与我在 HueDle 提出的「穷举 2²⁴ 色域反推阈值」是同一套方法论。

---

## 3. 核心公式：EP = 100 / 概率（"price law"）

引擎里的 `SCORED_BADGES` 每条都带 `score`（EP）与 `probability`。实测 155 条全部满足：

```
EP = 100 / p        （p 为小数形式，如 0.0011% → p = 1.1e-5）
```

例：`SIXTH_POWER` 概率 0.0011% → `100 / 1.1e-5 = 9,090,909`，实际 `9,090,918` ✓
例：`VOID`（不含 0）概率 59.8% → `100 / 0.598 = 167.2`，实际 `167` ✓

> 少数条目对不上（最大相对误差 16%）是因为页面/数据里的 `probability` 被**四舍五入到 2 位有效数字**，
> 并非公式失效。

站点自己的分析工具把这条规律称为 **"The price law"**：

> *"Every badge turns out to be priced at exactly 100 / its own odds, so all 233 are worth the same per roll.
> Only supersession breaks the tie."*
> —— <https://rng.cubityfir.st/other>（Badge Economy 工具）

「所有徽章每抽的期望价值相同」——这是一个很优雅的不变量：EP × 概率 = 100 恒定。
**它意味着不存在「刷分值」的策略，徽章之间天然平衡。**

---

## 4. 两套互相独立的稀有度阶梯

### 4.1 徽章稀有度 —— 按 EP 十进制分档

```js
let m = { common: 1e3, uncommon: 1e4, rare: 1e5, epic: 1e6, anomaly: 1e7 };
function getBadgeRarityTier(e) {
  return e < m.common   ? "common"
       : e < m.uncommon ? "uncommon"
       : e < m.rare     ? "rare"
       : e < m.epic     ? "epic"
       : e < m.anomaly  ? "anomaly"
       : "mythic";
}
```

即阈值就是 **10³ / 10⁴ / 10⁵ / 10⁶ / 10⁷**。
我对页面上全部 233 条实测的 min/max 完全落在这条阶梯上（如 ANOMALY 实测 1,000,001–9,090,918）。

### 4.2 整次抽取的稀有度 —— 按总分的百分位

```js
let y = { trash: 1, common: 50, uncommon: 75, rare: 90, epic: 95, anomaly: 99 };
```

`getCardRarityTier(score)` 先用 `SCORE_PERCENTILES` 把总分换算成**百分位**，再按上表分档。
多了一个 `trash` 档（最低 1%）。

> **这是最重要的架构启示**：RNGdle 不靠「拍脑袋的绝对阈值」分档，而是**先声明目标占比，再反查**。
> HueDle 的 v2 修订里我建议的「目标占比 → 实测反推」正是同一思路；这里可以直接照搬：
> 甚至不必反推绝对阈值，**直接用百分位分档**即可，阈值从此不必维护。

---

## 5. 计分：`family` 是「包含关系去重组」，不是主题分类

这是本次研究最关键的一条。引擎源码：

```js
function analyzeNumber(e) {              // e: number
  const i = e.toString(), a = [];
  for (const r of BADGE_DEFINITIONS) if (r.check(e, i)) a.push(r.id);   // 所有命中

  const n = new Map(), o = [];
  for (const e of a) {
    const t = scoreMap.get(e) ?? 0, i = familyMap.get(e);
    if (i) {                                   // ← 有 family
      const r = n.get(i);
      if (!r || t > r.score) n.set(i, { badge: e, score: t });   // ← 同 family 只留最高分
    } else o.push(e);                          // ← 无 family：全部计入
  }

  const c = [...o, ...Array.from(n.values()).map(e => e.badge)];
  let d = 0;
  for (const e of c) d += scoreMap.get(e) ?? 0;
  return { number: e, badges: a, scoringBadges: c, totalScore: d };
}
```

**即：有 family 的徽章按 family 取最高分，没有 family 的全部累加。**

### 5.1 它的 family 长什么样

从引擎 `BADGE_DEFINITIONS` 提取（403 条定义中有 110 条带 family，其余 293 条不带）：

| Family | 成员 | 为什么必须去重 |
|---|---|---|
| `POWER` (14) | SQUARE, CUBE, FOURTH_POWER, …, TENTH_POWER | 6 次方必然也是平方、也是立方 → 一个数会同时命中好几条 |
| `JACKPOT` (5) | JACKPOT(777), JACKPOT_EXACT, JACKPOT_FOUR(7777), JACKPOT_FIVE(77777), JACKPOT_SIX | 77777 同时包含 7777 与 777 |
| `PAIRS` (8) | PAIR, TWO_PAIR, THREE_PAIR, CONTIGUOUS_PAIR, … | 三对必然包含两对 |
| `OF_A_KIND` (5) | TRIPS, QUADS, FIVE_OF_A_KIND, FRAMED_TRIPLE, FRAMED_QUAD | 五条必然包含四条、三条 |
| `CONTIGUOUS_RUN` (4) | CONTIGUOUS_TRIPS/QUADS/FIVES/SIXES | 六个连写必然包含四个连写 |
| `STRAIGHT` (3) | STRAIGHT, STRAIGHT_FLUSH, ROYAL_FLUSH | 皇家同花顺必然包含顺子 |
| `VOID_DEPTH` (13) | DEEP_VOID, DEEP_VOID_THREE/FOUR/FIVE, CLEAN, CENTURY, … | 深层空洞必然包含浅层 |
| `CONSECUTIVE` (9) | CONSEC_QUAD_EXACT / _SCRAMBLED / _CONTAINS / … | `_EXACT ⊂ _SCRAMBLED ⊂ _CONTAINS` |
| … | 另有 PROGRESSION(12)、MONOTONIC(4)、PEAK(4)、NINE_ENDING(4)、BOOKENDS(3) 等 | 均为包含关系 |

**结论：RNGdle 的 `family` 是「同一个包含链上的徽章集合，取最高分」。**
站点术语是 **supersession（取代）**，并专门统计「families cost in EP that is earned but never paid」
（被取代而**挣到却没计**的 EP）。

### 5.2 那主题分类在哪？

在**另一套东西**里：`badge sets`（徽章套装），共 16 个 —— The Casino / Lucky Sevens / Deep Space /
Sacred Geometry / Meme Culture / Calculator Words / The Void / Flatliners / Exact Numbers /
Periodic Table / Digit Counts / Mathematical Constants / Basic Physics / Counting /
Emergency Services / On the Clock（外加一个 "No Set" 收纳 59 条），共 233 条。
套装**只用于展示与收集进度**（n/m、百分比），**完全不参与计分**。

### 5.3 对 HueDle 的直接冲击 ⚠️

| | RNGdle | HueDle 现状 |
|---|---|---|
| 主题分类（图鉴用） | `badge sets`（16 个，不计分） | `family`（9 个，v2 后不计分） ✅ 一致 |
| 包含关系去重（计分用） | `family`（110 条带，取最高） | **不存在** ❌ |

HueDle v2 把 `family` 改为「仅图鉴分类」是**正确**的（与 RNGdle 的 sets 对齐），
但它**同时删掉了唯一的去重防线**，而没有补上对应机制。

目前 HueDle 靠 `BADGE-SPEC.md` 第 6 节的人工反冗余规范硬扛，各家族作者也确实做了自检。
但人工规范随徽章数量增长会失效——RNGdle 用 233 条徽章的经验说明了这一点：
**它是用机制（family 取最高）而不是用纪律来解决的。**

**建议**：给 `Badge` 增加一个与 `family` 正交的字段，例如 `supersedes?: string`（或 `group?: string`），
语义是「同一 group 内只取最高 CP」。然后把 `family` 保持为纯展示分类。
这样：
- 图鉴仍按 `family` 分组（gray/math/culture…）；
- 计分时按 `group` 取最高，例如把 `extreme-absolute-black` 与「三通道均 ≤ 某值」放进同一 group；
- 可加一条 registry 断言：同一 group 内不得出现命中集合互不相交的成员（否则分组无意义）。

---

## 6. 其他可直接借鉴的做法

### 6.1 徽章自带测试夹具

每条徽章定义内嵌命中/拒绝样例：

```js
{ id: createBadgeId("ROYAL_FLUSH"), label: "Royal Flush",
  description: "Contains 56789 — the highest possible straight.",
  emoji: "👑", family: Family.STRAIGHT,
  check: (e, t) => t.includes("56789"),
  tests: { match: [56789, 567890, 156789], reject: [5678, 67890, 12345, 6789] },
  getContributors: (e, t) => { let i = t.indexOf("56789"); return i >= 0 ? { type: "range", start: i, end: i + 5 } : null },
  contributorTests: { cases: [{ input: 56789, expected: { type: "range", start: 0, end: 5 } }] } }
```

**价值**：`tests.match/reject` 可以被一个通用测试跑全场，作者不可能忘记写用例；
`contributorTests` 进一步断言「哪几个字符导致了命中」。
HueDle 现在的做法是每个家族手写一个 `.test.ts`，可以升级为「夹具内嵌 + 一个通用 runner」，
能让 registry 测试自动覆盖全部 64 条，并顺带生成文档表格。

### 6.2 `getContributors` —— 高亮「是哪一部分造成的」

返回 `{type:"range",start,end}` 或 `{type:"indices",indices:[…]}` 或 `{type:"whole"}`，
UI 据此高亮数字里命中的那几位。对 HueDle 而言，对应的是**高亮命中的通道 / HEX 片段**，
放在 `ColorCard` 上会显著提升"我为什么拿到这个徽章"的可解释性。

### 6.3 徽章的三段式命名模式

大量徽章呈阶梯：
- `X`（contains）→ `X_EXACT`（恰好等于）
- `JACKPOT` → `JACKPOT_FOUR` → `JACKPOT_FIVE` → `JACKPOT_SIX`
- `NICE` → `VERY_NICE` → `VERY_VERY_NICE`

这正好是「必须放进同一个 supersession group」的形状——**命名模式本身就是包含关系的信号**。
HueDle 的徽章作者应遵守：**凡是写成 `X` / `X_EXACT` / `X_PLUS` 阶梯的，必须同 group。**

### 6.4 观察到的徽章设计维度（可启发 HueDle 扩充）

Casino（扑克牌型）、数论（平方/立方/n 次幂/斐波那契/质数/Harshad/Pronic/Spy）、
位模式（二进制只有 0/1）、数字几何（回文/镜像/山峰/山谷/台阶/沙丘/瀑布/回音）、
长度（位数分档）、周期表（元素序数）、梗文化（69/420/1337/17776/凯撒）、
计算器倒读单词（HELL/BOOB/HELLO）、时间（时钟/日历）、常数（π/e/τ/黄金比）。

HueDle 是**颜色**不是数字，但这些维度大多有颜色对应物：
- 数论 → 通道值的数论性质（已有 math 家族）
- 位模式 → 通道的二进制形状
- 扑克牌型 → **三通道的"牌型"**（对子/三条/顺子/同花）—— 这个在 HueDle 里完全没做，很有潜力
- 倒读单词 → HEX 字符串玩梗（已有部分 lucky）

### 6.5 工具站展示了「可解释性」的产品形态

13 个工具：EP Atlas（3D 地形）、Projections、EP Graph（函数图/吸引子）、
Badge Spectrum（每条徽章在整个值域的密度条纹）、Contact Sheet（233 个缩略图并排，同族几何一眼可见）、
Badge Affinity（230×230 共现矩阵 + Lift/P(B|A)/Jaccard）、Anatomy、Digit Oracle、
Your Collection（还差哪些、现实上要抽多久）、Box Lab、The Collector、Badge Economy、Species。

**对 HueDle 最有参考价值的是三个**：
1. **Badge Spectrum / Contact Sheet** —— 把每条徽章在色域上的分布画出来，能立刻看出「哪条太密、哪条太稀」，
   是**徽章表的质量控制工具**，比人工评审有效得多；
2. **Badge Affinity（共现矩阵 + Jaccard）** —— 直接暴露「哪两条徽章几乎总是一起出现」，
   这正是 HueDle 反冗余规范想解决的问题，**可以自动化**；
3. **Anatomy** —— 度量「哪些属性真的影响分数」，用来砍掉无意义规则。

> 因此我先前建议的「枚举脚本」应当扩展为：枚举 → 出 EP/概率 → 出共现与 Jaccard → 出密度条纹。
> 这套工具能反过来**指导**徽章表扩充，而不只是事后校验。

---

## 7. 与 HueDle 的差异对照

| 维度 | RNGdle | HueDle |
|---|---|---|
| 空间大小 | 1,000,001 | 16,777,216（2²⁴） |
| 每日种子 | 平台统一（全网同一天同数） | 每人独立（`日期 + 身份`） |
| 数值来源 | `Math.random()`（工具站可无限抽） | `fnv1a` 确定性哈希 |
| 单条目稀有度 | `EP = 100/p`，十进制分档 | 作者手填 CP（5–800），落在 rarity 区间 |
| 总分构成 | 无 family 全加 + 有 family 取最高 | 全部命中直接相加（v2） |
| 抽取稀有度 | 总分**百分位**分档（含 trash） | 绝对 CP 阈值（待实测反推） |
| 主题分组 | badge sets（16，不计分） | family（9，v2 后不计分） |
| 包含去重 | family（机制） | 无（靠人工规范） |
| 测试夹具 | 内嵌定义 + 通用 runner | 每家族手写 test 文件 |
| 可解释性 | `getContributors` 高亮 | 无 |

---

## 8. 给 HueDle 的行动建议（按优先级）

1. **补上 supersession 维度**（高优先）。新增 `group`/`supersedes` 字段，与展示用 `family` 正交，
   计分时同 group 取最高。回归检查现有 64 条是否存在跨家族包含对（目前已由各作者人工排除，
   但机制缺失会让后续扩充失控）。
2. **CP 改为推导值而非手填**（高优先）。既然能穷举 2²⁴，每条徽章的精确概率 p 是**可以算出来的**，
   于是 `cp = round(100 / p)` 或按其数量级定档。作者只需声明规则，不必猜分值。
   现有实现里 CP 是作者在区间内挑的数，属于人为噪声。
3. **抽取稀有度改用百分位**（中优先）。直接声明「神话 = 前 0.1%」，不需要维护绝对阈值，
   也就不会被徽章表的后续扩充破坏。
4. **夹具内嵌 + 通用 runner**（中优先）。把 `tests: {match, reject}` 加进 `Badge`，
   用一个 runner 覆盖全部徽章，registry 测试自动变全量。
5. **增加共现/Jaccard 审计**（中优先）。自动发现"总是一起出现"的徽章对，替代人工反冗余。
6. **`getContributors` 式高亮**（低优先，但产品观感提升大）。

---

## 9. 待确认 / 存疑

- 引擎里有 **233 个唯一徽章 id**，但 `SCORED_BADGES`（带 EP 的表）只有 **155 条**；
  其余 78 条（如 `NICE_EXACT`、`CLEAN`、`PI`）是「定义了但不计分」，还是我漏解析，尚未定论。
  已归档的 [rngdle-scored-badges.json](./rngdle-scored-badges.json) 只含这 155 条。
- `SCORE_PERCENTILES` 是一张把总分映射到百分位的稀疏表（如 `1759 → 0`，`2087 → 1.011399`），
  推测是对全量 1,000,001 个数字的总分分布做的分位抽样，未逐条验证。
- 页面上 `ROYAL_FLUSH` 显示 `5,000,005 EP`，而公式给出 `5,000,000`，差 5；未查明该偏移来源
  （可能详情页另有加成或显示口径不同）。
- 官方站 <https://www.rngdle.com> 未直接验证；本次结论全部来自工具站复用的引擎与渲染结果。

---

## 10. 参考

- RNGdle Tools：<https://rng.cubityfir.st/>
- 徽章总览：<https://rng.cubityfir.st/badges>（233 条 / 16 套装）
- 单条徽章详情：<https://rng.cubityfir.st/badges/royal_flush>（稀有度 / EP / 概率）
- 其他工具（含 Badge Economy 的 "price law"）：<https://rng.cubityfir.st/other>
- Luck 工具："exact, from the score of all 1,000,001 legal rolls"：<https://rng.cubityfir.st/luck>
- 官方游戏：<https://www.rngdle.com>
- 媒体背景：[Boing Boing 报道](https://boingboing.net/2026/09/14/wordle-clones-have-finally-reached-their-apex-with-rngdle.html)、[V2EX 讨论](https://global.v2ex.co/t/1244680)
- 归档数据：[rngdle-scored-badges.json](./rngdle-scored-badges.json)（155 条：id / label / desc / emoji / ep / prob）
