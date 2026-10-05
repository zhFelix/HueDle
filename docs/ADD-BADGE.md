# 添加一条徽章

> **这份是操作清单**——照着做，一次通过。
>
> 规则与理由在别处：[BADGE-SPEC.md](BADGE-SPEC.md) 是作者契约，[PRICING-SPEC.md](PRICING-SPEC.md) 是定价模型。
> 这份文档只回答"我该动哪个文件、跑哪条命令、看到什么才算对"。

---

## ⚠️ 先看这个：BADGE-SPEC.md 第 3 节已过时

`BADGE-SPEC.md` 的 §3「CP 校准表」与「全局配额」是**早期手填分值时代**的产物，**与现在的代码直接矛盾**：

| §3 说 | 实际 |
|---|---|
| 单徽章 CP 手填：common 5–15、mythic 500–800 | `BadgeDef` **根本没有 `cp` 字段**；CP = `ep = 100/p`，由全色域枚举算出 |
| `mythic` 全项目 ≤ 4 条、`anomaly` ≤ 6 条、`epic` 每家族 ≤ 2 条 | 已经废除。现在 mythic 16 条、anomaly 16 条，**稀有度是概率算出来的结果，不是配额** |

**照着 §3 写会直接卡住**（你会去找一个不存在的字段）。以本文档和 `PRICING-SPEC.md` 为准。

---

## 30 秒版本

```bash
# 1. 在 packages/shared/src/badges/<family>.ts 里加一条 BadgeDef
# 2. 重新枚举定价（约 3 分钟）
pnpm -C packages/shared run enumerate
# 3. 重新生成徽章总表
pnpm -C packages/shared run docs
# 4. 全套测试
pnpm -C packages/shared test
```

> 加多条时不要逐条重复上面 4 步（N 条 ≈ N×10 分钟）——见下面的「批量」。

---

## 批量：一次加 N 条（只跑一次枚举）

把要加的若干条 spec 写成一个 **JSON 数组**，交给同一条流水线：

```bash
# badges.json 的内容是数组，即批量提交
pnpm -C tools/admin run add-badge -- --spec badges.json
```

```json
[
  { "id": "gray-mid-echo", "name": "中间回声", "description": "R = G = B 且该值在 100–155", "family": "gray",
    "when": { "between": [{ "field": "r" }, 100, 155] } },
  { "id": "math-prime-sum", "name": "质数和", "description": "R + G + B 是质数", "family": "math",
    "when": { "isPrime": { "add": [{ "field": "r" }, { "field": "g" }, { "field": "b" }] } } }
]
```

要点（与逐条完全一致的规则，只是合到一次）：

- **一个事务，全有或全无**：N 条要么全部落地并跑完流水线，要么整批回滚；
  不存在「3 条成功、2 条失败」这种半截状态。
- **只跑一次枚举**：`enumerate` → md5 幂等复跑 → `docs` → `supersession` → `test`
  对整批各只执行一次，不随 N 增长（N 条 ≈ 10 分钟，而不是 N×10 分钟）。
- **N 条可跨家族文件**：快照/回滚覆盖全部受影响文件，回滚后所有文件逐字节（md5）复原
  且 `git diff --exit-code` 干净。
- **写盘前仍要 2²⁴ 干跑**，且批量额外做 **新 vs 新** 的必然蕴含检查：
  新增的徽章彼此之间若构成包含关系（A 命中 ⇒ B 命中）且不在同一个 `group`，
  会同时命中、双倍计分，直接被拦下（零写盘）——同组豁免与单条口径一致。
- 其余安全性质不变：脏工作区拒绝开跑（exit 7）、并发拒绝（exit 6）、
  stale 锁检出（exit 8）、全局平衡类失败保留现场（exit 3）。

---

## 三条铁律

### ① 不要写 CP，不要写稀有度

```ts
// ❌ 这两个字段不存在，写了也编译不过
{ id: 'x', cp: 500, rarity: 'mythic', /* ... */ }
```

徽章定义里只有**判定规则**。CP 和稀有度是**枚举 2²⁴ 个颜色数出来的结果**：

```
p  = 命中颜色数 / 16777216
ep = 100 / p            ← 这就是 cp
rarity = ep 的十进制分档  ← 这就是稀有度
```

### ② 想让它更稀有，就写更窄的规则

不要"标个 mythic"——**稀有度是你判定条件的宽度决定的，不是声明出来的**。

```ts
// 命中 1677 万种 → ep ≈ 0.0001 → common
check: c => c.r > 128

// 只命中 1 种 → ep ≈ 1.6 亿 → mythic
check: c => c.hex === '#000000'
```

### ③ 改完必须重跑枚举

`badges/index.ts` 会检查每条徽章都有定价，**缺失时直接抛错**（不静默给 0 分）：

```
徽章 "math-xxx" 缺少定价数据。新增或改名徽章后必须重跑：
pnpm -C packages/shared run enumerate
```

看到这条报错就是提醒你第 2 步没做，不是代码坏了。

---

## 模板

复制到 `packages/shared/src/badges/<family>.ts` 的数组里（**`family` 字段必须和文件名一致**）：

```ts
  {
    id: 'math-triple-palindrome',      // kebab-case，全局唯一，带家族前缀
    name: '三重回文',                   // 中文 2–6 字，同家族内不重名
    description: 'R、G、B 三个数各自都是回文数',   // 读者能据此手算验证
    family: 'math',
    check: c =>
      isPalindromeNumber(c.r) && isPalindromeNumber(c.g) && isPalindromeNumber(c.b),
  },
```

带 `group` 的（**只在有包含链时用**，见下）：

```ts
  {
    id: 'casino-six-kind',
    name: '六合同色',
    description: '六个十六进制字符全部相同',
    family: 'casino',
    group: 'casino-rank-count',        // 与 pair/triple/... 同一条链
    check: c => new Set(c.hex.slice(1)).size === 1,
  },
```

### 可用的判定函数

来自 `./helpers`（**别自己重写**，这些有测试覆盖）：

```
isPowerOfTwo  isPrime  isPerfectSquare  isFibonacci  digitSum
isPalindromeNumber  gcd  lcm
maxChannel  minChannel  channelSum  distinctChannelCount
isGray  hexBytes  toHexByte
```

`check` 的参数是 `ColorInfo`（定义见 `packages/shared/src/types.ts`）：
顶层是 `r` / `g` / `b` / `hex`，**HSL 在子对象里**——是 `c.hsl.h` / `c.hsl.s` / `c.hsl.l`，不是 `c.h`。

### 手写路径：引用家族文件里的 private helper

当判定逻辑复杂到 `helpers.ts` 的冻结词汇表装不下时（约 27% 的徽章形态），可以走**手写路径**：
`check` 写成一段**单表达式**，直接引用目标家族文件里已有的 private helper（`const` 箭头函数）。

```jsonc
{
  "id": "casino-pair-probe", "name": "探测", "description": "六位里至少一对相同",
  "family": "casino",
  "handwritten": {
    "check": "onRanks(c, counts => ranksAtLeast(counts, 2) >= 1)",
    // 只给**依赖名字列表**（不是实现！）
    "evalHelpers": ["onRanks", "ranksAtLeast"]
  }
}
```

干跑会**直接 `import` 目标家族文件里的真品**来求值（工具本身跑在 `tsx` 下），因此：

- `evalHelpers` 只是**名字列表**，干跑不再接受任何作者提供的实现副本——
  「干跑求值的东西」与「写进仓库的东西」必然是同一份代码，**副本漂移这一失效模式被彻底移除**；
- 被引用的 helper 必须是**顶层 `const` 声明且带 `export`**（只加 `export`，不改实现），否则干跑报错终止；
- 降级一律是**报错中止**：`import` 失败 / 名字不存在（没声明、没 `export`）/ 求值抛异常，
  都不会静默退回任何副本，工作区零改动。

> **加新 helper 的流程（顺序不能反）：先把 helper 单独提交，再加徽章。**
>
> `tools/admin` 把**家族文件本身**算作受影响路径，而流水线在受影响路径有未提交改动时
> **拒绝开跑**（退出码 7，见 `pipeline.ts` 的 `dirty.length > 0`）。所以：
>
> 1. 在 `packages/shared/src/badges/<family>.ts` 里加 `export const myHelper = …;`；
> 2. `git add` + `git commit`（让家族文件重新变干净）；
> 3. 再提交引用 `myHelper` 的徽章 spec。
>
> **不要**为了让「先写盘再 import」可行去放松那条脏工作区守卫——它的用途是「不覆盖别人的工作」，
> 风险更大。顺序反过来只会被明确拒绝，不会产生半截状态。

### 字段约束速查

| 字段 | 约束 |
|---|---|
| `id` | kebab-case、纯英文小写、**全局唯一**、建议带家族前缀 |
| `name` | 中文，2–6 字优先，**同家族内不得重名** |
| `description` | 中文可判定条件式描述——读者要能据此手算出是否命中 |
| `family` | 必须与所在文件一致 |
| `group` | 可选。**严格限制**，见下节 |
| `check` | 纯函数：只用 `color` 和上面的 helper，**不得抛异常** |

---

## `group`（取代组）：只在真的有包含链时用

同一 `group` 里的徽章**只取 CP 最高的一条计分**，其余仍算"已获得"但不加分。

**该用的形状**——同一条规则的不同强度档位：

```
casino-pair ⊂ casino-triple ⊂ ... ⊂ casino-six-kind
每一条都是"至少 N 个相同"，命中集合严格包含
```

**不该用的**——主题相关但条件无关：

```ts
// ❌ 这三个都"和颜色通道有关"，但命中集合互不包含
//    放进同一 group 会静默吞掉玩家两次得分
{ id: 'channel-ascending', group: 'channel-theme' }
{ id: 'channel-high',      group: 'channel-theme' }
```

**判断方法**：问自己「**命中 A 是否必然命中 B？**」
- 是 → 有包含关系，可以用 group
- 否 → 不能用，那是 `family` 该干的事

**命名**：`<family>-<dimension>`，如 `casino-rank-count`。命名空间全局，允许跨 family 同组。

> 项目里曾经审计过：原有 64 条徽章里**一个合法的 group 都没有**（最大 Jaccard 相似度 0.4961）。
> 所以 `group` 是为 casino 那种阶梯规则引入的，**不是用来给既有徽章"归类"的**。

---

## 反冗余：不要写必然互相蕴含的条件

因为**所有命中的徽章都计分**（不像 family 那样取最高），写两条必然同时命中的规则 = 白送双倍分。

```ts
// ❌ 命中 #000000 必然同时命中这两条 → 双倍分
{ check: c => c.r === 0 && c.g === 0 && c.b === 0 }
{ check: c => c.hex === '#000000' }
```

判据和 `group` 一样：**存在包含关系就该合并，或者放进同一组**。

---

## 完成检查清单

跑之前先自查：

- [ ] `id` 全局唯一（`grep -rn "你的id" packages/shared/src/badges/`）
- [ ] `family` 与文件名一致
- [ ] `name` 在同家族内不重复
- [ ] `description` 写的是**条件**，不是效果或调侃（读者能据此手算）
- [ ] `check` 不抛异常，只用了 `color` 与 `helpers`
- [ ] 没有和已有徽章构成必然蕴含（或已经用 `group` 表达）
- [ ] 用了 `group` 的话，组内确实存在包含链

跑完看结果：

```bash
pnpm -C packages/shared run enumerate      # 约 3 分钟，重写 src/pricing.gen.ts
pnpm -C packages/shared run docs           # 重写 docs/BADGES.md
pnpm -C packages/shared run supersession   # 有没有徽章被 100% 取代（= 永远不加分）
pnpm -C packages/shared test               # 177 例
```

**要看的三个数**：

| 看哪 | 在哪看 | 判断 |
|---|---|---|
| 你的新徽章命中多少色 | `enumerate` 的输出 / `pricing.gen.ts` | 太小（个位数）要确认不是手滑写死；太大要确认不是恒真 |
| 有没有**完全没人命中**的徽章 | `supersession` 输出 | 0 条死徽章是目标 |
| 你的新徽章有没有被 100% 取代 | 同上 | 被 100% 取代 = 永远拿不到分，必须改判定条件 |

---

## 常见错误

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `徽章 "x" 缺少定价数据` | 加完没跑 `enumerate` | 跑第 2 步 |
| `docs/BADGES.md 与代码不一致` | 改了徽章没重跑 `docs` | 跑第 3 步 |
| 新徽章 CP 大得离谱 | 条件命中颜色极少（可能只命中 1–2 种） | 确认是有意为之；这没问题，只是要心里有数 |
| 新徽章 CP ≈ 0.01 | 条件恒真或几乎恒真 | 检查判定是不是写错了 |
| `supersession` 报出 100% 取代 | 你的条件是已有徽章的子集 | 改宽，或用 `group` 合并 |
| 图鉴里不显示 | 没重跑 `docs` 或没重启前端 dev | 前两步都做 |

---

## 不会影响已有玩家

**新增徽章不会改变任何人已经抽过的结果。**

当天首次抽取后结果就**冻结**了（`daily_results` 里存的是那一天的 `hex` / `cp` / `rarity` / `badgeIds`），
之后无论徽章表怎么变，那一天都不会重算。

所以：**新增徽章是安全的**，不需要迁移数据，也不会出现"昨天的记录变了"。

---

## 附：当前徽章分布

当前总数与各家族条数**以 [BADGES.md](BADGES.md) 为准**（自动生成，每次重跑 `enumerate` 会更新）。

这里刻意不写死数字：徽章会持续增补，写死的数量会在下次增补时无声过期——
而文档里的错误数字比没有数字更糟，因为有人会照它做判断。

稀有度分布（**由概率算出，非配额**）：`common 11 / uncommon 11 / rare 14 / epic 8 / anomaly 16 / mythic 16`
