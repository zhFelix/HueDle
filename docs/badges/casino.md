# casino 家族

代表色：`#C8102E`
家族定位：把 `ColorInfo.hex` 的 **6 个十六进制字符**当作 6 张牌（点数 `0–F`，共 16 种），
按**字符出现次数**判扑克牌型。维度是「计数 / 组合」，与 pattern 家族的「位置 / 相邻」维度正交。

> 📖 本家族的徽章表（含判定条件、命中数、概率 p、CP 与 group）见 [../BADGES.md](../BADGES.md) 的「### casino — 牌型」一节。CP 与稀有度由全色域概率推导（`ep = 100 / p`），请勿手写。

> 命中率来自**全 6 字符空间（16 777 216 色）穷举**：起手对子 65.63%、双对 13.25%、
> 三条 6.75%、同花 3.13%、四条 0.331%、三对 0.300%、葫芦 1.24%、五条 0.00868%、
> 五连顺 0.648%、六连顺 0.0472%、皇家 0.00429%（720 色）、六条 0.0000954%（16 色）。
> 以上命中率即为概率 p，CP 与稀有度由 `ep = 100 / p` 推导（牌型越窄、命中数越少，ep 越大），不再由作者给定。

## group 一览表

本家族**必须**用 `group` 表达包含链：牌型天然嵌套，因此同一条链上的成员一律写成
**「至少型」条件**并归入同一 group，由引擎（`scoring.ts` 的 `calculateScore`）在同组内
只保留 CP 最高的一条，而**不**把条件掰成互斥的「恰好型」。

- **`casino-rank-count`**（成员按 CP 升序）：`pair` → `two-pair` → `triple-pair` → `three-kind` → `full-house` → `four-kind` → `five-kind` → `six-kind`，偏序，见下。
- **`casino-sequence`**（成员按 CP 升序）：`straight` → `straight-six` → `royal`，全序链 `royal ⊂ straight-six ⊂ straight`。

### `casino-rank-count` 的包含结构（偏序，非全序）

```
six-kind ⊂ five-kind ⊂ four-kind ⊂ three-kind ⊂ pair
                                    full-house ⊂ three-kind
                                    full-house ⊂ two-pair
triple-pair ⊂ two-pair ⊂ pair
```

- `three-kind` 与 `triple-pair` **互不包含**：`#123121`（1×3）不是三对，`#112233`（1/2/3 各 2 次）不是三条。
- `full-house` 与 `triple-pair` **互不包含**：`#121213` 是葫芦不是三对，`#112233` 是三对不是葫芦。
- 成员只在**同一判定维度**（点数出现次数）的不同强度上重叠，正是 group 的合法用途。

### `casino-sequence` 的包含结构

```
royal ⊂ straight-six ⊂ straight
```

- 皇家（10–15）是六连顺的一个特例；六连顺（6 个互不相同的连续点数）必然含 5 个连续点数。
- 三条链的每个包含方向上都满足 **CP 严格递增**（`casino-six-kind.cp > casino-five-kind.cp > …`）：
  子集条件更窄 ⇒ 命中数更少 ⇒ 概率 p 更小 ⇒ `ep = 100 / p` 更大。
  该性质由 `casino.test.ts` 的「包含方向上的 CP 严格递增」用例逐对断言，保证引擎取到的是最强牌型。

## 备注

### 与既有 64 条的等价性核查（逐字等价必须消除）

核查方式：在测试中先扫一遍精选语料（覆盖全部稀有 / 精确色值命中集），
再**按顺序穷举全部 16 777 216 个 6 字符颜色**，对每一对 `(casino 徽章, 既有徽章)`
寻找「一方命中、另一方不命中」的差异见证；`pending` 清空即证明二者不等价。
若某对跑完全空间仍未区分，测试直接失败。

- **结果：0 条逐字等价**（768 对全部找到差异见证，`casino.test.ts` 内绿）。
- 另有一轮**离线全空间精确扫描**（16 777 216 色 × 76 条，102 s）交叉验证，等价数同样为 **0**。

**已排除的候选设计（就是踩过的坑）**：

- **「散牌 = 六字符两两不同」**：与 `pattern-all-distinct` **条件逐字等价**，按规范第 12 节直接**不定义**。本家族改走「至少一对」方向（它只是 `pattern-all-distinct` 的补集，与该条互补划分空间，非重复定义）。
- **「三条 = R = G = B」**：与 `gray-true-monochrome` **条件逐字等价**，已改为**字符计数**维度（`casino-three-kind` 要求某种点数出现 ≥3 次；`#1A1A1A` 才是三条，`#123123` 不是灰阶却是三条，二者互不为子集方向上的重复）。
- **「顺子序 = R < G < B」**：与 `channel-ascending` 逐字等价（`pattern-ascending` 已因此被删），本家族顺子按**点数连续**而非通道大小序定义。
- **「同花顺」单独成条**：它同时是 `casino-straight` 与 `casino-flush` 的真子集，跨两个 group，会在同家族内制造无法归组的蕴含对，故不定义；皇家同花顺的「同花」属性由 `casino-royal` 的 ABCDEF 自动满足。
- **「六字符全为 0-9 或全为 A-F」式凑数规则**：与 `pattern-digit-only` / `casino-flush` 部分重叠且无区分度，未采用。

### 与既有 64 条允许的跨家族包含（规范第 6/11 节：不同维度，重叠是正常的）

以下为**全空间精确**结论。先列「既有窄条件 ⊆ casino 宽条件」（共 78 处），
反方向「casino ⊆ existing」（共 10 处）见本节末尾。

- **`existing ⊂ casino-pair`（宽条件包含窄条件，共 38 条）**：gray 全族 6 条、extreme 全族 6 条、
  pure 全族 6 条、`channel-twin-high`、`channel-extreme-shift`、`math-power-trinity`、
  `perception-night-owl`、`pattern-echo`、`pattern-twin-peaks`、`pattern-mirror-bytes`、`pattern-half-loop`、
  culture 7 条、lucky 5 条。
  原因：这 38 条的命中色里必有重复 hex 字符（例如 `R = G`、相邻字符相同、精确色值恰好含重复字符），
  故必然构成「至少一对」。这是「宽结构包含窄条件」，不是条件复写——casino-pair 不依赖它们任何一条。
- **`existing ⊂ casino-two-pair`**：`extreme-full-span`、`pure-yellow-twin`、`pure-cyan-twin`、
  `pure-magenta-full`、`channel-extreme-shift`、`culture-tiffany-blue`、`culture-prussian-blue`、
  `culture-rouge`、`lucky-golden-tone`。
- **`existing ⊂ casino-three-kind`**：`gray-true-monochrome`、`gray-core-echo`、`extreme-absolute-black/white`、
  `extreme-dual-max`、`extreme-floor-glow`、`extreme-ceiling-glow`、`pure-only-red/green/blue`、
  `pure-magenta-full`、`channel-extreme-shift`、`math-power-trinity`、`lucky-triple-six/eight`。
  （`gray-true-monochrome` 的 hex 形如 `XYXYXY`，同一点数必出现 3 次。）
- **`existing ⊂ casino-flush`**：`extreme-absolute-black`、`extreme-absolute-white`、`culture-prussian-blue`
  （`#003153` 六个字符全 ≤ 7）。
- **`existing ⊂ casino-full-house`**：`pure-magenta-full`、`channel-extreme-shift`（`#FF00FF`、`#FF0080` 各含一个出现 3 次的字符与一个出现 2 次的字符）。
- **`existing ⊂ casino-four-kind` / `casino-five-kind` / `casino-six-kind`**：`extreme-absolute-black`、`extreme-absolute-white`
  等贴边界色（`#000000`、`#FFFFFF` 六个字符全同，命中整条链）。
- **反方向（casino ⊆ existing）只有 10 处**，均已在设计时确认可接受：
  - `casino-four-kind`、`casino-five-kind`、`casino-six-kind` ⊆ `pattern-echo`（同一点数出现 ≥4 次时，6 个位置里必有两个相邻相同）；
  - `casino-six-kind` ⊆ `gray-true-monochrome`（六字符全同 ⟹ 三字节相等）、
    ⊆ `math-digit-sum-equal`、⊆ `pattern-mirror-bytes`、⊆ `pattern-half-loop`；
  - `casino-straight-six`、`casino-royal` ⊆ `pattern-all-distinct`（六个字符两两不同）；
  - `casino-royal` ⊆ `channel-all-high`（A–F 每个字符 ≥ 8 ⟹ 每个字节 ≥ 136 ≥ 128）。
  这些是「本家族的窄牌型恰好落入别家的宽结构」，属规范第 11 节明示的允许重叠
  （两个不同特征恰好相关 → 不要同组，玩家应同时拿到两笔分）。若强行消除，只能删掉整条链的顶端或别家的宽结构徽章，故保留并在此声明。

### 反冗余理由（同家族内）

- 同家族的 12 条**没有任何一对互为子集**，除非二者同 group（那正是设计意图）。
  证据：`casino.test.ts` 的「包含关系在采样上无反例」用例逐条断言
  `[子, 超集]` 显式列表；列表之外的对（如 `three-kind` vs `triple-pair`、`full-house` vs `four-kind`）
  双向均有反例，不构成蕴含。
- `casino-flush`（花色维度）与两条链（计数 / 连续维度）**不同维度**，故意不设 group：
  一条颜色可以同时是同花与顺子（如 `#012345`），玩家应当同时拿到两笔分。
- `casino-pair` 与 `pattern-all-distinct` 互补划分空间：任一颜色**恰好命中其中之一**，
  故不会出现「永远同时命中」的刷分对。
