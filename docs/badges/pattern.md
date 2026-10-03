# pattern 家族

代表色：`#A5A5A5`
家族定位：玩「十六进制字符串的结构」——相邻重影、字符去重、字符集、字节相等性、字节对称与半串回环。

> 📖 本家族的徽章表（含判定条件、命中数、概率 p 与 CP）见 [../BADGES.md](../BADGES.md) 的「### pattern — 模式」一节。CP 与稀有度由全色域概率推导（`ep = 100 / p`），请勿手写。

> 全色域枚举得到的命中率（实测约：独步六符 34.3%、重影 27.7%、纯数字 5.9%、偶数/奇数符各 1.6%、双子星 1.15%、首尾呼应 0.38%、半身回环 0.023%）即为概率 p，CP 与稀有度由 `ep = 100 / p` 推导，不再由作者指定。

## 备注

### 同家族反冗余（60 万随机样本 + 半身回环 4096 色全枚举）

- **无任何互相包含的条件对**（同上两轮检查均为 0 命中）。
- 逐对说明（含允许的部分重叠及其不构成蕴含的理由）：
  - 独步六符与重影**完全不相交**：六字符互不相同必然没有相邻相同字符。
  - 独步六符与双子星**完全不相交**：`R = G` 等必导致同字符重复出现。
  - 偶数符与奇数符**完全不相交**：一个字符不可能同属两个集合（互补划分，非细切分）。
  - 双子星不含「三字节全同」：`equalPairs` 为 3 时返回 false，故与 gray 家族的 `R = G = B` 零重合，也与首尾呼应（`R = B`，含灰阶）互不为子集。
  - 半身回环与偶数符 / 奇数符：4096 个半身回环色中各有 512 个（12.5%）同时命中，但 87.5% 不命中，两个方向都不构成子集。
  - 半身回环与重影：4096 个中 736 个（18%）同时命中（如 `#AABAAB`），`#ABCABC` 则不命中重影，故互不为子集。
  - 首尾呼应（`R = B`）与双子星：`R = B ≠ G` 的三分之一会同时命中，但灰阶（三字节全同）只命中首尾呼应，故互不为子集。
  - 重影与纯数字 / 偶数符 / 奇数符：`#112345` 只命中重影，`#123456` 不命中重影，双向均有反例。

### 跨家族检查结论（规范第 6 节补充）

检查方式：60 万随机样本做全 64 徽章两两「A 真 / B 假」计数，另对半身回环的全部 4096 色、虚空悖论的全部 17748 色做精确枚举。结论如下（「⊆」表示前者是后者的子集）。

- **本家族没有任何一条是别的家族某条的真子集**（逐条 0 反例）：
  - `pattern-echo`：不 ⊆ channel / pure / gray / extreme / math / lucky / culture 任何一条（反例：`#123456` 命中重影却不在 channel-all-low/high 等；`#112345` 同理）。
  - `pattern-all-distinct`、`pattern-digit-only`、`pattern-even-glyphs`、`pattern-odd-glyphs`、`pattern-twin-peaks`、`pattern-mirror-bytes`：均无被包含关系。
  - `pattern-half-loop`：对其**完整支持集**（4096 色）逐色验证，它不蕴含其余 56 条任何一条（不蕴含 channel-ascending/descending/all-high/all-low、gray 全族、pure 全族、math 全族、lucky 全族、culture 全族、perception 全族）。
- **反方向（别家 ⊆ 本家）确实存在，属于「宽条件包含窄条件」，非条件复写**：
  - `pure-only-red/green/blue`、`pure-yellow-twin`、`pure-cyan-twin`、`channel-twin-high`、`gray-mid-zone`、`extreme-dual-max` ⊆ `pattern-twin-peaks`；
  - `extreme-full-span`、`extreme-dual-max`、`pure-only-red/green/blue`、`pure-yellow-twin`、`pure-cyan-twin`、`culture-prussian-blue`、`lucky-triple-six/eight`、`lucky-tail-double-eight` ⊆ `pattern-echo`；
  - `math-doubling-ladder` ⊆ `pattern-all-distinct`；`math-power-trinity`、`culture-prussian-blue` ⊆ `pattern-digit-only`；
  - `gray-true-monochrome`、`pure-only-green` ⊆ `pattern-mirror-bytes`（因为凡 `R = G = B` 必有 `R = B`）。
  - 这些是「别的家族的窄条件落入本家族的宽结构」，本家族徽章本身不依赖它们的条件；如需彻底消除，只能把重影 / 双子星等宽结构徽章删掉，故保留并在此声明。
- **已删除的高风险设计（避免跨家族包含）**：
  - 初版的 `pattern-ascending` / `pattern-descending`（字节严格递增 / 递减）与 channel 家族的 `channel-ascending`（`R < G < B`）/ `channel-descending`（`R > G > B`）**条件逐字等价**，属重复条件，已整条删除，改用偶数符 / 奇数符 / 首尾呼应等结构维度。
  - 初版的 `pattern-byte-run`（三字节为连续整数）必然满足 `gray-near-neutral`（极差恰为 2 ≤ 2）与 `math-coprime-trinity`（连续整数互质），是真子集，已删除。
  - 初版的 `pattern-letter-only`（六字符均为 A-F）因每个字节 ≥ 0xAA，必然满足 `channel-all-high`，是真子集，已删除。
- **与 gray 家族的边界**：双子星要求「恰好两个相等」，三字节全同不命中，故与 `R = G = B` 零交集；首尾呼应（`R = B`）确实包含灰阶（`R = G = B ⟹ R = B`），这是「字节对称」维度的固有含义，方向是别家 ⊆ 本家，已在上面声明。
