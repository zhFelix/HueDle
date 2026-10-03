# 定价迁移报告：手填 CP → 概率定价（EP）

> **本文件由 `pnpm -C packages/shared run enumerate` 自动生成，请勿手改。**
> 契约：[PRICING-SPEC.md](../PRICING-SPEC.md) 第 2/3/4/5/6/7 节；
> 数据源：全色域 2²⁴ 精确枚举（非采样）。
> 本阶段**只出数据和报告**：未改计分模型，未改任何徽章定义，`PRICING` 尚未接入 `calculateScore`。

## 0. 生成指纹

- 徽章条数：**76**
- 全色域：16777216（2²⁴）
- 第一趟（hits）耗时：**86.98 s**
- 第二趟（总分）耗时：**87.59 s**
- 两趟合计：**174.57 s**
- `src/pricing.gen.ts` md5：`78781bff78aaea7a7b0d4a9421762e05`
- 取代组：2 个（`casino-rank-count`、`casino-sequence`），共 11 条成员

## 1. 总览

- `ep` 范围：**120 … 1677721600**（hits = 13936093 … 1）
- 最稀有的徽章：`channel-extreme-shift`（hits = 1，ep = 1677721600）
- 数量级跨度：**7.14 个数量级**（ep_max / ep_min = 1.39e+7）

### 1.1 新 rarity 分布 vs 旧 rarity 分布

| 档位 | 旧（手填） | 新（ep 导出） | 变化 |
|---|---:|---:|---:|
| `common` | 15 | 11 | -4 |
| `uncommon` | 12 | 11 | -1 |
| `rare` | 28 | 14 | -14 |
| `epic` | 11 | 8 | -3 |
| `anomaly` | 6 | 16 | +10 |
| `mythic` | 4 | 16 | +12 |

- 档位发生变化的条目：**52 / 76**（升档 41，降档 11）

## 2. 逐条对照表（按 `ep` 降序）

| id | 名称 | hits | p | ep | 旧 rarity | 新 rarity | 旧 CP | 档位变化 |
|---|---|---:|---:|---:|---|---|---:|---|
| `channel-extreme-shift` | 极值错位 | 1 | 5.960e-8 | 1677721600 | `anomaly` | `mythic` | 320 | ↑1 |
| `culture-bamboo-green` | 竹青 | 1 | 5.960e-8 | 1677721600 | `uncommon` | `mythic` | 40 | ↑4 |
| `culture-klein-blue` | 克莱因蓝 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | 700 | = |
| `culture-marrs-green` | 马尔斯绿 | 1 | 5.960e-8 | 1677721600 | `epic` | `mythic` | 160 | ↑2 |
| `culture-prussian-blue` | 普鲁士蓝 | 1 | 5.960e-8 | 1677721600 | `rare` | `mythic` | 95 | ↑3 |
| `culture-rouge` | 胭脂 | 1 | 5.960e-8 | 1677721600 | `uncommon` | `mythic` | 30 | ↑4 |
| `culture-tiffany-blue` | 蒂芙尼蓝 | 1 | 5.960e-8 | 1677721600 | `epic` | `mythic` | 190 | ↑2 |
| `culture-titian-red` | 提香红 | 1 | 5.960e-8 | 1677721600 | `rare` | `mythic` | 85 | ↑3 |
| `culture-van-gogh-blue` | 梵高星空蓝 | 1 | 5.960e-8 | 1677721600 | `rare` | `mythic` | 70 | ↑3 |
| `extreme-absolute-black` | 绝对零度 | 1 | 5.960e-8 | 1677721600 | `mythic` | `mythic` | 600 | = |
| `extreme-absolute-white` | 白垩尽头 | 1 | 5.960e-8 | 1677721600 | `epic` | `mythic` | 180 | ↑2 |
| `lucky-golden-tone` | 金玉满堂 | 1 | 5.960e-8 | 1677721600 | `anomaly` | `mythic` | 300 | ↑1 |
| `pure-magenta-full` | 品红满值 | 1 | 5.960e-8 | 1677721600 | `anomaly` | `mythic` | 320 | ↑1 |
| `casino-six-kind` | 六条同辉 | 16 | 9.537e-7 | 104857600 | `anomaly` | `mythic` | 300 | ↑1 |
| `gray-core-echo` | 灰核残响 | 18 | 1.073e-6 | 93206756 | `anomaly` | `mythic` | 300 | ↑1 |
| `math-doubling-ladder` | 倍增之链 | 18 | 1.073e-6 | 93206756 | `mythic` | `mythic` | 700 | = |
| `pure-cyan-twin` | 青碧双峰 | 255 | 1.520e-5 | 6579300 | `uncommon` | `anomaly` | 34 | ↑3 |
| `pure-only-blue` | 唯蓝 | 255 | 1.520e-5 | 6579300 | `common` | `anomaly` | 14 | ↑4 |
| `pure-only-green` | 唯绿 | 255 | 1.520e-5 | 6579300 | `common` | `anomaly` | 12 | ↑4 |
| `pure-only-red` | 唯赤 | 255 | 1.520e-5 | 6579300 | `common` | `anomaly` | 10 | ↑4 |
| `pure-yellow-twin` | 鹅黄双峰 | 255 | 1.520e-5 | 6579300 | `uncommon` | `anomaly` | 30 | ↑3 |
| `gray-true-monochrome` | 灰阶行者 | 256 | 1.526e-5 | 6553600 | `common` | `anomaly` | 12 | ↑4 |
| `gray-mid-zone` | 中庸灰域 | 393 | 2.342e-5 | 4269012 | `epic` | `anomaly` | 130 | ↑1 |
| `math-power-trinity` | 幂次三重 | 512 | 3.052e-5 | 3276800 | `epic` | `anomaly` | 175 | ↑1 |
| `casino-royal` | 皇家同花顺 | 720 | 4.292e-5 | 2330169 | `epic` | `anomaly` | 130 | ↑1 |
| `extreme-dual-max` | 双峰满值 | 765 | 4.560e-5 | 2193100 | `rare` | `anomaly` | 85 | ↑2 |
| `extreme-ceiling-glow` | 贴顶余晖 | 815 | 4.858e-5 | 2058554 | `rare` | `anomaly` | 95 | ↑2 |
| `extreme-floor-glow` | 贴地微光 | 815 | 4.858e-5 | 2058554 | `rare` | `anomaly` | 70 | ↑2 |
| `gray-frost-zone` | 霜白灰域 | 1345 | 8.017e-5 | 1247377 | `rare` | `anomaly` | 75 | ↑2 |
| `gray-shadow-zone` | 幽影灰域 | 1345 | 8.017e-5 | 1247377 | `rare` | `anomaly` | 65 | ↑2 |
| `casino-five-kind` | 五条通天 | 1456 | 8.678e-5 | 1152281 | `epic` | `anomaly` | 150 | ↑1 |
| `extreme-full-span` | 双极贯通 | 1530 | 9.120e-5 | 1096550 | `rare` | `anomaly` | 90 | ↑2 |
| `math-fibonacci-trinity` | 斐波那契 | 2197 | 1.310e-4 | 763642 | `rare` | `epic` | 95 | ↑1 |
| `math-square-trinity` | 完全平方 | 4096 | 2.441e-4 | 409600 | `epic` | `epic` | 130 | = |
| `pattern-half-loop` | 半身回环 | 4096 | 2.441e-4 | 409600 | `mythic` | `epic` | 620 | ↓2 |
| `gray-near-neutral` | 近灰窄带 | 4578 | 2.729e-4 | 366475 | `uncommon` | `epic` | 30 | ↑2 |
| `perception-night-owl` | 暗夜低语 | 7387 | 4.403e-4 | 227118 | `epic` | `epic` | 140 | = |
| `casino-straight-six` | 六连顺 | 7920 | 4.721e-4 | 211834 | `rare` | `epic` | 85 | ↑1 |
| `lucky-triple-eight` | 八方来财 | 15616 | 9.308e-4 | 107436 | `rare` | `epic` | 75 | ↑1 |
| `lucky-triple-six` | 六六大顺 | 15616 | 9.308e-4 | 107436 | `rare` | `epic` | 60 | ↑1 |
| `perception-void-paradox` | 虚空悖论 | 17748 | 0.001058 | 94530 | `anomaly` | `rare` | 330 | ↓2 |
| `lucky-sum-520` | 五二零同心 | 30381 | 0.001811 | 55223 | `rare` | `rare` | 90 | = |
| `math-sum-255` | 满盈之数 | 32896 | 0.001961 | 51001 | `rare` | `rare` | 60 | = |
| `math-palindrome-trinity` | 回文三重 | 42875 | 0.002556 | 39131 | `rare` | `rare` | 80 | = |
| `casino-triple-pair` | 三对连环 | 50400 | 0.003004 | 33288 | `uncommon` | `rare` | 36 | ↑1 |
| `casino-four-kind` | 四条压阵 | 55456 | 0.003305 | 30253 | `rare` | `rare` | 90 | = |
| `lucky-tail-double-eight` | 双八压轴 | 65536 | 0.003906 | 25600 | `uncommon` | `rare` | 35 | ↑1 |
| `pattern-mirror-bytes` | 首尾呼应 | 65536 | 0.003906 | 25600 | `rare` | `rare` | 88 | = |
| `perception-daylight` | 炽白之昼 | 70604 | 0.004208 | 23762 | `rare` | `rare` | 55 | = |
| `math-digit-sum-equal` | 数位同和 | 92542 | 0.005516 | 18129 | `uncommon` | `rare` | 30 | ↑1 |
| `channel-twin-high` | 双峰突起 | 97155 | 0.005791 | 17269 | `rare` | `rare` | 62 | = |
| `casino-straight` | 五连顺 | 108720 | 0.006480 | 15432 | `rare` | `rare` | 62 | = |
| `perception-misty` | 雾面感 | 130476 | 0.007777 | 12858 | `uncommon` | `rare` | 30 | ↑1 |
| `math-prime-trinity` | 素数之约 | 157464 | 0.009386 | 10655 | `rare` | `rare` | 70 | = |
| `pattern-twin-peaks` | 双子星 | 195840 | 0.01167 | 8567 | `rare` | `uncommon` | 68 | ↓1 |
| `casino-full-house` | 葫芦满堂 | 207600 | 0.01237 | 8082 | `rare` | `uncommon` | 70 | ↓1 |
| `pattern-even-glyphs` | 偶数符 | 262144 | 0.01563 | 6400 | `rare` | `uncommon` | 52 | ↓1 |
| `pattern-odd-glyphs` | 奇数符 | 262144 | 0.01563 | 6400 | `rare` | `uncommon` | 54 | ↓1 |
| `casino-flush` | 同花 | 524288 | 0.03125 | 3200 | `rare` | `uncommon` | 80 | ↓1 |
| `lucky-avoid-four` | 避四纳八 | 634145 | 0.03780 | 2646 | `uncommon` | `uncommon` | 30 | = |
| `pattern-digit-only` | 纯数字 | 1000000 | 0.05960 | 1678 | `uncommon` | `uncommon` | 24 | = |
| `casino-three-kind` | 三条鼎立 | 1133056 | 0.06754 | 1481 | `rare` | `uncommon` | 55 | ↓1 |
| `perception-lime-glow` | 青柠微光 | 1237437 | 0.07376 | 1356 | `common` | `uncommon` | 11 | ↑1 |
| `perception-violet-dream` | 紫罗兰梦 | 1257769 | 0.07497 | 1334 | `common` | `uncommon` | 10 | ↑1 |
| `perception-teal-breath` | 青绿之息 | 1650637 | 0.09839 | 1016 | `common` | `uncommon` | 12 | ↑1 |
| `channel-all-high` | 高值通道 | 2097152 | 0.1250 | 800 | `common` | `common` | 14 | = |
| `channel-all-low` | 低值通道 | 2097152 | 0.1250 | 800 | `common` | `common` | 12 | = |
| `casino-two-pair` | 双对临门 | 2223600 | 0.1325 | 755 | `uncommon` | `common` | 24 | ↓1 |
| `channel-ascending` | 递增序 | 2763520 | 0.1647 | 607 | `epic` | `common` | 145 | ↓3 |
| `channel-descending` | 递减序 | 2763520 | 0.1647 | 607 | `epic` | `common` | 140 | ↓3 |
| `perception-neon-alarm` | 霓虹警报 | 3123048 | 0.1861 | 537 | `common` | `common` | 13 | = |
| `pattern-echo` | 重影 | 4627216 | 0.2758 | 363 | `common` | `common` | 9 | = |
| `math-bitwise-or-255` | 位满八极 | 5764801 | 0.3436 | 291 | `common` | `common` | 8 | = |
| `pattern-all-distinct` | 独步六符 | 5765760 | 0.3437 | 291 | `common` | `common` | 8 | = |
| `casino-pair` | 起手对子 | 11011456 | 0.6563 | 152 | `common` | `common` | 10 | = |
| `math-coprime-trinity` | 互质三数 | 13936093 | 0.8307 | 120 | `common` | `common` | 12 | = |

## 3. 最受影响的 10 条

| id | 旧 rarity | 新 rarity | 档位变化 | hits | ep | 原因 |
|---|---|---|---|---:|---:|---|
| `culture-bamboo-green` | `uncommon` | `mythic` | ↑4 | 1 | 1677721600 | 精确单色（hits = 1，竹青），作者手填 uncommon/CP 40，实测概率 5.96×10⁻⁸ 与纯黑同级 → 必须 mythic。 |
| `culture-rouge` | `uncommon` | `mythic` | ↑4 | 1 | 1677721600 | 同上：精确单色（hits = 1，胭脂），手填 uncommon/CP 30，实测与克莱因蓝完全同概率同分。 |
| `pure-only-blue` | `common` | `anomaly` | ↑4 | 255 | 6579300 | 单通道纯色只有 255 个（r=g=0），p = 1.52×10⁻⁵，手填 common/CP 14 低得离谱；同族 3 条一起跳 anomaly。 |
| `pure-only-green` | `common` | `anomaly` | ↑4 | 255 | 6579300 | 同上（hits = 255）；三原色在旧模型里 CP 10/12/14 的微小差别在新模型下完全消失。 |
| `pure-only-red` | `common` | `anomaly` | ↑4 | 255 | 6579300 | 同上（hits = 255）；旧 CP 10 是曾经的最低分之一，实际概率却排进全表前 23。 |
| `gray-true-monochrome` | `common` | `anomaly` | ↑4 | 256 | 6553600 | 严格灰只有 256 个（r=g=b），手填 common/CP 12；它与 `extreme-absolute-black/white` 是同一维度，理应同档偏高。 |
| `culture-prussian-blue` | `rare` | `mythic` | ↑3 | 1 | 1677721600 | 精确单色（hits = 1），手填 rare/CP 95 → mythic（ep 高 4 个数量级）。 |
| `culture-titian-red` | `rare` | `mythic` | ↑3 | 1 | 1677721600 | 精确单色（hits = 1），手填 rare/CP 85 → mythic。 |
| `culture-van-gogh-blue` | `rare` | `mythic` | ↑3 | 1 | 1677721600 | 精确单色（hits = 1），手填 rare/CP 70 → mythic。 |
| `pure-cyan-twin` | `uncommon` | `anomaly` | ↑3 | 255 | 6579300 | 双通道满值只有 255 色（hits = 255），手填 uncommon/CP 34 → anomaly。 |

## 4. 分数分布（`cp` = 保留徽章的 `ep` 之和，含 group 取代）

| 统计量 | 值 |
|---|---:|
| min | 152.36146791123716 |
| p1 | 152.36146791123716 |
| p50 | 1559.4573456324044 |
| p75 | 2472.8874675875554 |
| p90 | 6884.30280146654 |
| p95 | 14412.975916171741 |
| p99 | 53110.196074692285 |
| max | 1792285436.968631 |
| mean | 7515.1 |
| 不同取值数 | 24229 |

分布形状要点：

- **底部是一个大原子**：最小值 152.36146791123716 覆盖 **176788** 个颜色（占 1.0537%）；
- 顶部同样是一个原子：最大值 1792285436.968631 覆盖 **1** 个颜色（占 0.0000%）；
- `max / p99 = 33747×`：最顶端的分数比「神话线」高 4 个数量级以上，
  因为一条 `hits = 1` 的徽章单独就有 `ep = 1.68×10⁹`。

### 4.1 各 ScoreRarity 档的实际占比 vs 定义区间

把分位表当阈值用（`cp < p1` → trash，`p1 ≤ cp < p50` → common，……，`cp ≥ p99` → mythic）
反算各档实际占比：

| ScoreRarity | 定义区间宽度 | 实际占比 | 实际条数 | 偏差(pp) | 边界并列块(pp) | 判定 |
|---|---:|---:|---:|---:|---:|---|
| `trash` | 1 | 0.00000% | 0 | -1.00000 | max(0.0000, 1.0537) | ⚠️ 由并列块解释 |
| `common` | 49 | 49.92977% | 8376826 | +0.92977 | max(1.0537, 0.2876) | ⚠️ 由并列块解释 |
| `uncommon` | 25 | 25.06377% | 4205002 | +0.06377 | max(0.2876, 0.0210) | ⚠️ 由并列块解释 |
| `rare` | 15 | 15.00440% | 2517320 | +0.00440 | max(0.0210, 0.0092) | ✅ |
| `epic` | 5 | 4.99688% | 838337 | -0.00312 | max(0.0092, 0.0056) | ✅ |
| `anomaly` | 4 | 4.00389% | 671742 | +0.00389 | max(0.0056, 0.0161) | ✅ |
| `mythic` | 1 | 1.00129% | 167989 | +0.00129 | max(0.0161, 0.0000) | ✅ |

- 判定规则：偏差 ≤ 0.05pp 记 ✅；偏差超出但不超过边界并列块占比记 ⚠️（并列块整块只能落在一侧，属分位法的固有分辨率限制）；两者皆不满足记 ❌。
- 总体：**4 / 7 档偏差 ≤ 0.05pp ✅；另有 3 档偏差由边界并列块解释 ⚠️；越界档 0 个**。
- 结论：**分位表自洽（越界完全由并列解释）**。

  - `trash` 实际为 0 条：最小值原子占 1.0537% > 1%，最近秩 `p1` 因此等于最小值，`cp < p1` 为空集；
  - `common` 因此多吃了整个底部原子，偏差 0.9298pp，由同一并列块解释；
  - 另有 4 档偏差 ≤ 0.05pp ✅；`uncommon` 偏差 0.06377pp，由其边界并列块（0.2876pp）解释 ⚠️。

## 5. 验收核对（PRICING-SPEC 第 7 节）

### 5.1 同概率同分

- 全表共 **51** 个不同的 `hits` 值；`hits` 相同的组 **11** 个；
- 组内 `ep` 不一致的组：**0**（必须为 0）；
- 最大组：`hits = 1`，共 **13** 条（`channel-extreme-shift`、`culture-bamboo-green`、`culture-klein-blue`、`culture-marrs-green`、`culture-prussian-blue`、`culture-rouge`、`culture-tiffany-blue`、`culture-titian-red`、`culture-van-gogh-blue`、`extreme-absolute-black`、`extreme-absolute-white`、`lucky-golden-tone`、`pure-magenta-full`），它们的 `ep` 全部为 **1677721600**。

> 说明：`ep = 100 * N / hits` 是 `hits` 的纯函数，同 `hits` 必然同 `ep`，
> 此处是对生成数据的**数据侧复核**，不是公式重述。

### 5.2 单调性

- 验证方式：对全部 2850 个无序对逐一检查「`hits` 较小 ⟺ `ep` 较大」；
- 违反次数：**0**（必须为 0）；
- 等价做法：`ep` 是 `hits` 的严格递减函数 `100N/hits`，因此 Spearman 秩相关恒为 **−1**。

### 5.3 空徽章（`hits === 0`）—— 严重问题

**无。** 76 条徽章在全色域上均至少命中 1 个颜色，不存在永不命中的规则。✅

### 5.4 `hits === N`（全命中）

无。没有任何徽章命中全部 16,777,216 个颜色。

### 5.5 百分位自洽

验证方式：用分位表作阈值反算各档实际占比（第 4.1 节表）。

- 4 个档位偏差 ≤ 0.05pp，直接落在定义区间内 ✅；
- 3 个档位（`trash`、`common` 等边界上有并列块者）的偏差不超过该边界并列块占比，属分位法固有分辨率限制 ⚠️；
- 无法用并列解释的越界档：**0**；
- 判定：**通过（越界由并列块解释）**。
- 结构性结论：分位表本身自洽；但「按值取阈值」在并列块上的分辨率极限是真实存在的，`trash` 档当前不可达，需人决策（见第 6.1 节）。

### 5.6 可复现

- `pricing.gen.ts` 本次 md5：`78781bff78aaea7a7b0d4a9421762e05`；
- 生成过程不含时间戳、随机数、`Set`/`Map` 迭代顺序依赖或浮点累加顺序差异；键序按 id 显式升序排序；

- **复现证据（2026-10-03，连续两次完整枚举，脚本与徽章代码完全相同）**：
  - `pricing.gen.ts`：两次 md5 均为 `78781bff78aaea7a7b0d4a9421762e05`，**逐字节相同** ✅；
  - 本报告：两次正文逐字节相同，**唯一差异是「耗时」字段**（wall-clock 实测值，天然不可复现）⚠️；
  - 复核命令：`diff <(cp 第一次) <(cp 第二次)`，或比较两次打印的 md5。

> 逐字节复现要求（PRICING-SPEC 第 7 节第 6 条）针对的是**定价数据** `pricing.gen.ts`；本报告含实测耗时，两次运行必然不同，属预期。

## 6. 需要人判断的疑点

### 6.1 `trash` 档当前不可达 —— 需决策

- 分布底部是一个大原子：`min = 152.36146791123716`（176788 色，占 1.0537%），对应「只命中 `casino-pair` 一条」的颜色；
- 最近秩 `p1` 因此等于最小值，`cp < p1` 是空集，`trash` 档 0 条；
- 可选处理：
  1. **接受 trash 为空**（推荐先这样）：它只影响最底档，其余 6 档不受影响；
  2. 把 trash 语义改成「`cp = 0`（未命中任何计分徽章）」——但本表最"bare"的颜色也有 152 分，trash 仍然恒空；
  3. 在并列块内部用确定性次序（如 hex 升序）人为切出 1%——会破坏「同分同档」，与验收第 1 条冲突，**不推荐**；
  4. 把 p > 0.5 的「必中型」规则（`casino-pair`，p = 65.6%）移出计分集合——这属于计分范围问题，会让总分基线归零，需单独评估。

- **需要你拍板**：选 1 还是 4（或都要）。本阶段未动。

### 6.2 总分被单条极端徽章主导（PRICING-SPEC §9 的遗留问题被实证）

- `max / p99 = 33747×`；13 条 `hits = 1` 的规则各自 `ep = 1,677,721,600`，命中任意一条即接近封顶；
- `mythic`（前 1%）内部混了两类完全不同的颜色：命中某条 1/16,777,216 精确色（cp ≈ 1.68×10⁹），以及 5.31×10⁴ ≤ cp < 1.68×10⁹ 的「常见组合」；
- 即**档位内部跨 4.5 个数量级**：百分位只说明「在人群中的位置」，不说明「绝对有多稀有」；
- 需要你决定：展示层是否做对数压缩（§9 未决），以及是否给单条 `ep` 设上限。**本阶段不动。**

### 6.3 档位跳变的合理性（逐类看，未发现计算错误）

- ✅ 合理修正：`channel-ascending` / `channel-descending` 覆盖 **16.47%** 颜色却被手填成 `epic`（CP 145/140），新模型给 `common`（ep 607）——这是手填模型最严重的错配；
- ✅ 合理修正：`culture-*` 8 条精确色原本按作者口味散落在 `uncommon`…`mythic`，现在与 `extreme-absolute-black` / `extreme-absolute-white` 等共 13 条统一为 `mythic` / `ep = 1,677,721,600`——正是「同概率同分」的核心收益；
- ⚠️ 心理落差：`pure-only-red` / `green` / `blue`（各 255 色）与 `gray-true-monochrome`（256 色）从 `common` 直跳 `anomaly`（ep ≈ 6.6×10⁶）。它们与 `culture-*` 只差 1 个数量级（255 vs 1），而手填 CP 是 10–14 vs 700（差 50 倍，方向相反）；
- ✅ 与规范预言一致：`pattern-half-loop` 由 `mythic` 降为 `epic`（↓2，PRICING-SPEC §8 已点名）；
- 结论：所有跳变都能由 `hits` 直接解释，没有发现概率算错的情形。

### 6.4 语义上「该稀有却常见 / 该常见却稀有」

- `casino-pair` p = 65.6%：作为扑克牌型确实常见，但它同时是总分基线（152 分），使「什么都没抽到」这一状态不存在 → 见 6.1 决策 4；
- `math-coprime-trinity` p = 83.1%（手填 `common` / CP 12）、`pattern-echo` p = 27.6%（CP 9）、`math-bitwise-or-255` p = 34.4%（CP 8）：与概率一致，无异议；
- 唯一「反直觉但正确」的是 13 条精确色：**克莱因蓝与纯黑难度完全相同**，因此同档同分。这是概率定价的必然后果；若希望区分，只能改规则（例如给文化色附加额外约束），不能改阈值。

### 6.5 取代组在新权重下的行为

- 全表只有 2 个 group、11 条成员（均在 casino）：`casino-rank-count`（8 条）与 `casino-sequence`（3 条），都是包含链；
- 新权重下组内取 max 仍然等于「取链最顶端」：`ep` 与 `hits` 成反比，链上越稀有者 `ep` 越大。逐条核对组内顺序（pair 152 < two-pair 755 < … < six-kind 1.05×10⁸；straight 15432 < straight-six 211834 < royal 2330169），**未出现反转**；
- ❗未验证：这 11 条成员「被同组更高 ep 取代的比例」（需要第三趟遍历）。若某条 100% 被取代，它在计分上就是死徽章。GROUP-AUDIT 就旧 CP 做过这份工作，但 ep 权重下需重跑——**建议作为下一阶段的第一项**。

### 6.6 新 rarity 分布明显膨胀

- `mythic` 4 → 16、`anomaly` 6 → 16、`rare` 28 → 14；
- 原因：十进制阈值（10⁵/10⁶/10⁷）恰好落在本表 `hits` 密集的 255–4096 区间上，是分布事实而非调参；
- 若认为 `mythic` 太多：PRICING-SPEC §8 已明确配额失效，正确做法是改规则或接受，**不要动 ep 阈值**。需要你确认接受该分布。

### 6.7 本阶段未覆盖

- 第二趟只统计了 `cp`，未记录「每个 cp 由哪些徽章组成」；若要复核 mythic 档的构成，需第三趟记录 top 贡献者；
- `PRICING` 未接入 `calculateScore`；`SCORE_THRESHOLDS` / `getRarity` 仍是旧模型，`docs/BADGES.md` 也仍是旧 CP（本阶段严禁改动）；
- 未验证 76 条两两之间的包含/重叠关系在 ep 权重下是否会产生新的「静默吞分」组合。

## 7. 复现记录

| 项目 | 值 |
|---|---|
| 生成命令 | `pnpm -C packages/shared run enumerate` |
| pricing.gen.ts md5 | `78781bff78aaea7a7b0d4a9421762e05` |
| 第一趟耗时 | 86.98 s |
| 第二趟耗时 | 87.59 s |
| 两次运行 `pricing.gen.ts` | md5 相同（`78781bff78aaea7a7b0d4a9421762e05`），逐字节相同 ✅ |
| 两次运行本报告 | 仅「耗时」字段不同，其余逐字节相同 ⚠️ |
