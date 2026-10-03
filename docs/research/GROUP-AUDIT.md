# HueDle `group`（取代组）审计记录

> 审计对象：`gray` / `extreme` / `pure` / `channel` / `math` / `perception` / `pattern` / `culture` / `lucky`
> 共 **9 个家族、64 条徽章**（`casino` 不计入，它有自己真正的阶梯型 group）。
> 规范依据：[BADGE-SPEC.md](../BADGE-SPEC.md) 第 11 节；机制来源：[RNGDLE-NOTES.md](./RNGDLE-NOTES.md) 第 5 节。
> 执行日期：2026-10-03。

---

## 1. 结论

**现有 64 条中合法 group = 0 个。现有 9 个家族源文件里本来就没有 `group:` 字段，本次也未添加。**

这不是遗漏，而是正确答案。两条独立的充分理由：

1. **不存在"高度重叠"的对**：全色域 2²⁴ 穷举下，任意两条徽章的最大 Jaccard 只有 **0.4961**，Jaccard ≥ 0.5 的对为 **0**。规范第 11 节允许的两种形状（包含 / 高度重叠）里，后者完全不存在。
2. **存在包含关系的 101 对，全部是"宽结构 ⊇ 窄语义"**，即规范第 11 节点名禁止的第二类："两个不同特征恰好相关"。它们分属不同判定维度，同组会静默吞掉玩家得分。

因此规范第 11 节末句所述情形成立：**没有真正同规则不同强度的组合时，一条都不加就是正确答案。**

---

## 2. 方法

### 2.1 为什么是穷举而不是采样

颜色空间只有 16,777,216 = 2²⁴ 个元素，且全部徽章的 `check` 都是对 `(r,g,b)` 的纯函数判定。这个规模一次完整遍历只需数十秒，因此**没有任何理由使用采样**。

采样会带来两个具体缺陷，恰好都会误导本次判定：

- **小支撑徽章在采样中永远命中不到**。`culture-*` 8 条各只有 1 个颜色命中，随机采样 2 万个色命中概率约 0.1%；此时它们的命中集合在采样下是空集，而空集 ⊆ 任何集合恒真，会凭空造出大量假包含对。
- **"未发现反例"不等于"不存在反例"**。包含关系的反例可能极稀疏（例如 `gray-mid-zone` 对 `pattern-twin-peaks` 的反例只占 393 个命中色中的极少数），采样容易漏掉。

本次实现为**全色域精确遍历**，因此下文所有包含关系与 Jaccard 都是**已证明的精确值**，而非估计值。

### 2.2 判定方式

- 遍历 `r,g,b ∈ [0,255]` 的全部 16,777,216 种组合，对每条颜色求命中集合。
- 对每一个**无序对**累计同时命中计数 `|A ∩ B|`，并累计各徽章的单条命中数 `|A|`、`|B|`。
- 有向包含：`A ⊆ B` ⟺ `|A| > 0` 且 `|A ∩ B| == |A|`（空集不参与判定）。
- Jaccard：`J(A,B) = |A ∩ B| / (|A| + |B| − |A ∩ B|)`。
- 候选 group 的评估另跑一遍遍历，统计每个候选成员集合的"同时命中 ≥2 名成员的颜色数"（对应 `registry.test.ts` 第 9 条），以及**每名成员被同组更高 CP 成员取代的比例**（100% 即该徽章永不单独计分）。

---

## 3. 关键数据

### 3.1 有向包含关系

**101 对，分布在 29 个超集上，全部为 strict 包含（无等价对、无互相包含的对）。**

`pattern-echo` 一条就吞下 18 条，`channel-all-low` / `channel-all-high` 覆盖色域的 12.5%，`math-coprime-trinity` 覆盖 83.07% —— 这些都是"宽结构"，被它们包含的 `culture-*`（精确色）、`lucky-*`（玄学数字）、`pure-*`（单通道纯色）与它们没有任何判定维度上的共同性。

| 超集 B | 被包含条数 | 成员 A（`A ⊆ B`） |
|---|---|---|
| `pattern-echo` | 18 | `extreme-absolute-black`、`extreme-absolute-white`、`extreme-full-span`、`extreme-dual-max`、`pure-only-red`、`pure-only-green`、`pure-only-blue`、`pure-yellow-twin`、`pure-cyan-twin`、`pure-magenta-full`、`channel-extreme-shift`、`culture-klein-blue`、`culture-prussian-blue`、`culture-rouge`、`lucky-triple-six`、`lucky-triple-eight`、`lucky-tail-double-eight`、`lucky-golden-tone` |
| `math-coprime-trinity` | 9 | `gray-core-echo`、`channel-extreme-shift`、`culture-klein-blue`、`culture-tiffany-blue`、`culture-marrs-green`、`culture-prussian-blue`、`culture-titian-red`、`culture-van-gogh-blue`、`culture-rouge` |
| `pattern-twin-peaks` | 8 | `extreme-dual-max`、`pure-only-red`、`pure-only-green`、`pure-only-blue`、`pure-yellow-twin`、`pure-cyan-twin`、`pure-magenta-full`、`channel-twin-high` |
| `channel-all-low` | 7 | `gray-shadow-zone`、`extreme-absolute-black`、`extreme-floor-glow`、`perception-night-owl`、`perception-void-paradox`、`culture-prussian-blue`、`culture-van-gogh-blue` |
| `math-bitwise-or-255` | 6 | `extreme-absolute-white`、`extreme-full-span`、`extreme-dual-max`、`pure-magenta-full`、`channel-extreme-shift`、`lucky-golden-tone` |
| `pattern-digit-only` | 6 | `gray-core-echo`、`extreme-absolute-black`、`math-power-trinity`、`culture-marrs-green`、`culture-prussian-blue`、`culture-bamboo-green` |
| `channel-all-high` | 5 | `gray-frost-zone`、`gray-core-echo`、`extreme-absolute-white`、`extreme-ceiling-glow`、`perception-daylight` |
| `pattern-mirror-bytes` | 5 | `gray-true-monochrome`、`extreme-absolute-black`、`extreme-absolute-white`、`pure-only-green`、`pure-magenta-full` |
| `perception-neon-alarm` | 5 | `extreme-full-span`、`pure-magenta-full`、`channel-extreme-shift`、`culture-tiffany-blue`、`lucky-golden-tone` |
| `channel-ascending` | 3 | `culture-klein-blue`、`culture-prussian-blue`、`culture-van-gogh-blue` |
| `extreme-full-span` | 3 | `pure-magenta-full`、`channel-extreme-shift`、`lucky-golden-tone` |
| `math-digit-sum-equal` | 3 | `gray-true-monochrome`、`extreme-absolute-black`、`extreme-absolute-white` |
| `perception-daylight` | 3 | `gray-frost-zone`、`extreme-absolute-white`、`extreme-ceiling-glow` |
| `gray-true-monochrome` | 2 | `extreme-absolute-black`、`extreme-absolute-white` |
| `pattern-half-loop` | 2 | `extreme-absolute-black`、`extreme-absolute-white` |
| `perception-misty` | 2 | `gray-mid-zone`、`gray-core-echo` |
| `perception-teal-breath` | 2 | `culture-tiffany-blue`、`culture-marrs-green` |
| `channel-descending` | 1 | `lucky-golden-tone` |
| `extreme-dual-max` | 1 | `pure-magenta-full` |
| `gray-frost-zone` | 1 | `extreme-absolute-white` |
| `gray-shadow-zone` | 1 | `extreme-absolute-black` |
| `lucky-avoid-four` | 1 | `gray-core-echo` |
| `math-fibonacci-trinity` | 1 | `extreme-absolute-black` |
| `math-palindrome-trinity` | 1 | `extreme-absolute-black` |
| `math-square-trinity` | 1 | `extreme-absolute-black` |
| `pattern-all-distinct` | 1 | `culture-marrs-green` |
| `pattern-even-glyphs` | 1 | `extreme-absolute-black` |
| `pattern-odd-glyphs` | 1 | `extreme-absolute-white` |
| `perception-night-owl` | 1 | `extreme-absolute-black` |

### 3.2 Jaccard —— "不存在高度重叠"的核心证据

**Jaccard ≥ 0.9：0 对。Jaccard ≥ 0.5：0 对。**

| 排名 | Jaccard | A | B | 同时命中 |
|---|---|---|---|---|
| 1 | **0.4961** | `channel-twin-high` | `pattern-twin-peaks` | 97,155 |
| 2 | 0.3843 | `math-coprime-trinity` | `math-bitwise-or-255` | 5,469,018 |
| 3 | 0.3329 | `pattern-twin-peaks` | `pattern-mirror-bytes` | 65,280 |
| 4 | 0.3325 | `math-coprime-trinity` | `pattern-all-distinct` | 4,916,706 |

全场 2016 个无序对中，**最高的 Jaccard 只有 0.4961**，出现在唯一一个"真包含且子集占比可观"的对上。以 0.3 为列举阈值时，全部 2016 对中只有上表 4 对达标，**其余 2012 对全部低于 0.3**。这直接排除了规范第 11 节"高度重叠"这一整类依据。

### 3.3 窄支撑徽章的精确命中数

以下数字均为 2²⁴ 穷举的精确值（非采样估计）：

| 命中色数 | 徽章 |
|---|---|
| **1** | `extreme-absolute-black`、`extreme-absolute-white`、`pure-magenta-full`、`channel-extreme-shift`、`lucky-golden-tone`、`culture-klein-blue`、`culture-tiffany-blue`、`culture-marrs-green`、`culture-prussian-blue`、`culture-titian-red`、`culture-van-gogh-blue`、`culture-bamboo-green`、`culture-rouge`（共 13 条，每色唯一） |
| **18** | `gray-core-echo`、`math-doubling-ladder`（后者仅 {7,14,28} / {28,56,112} / {63,126,252} 的全排列，因为 `a+2a+4a = 7a` 必须是完全平方数） |
| **255** | `pure-only-red`、`pure-only-green`、`pure-only-blue`、`pure-yellow-twin`、`pure-cyan-twin` |
| **256** | `gray-true-monochrome` |
| **393** | `gray-mid-zone` |
| **512** | `math-power-trinity` |
| **765** | `extreme-dual-max` |
| **815** | `extreme-floor-glow`、`extreme-ceiling-glow` |

这些徽章若用采样审计会全部退化成空集，从而产生虚假的包含关系 —— 这是本次坚持穷举的直接原因。

---

## 4. 最有说服力的反例：`pattern-twin-peaks` 超大组

候选组 **{`pattern-twin-peaks`, `channel-twin-high`, `extreme-dual-max`, `pure-only-red`, `pure-only-green`, `pure-only-blue`, `pure-yellow-twin`, `pure-cyan-twin`, `pure-magenta-full`}** 是全表唯一一个"重叠规模足够大、能通过 `registry.test.ts` 第 9 条"的候选（同时命中 ≥2 名成员的颜色达 **99,193** 个）。它看起来像是可以成立的。

穷举评估结果否定了它：

| 成员 | CP | 命中色数 | 被同组更高 CP 取代 | 取代比例 | 损失 CP |
|---|---|---|---|---|---|
| `pattern-twin-peaks` | 68 | 195,840 | 765 | 0.39% | 52,020 |
| `channel-twin-high` | 62 | 97,155 | **97,155** | **100.00%** | **6,023,610** |
| `extreme-dual-max` | 85 | 765 | 1 | 0.13% | 85 |
| `pure-only-red` | 10 | 255 | **255** | **100.00%** | 2,550 |
| `pure-only-green` | 12 | 255 | **255** | **100.00%** | 3,060 |
| `pure-only-blue` | 14 | 255 | **255** | **100.00%** | 3,570 |
| `pure-yellow-twin` | 30 | 255 | **255** | **100.00%** | 7,650 |
| `pure-cyan-twin` | 34 | 255 | **255** | **100.00%** | 8,670 |
| `pure-magenta-full` | 320 | 1 | 0 | 0.00% | 0 |

**`channel-twin-high` 的每一次命中都会被 `pattern-twin-peaks` 取代（97,155 / 97,155 = 100%），`pure` 五条同样 100% 被取代。** 也就是说，这些徽章在该组下**永不单独计分**，退化为只能"收藏"、不产生任何分数的死徽章 —— 这正是规范第 11 节警告的"静默吞掉玩家得分"，而且此处有精确量化：单是 `channel-twin-high` 一条在全色域就损失 6,023,610 CP。

原因很直白：`pattern-twin-peaks`（"恰好两个通道相等"）是**通用结构**，CP 68；`channel-twin-high`（"恰好两个相等且第三个更大"，CP 62）、`pure-only-*`（"单通道纯色"，CP 10–14）都是被它蕴含的**窄语义**徽章，且 CP 全部更低。取代组取最高分，于是窄的那条永远拿不到分。**"包含关系 + 高 CP 在宽的那条"就是这个陷阱的判别式。**

---

## 5. 刻意互斥型：评估过，但选择不放宽

现有作者为规避重复计分，把若干"同一指标的不同档位"写成了**互斥**条件（例如 `0 < 极差 ≤ 2` 排除严格灰）。这类对子在全色域上 **overlap = 0**，直接违反 `registry.test.ts` 第 9 条，因此要成组必须先放宽条件。三个候选的精确评估：

| 候选组 | 现状条件 | 放宽后条件 | 放宽后命中色数 | 若成组净损 CP |
|---|---|---|---|---|
| `gray-true-monochrome` + `gray-near-neutral` | `spread = 0` / `0 < spread ≤ 2` | `spread ≤ 2` | **4,834**（4,578 + 256） | **3,072**（256 × 12） |
| `extreme-absolute-black` + `extreme-floor-glow` | `sum = 0` / `0 < sum ≤ 15` | `sum ≤ 15` | **816**（815 + 1） | **70**（1 × 70） |
| `extreme-absolute-white` + `extreme-ceiling-glow` | `sum = 765` / `750 ≤ sum ≤ 764` | `sum ≥ 750` | **816**（815 + 1） | **95**（1 × 95） |

**决定：三个都不放宽、都不加 group。**

理由有两条，第二条是决定性的：

1. **`0 <` 是徽章语义本身，不是防重复的补丁。** "近灰窄带"的"近"字、"贴地微光"的"微光"、"贴顶余晖"的"余晖"都明确排除严格灰 / 纯黑 / 纯白。放宽后 `check` 会与 `name`、`description` 冲突，需要同时改写描述、测试与家族文档 —— 而徽章的身份（玩家看到的名字与条件式）也随之改变，收益却只是"多了一个 group"，得不偿失。
2. **它们当前互斥，就已经不存在重复计分，因此 group 是多余的。** `group` 的唯一作用是"集合重叠时只取最高分"。两个互斥条件永远不会同时命中，本来就不可能重复计分。**为了让 group 能生效而故意去制造重叠，是把手段当成了目的** —— 这正好也是规范第 11 节末句"不要去凑 group"的意思。

> 附注：另有一批候选同样 overlap = 0，无需逐一放松，直接判不成立 ——
> `{pure-only-red, pure-only-green, pure-only-blue}`、`{pure-yellow-twin, pure-cyan-twin}`、
> `{channel-all-high, channel-all-low}`、`{gray-shadow-zone, gray-frost-zone}`、
> `{perception-night-owl, perception-void-paradox}`、`{extreme-absolute-black, extreme-absolute-white}`、
> `culture-*` 8 条、`{pattern-all-distinct, pattern-half-loop}`。
>
> 另有一个 overlap > 0 却仍应拒绝的候选：`{lucky-triple-six, lucky-triple-eight}` 全色域仅 **2 色**
> 同时命中（`#666888` / `#888666`），能过第 9 条，但"连续三个 6"与"连续三个 8"是**并行实例而非强度档位**
> —— RNGdle 的 `JACKPOT` 链是同一数字 7 的 `777 ⊂ 7777 ⊂ 77777`。属"凑 group"，拒绝。

---

## 6. 修正记录

穷举修正了此前人工审计的一处误判：

- ❌ 旧记录：`gray-mid-zone ⊆ pattern-twin-peaks`
- ✅ 实际：**不成立**。反例 `(100,100,100)`：`max−min = 0 ≤ 1` 且三通道都在 100–156，命中 `gray-mid-zone`；但三个通道两两相等，`equalPairs = 3`，而 `pattern-twin-peaks` 要求 `equalPairs === 1`，故不命中。

`gray-mid-zone` 允许 `spread = 0`（严格灰），这正是它不落入 `pattern-twin-peaks` 的原因 —— 与 `gray-near-neutral` 用 `0 < spread` 排除严格灰的处理方向相反。此类"反例只占命中集合的极小比例"的关系，正是采样审计容易漏判、必须穷举的地方。

---

## 7. 对未来徽章扩充的指导

**判断标准（放同一 group 的充分条件）**，须同时满足：

1. **命中集合存在包含或高度重叠**（可用本记录的穷举方法验证，不靠肉眼）；
2. **语义上是同一条判定规则的不同强度 / 阈值档位**，而非两个不同特征恰好相关。

**应当放进同一 group 的形状：**

- **阶梯型**：`X` / `X-EXACT` / `X-FOUR` / `X-FIVE`，即"至少型"逐级加严。命名模式本身就是信号。
- **档位型**：同一指标按阈值切成的多档，例如同花色的"至少一对 / 两对 / 三条 / 葫芦 / 四条 / 五条 / 六条"。

**不要放进同一 group 的形状：**

- 只是**主题相关** —— 那是 `family` 的职责。
- **宽结构 ⊇ 窄语义** —— 例如 `pattern-echo ⊇ pure-only-red`、`pattern-twin-peaks ⊇ channel-twin-high`。二者的判定维度不同（通用相邻重复 / 单通道纯色；通道相等性 / 通道大小序），玩家应各拿一笔分。
- **同维度的互斥分档**（如 `channel-all-high` / `channel-all-low`）—— 它们从不重叠，加 group 无任何效果，且违背第 9 条。

**本审计不能替代的场景。** 本次"0 个 group"的结论只说明**现有 64 条中不存在**阶梯或档位型关系；它**不构成对 `group` 机制本身的否定**。恰恰相反：牌型、连顺这类天然"至少型"嵌套的徽章（`casino-rank-count`、`casino-sequence`）**必须**用 group 表达包含链、由引擎取最高分，而不是把条件掰成互斥的"恰好型"。本记录的价值在于：**新增徽章时，先问它是"同一规则加严"还是"另一个维度的新规则"**，只有前者才配 `group`。

---

## 附录：复现方式

审计脚本为一次性临时程序，**未进入仓库**。原始数据留存于 `/tmp/huedle-audit/`：

| 文件 | 内容 |
|---|---|
| `audit.test.ts` | 2²⁴ 全枚举：有向包含对 + Jaccard + 单条命中数 |
| `candidates.test.ts` | 候选 group 精确评估：重叠色数 + 各成员被取代比例 |
| `audit-result.json` | 101 对包含关系、各徽章命中数的机器可读结果 |
| `run-full3.log` / `run-cand.log` | 原始运行输出 |

脚本通过 vitest 以仓库源码（`packages/shared/src/`）为模块直接运行，保证审计的就是线上实现；`casino` 未参与统计。

## 相关文档

- [../BADGE-SPEC.md](../BADGE-SPEC.md) 第 11 节 —— `group` 字段语义与使用条件
- [RNGDLE-NOTES.md](./RNGDLE-NOTES.md) 第 5 节 —— 取代（supersession）机制的由来
