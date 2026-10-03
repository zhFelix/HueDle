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

共 **76 条 / 10 个家族**：

| 家族 | 条数 |      | 家族 | 条数 |
|---|---:|---|---|---:|
| gray | 6 | | pattern | 8 |
| extreme | 6 | | culture | 8 |
| pure | 6 | | lucky | 6 |
| channel | 6 | | casino | 12 |
| math | 10 | | perception | 8 |

稀有度分布（**由概率算出，非配额**）：`common 11 / uncommon 11 / rare 14 / epic 8 / anomaly 16 / mythic 16`
