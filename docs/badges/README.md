# 徽章文档索引

本目录有两类文档，职责严格分开，**不要混淆**：

- **总表 [`../BADGES.md`](../BADGES.md) —— 自动生成，唯一权威的数值来源。**
  内容：全部徽章的总表——徽章总量看板、按 family 的明细表、按 rarity 的分布、取代组（supersession）清单。
  ❌ **不要手改**。
- **家族说明 `badges/<family>.md`（本目录 10 个）—— 人工维护。**
  内容：单个家族的设计意图、反冗余论证、有意排除项与候选记录、group 包含链说明。
  ✅ **手改这里**；但**不放任何数值表**，也不重复徽章清单——总表回答「有哪些徽章、条件是什么」，
  这里只回答「为什么是这组条件、为什么不是另一组」。

## 总表 `docs/BADGES.md`

- 唯一事实来源是代码：`packages/shared/src/badges/index.ts` 的 `allBadges`；
- 总表由 `packages/shared/src/badges/renderDoc.ts` 渲染，由
  `packages/shared/src/badges/__tests__/docs.test.ts` 做**逐字节一致性校验**；
- 总表顶部的「取代组」一节列出每个 `group` 的成员（按 CP 排序），
  并说明计分时只取最高分；
- 每个家族一节含 `id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group` 全列，
  页首还有「按 family 分布」「按 rarity 分布」两个看板。

## CP 与稀有度的来源

- `CP` 与 `稀有度`**不是作者手填**，而是由 **2²⁴ 全色域枚举**出的概率推导：
  枚举得到每枚徽章的命中数，概率 `p = 命中数 / 2²⁴`，期望分 `ep = 100 / p`；
- 全色域枚举由 `pnpm -C packages/shared run enumerate` 执行，结果写入
  `packages/shared/src/pricing.gen.ts`；
- `rarity` 不再由作者挑选，而是 `ep` 的十进制分档导出值；旧的「每家族 mythic ≤ N / epic ≤ M」
  配额约束已随概率定价模型**废除**（理由见 [`../PRICING-SPEC.md`](../PRICING-SPEC.md)）；
- 因此**任何家族文档都不得手写 CP / 稀有度数值**（包括表格与散文中的数字）：
  它们会随枚举结果漂移，唯一权威来源始终是自动生成的总表 `docs/BADGES.md`。

## 家族说明 `docs/badges/<family>.md`

- 这些文件是**人工维护**的设计文档：家族定位、代表色、反冗余论证、故意排除的候选、
  判定条件的取舍理由、group 包含链说明、跨家族重叠说明；
- **不放数值表**：徽章清单、条件、命中数、概率、CP、稀有度一律看总表，
  这里只写总表回答不了的「为什么不是另一组条件」；
- 修改徽章代码时，**两份都要动**：家族说明手改散文，总表跑脚本重生成。

## 改了徽章代码之后

```bash
pnpm -C packages/shared run enumerate   # 判定条件变了先重算概率与 CP，生成 src/pricing.gen.ts
pnpm -C packages/shared run docs        # 重新生成 docs/BADGES.md
```

`run docs` 等价于 `UPDATE_DOCS=1 vitest run src/badges/__tests__/docs.test.ts`。
随后请跑一次校验：

```bash
pnpm -C packages/shared exec vitest run src/badges/__tests__/docs.test.ts
```

CI / 本地全量测试（`pnpm -C packages/shared test`）也会在总表漂移时直接失败，
错误信息里会给出上面这条修复命令。

## 家族清单

- gray（灰阶）：[`gray.md`](./gray.md)
- extreme（极端）：[`extreme.md`](./extreme.md)
- pure（纯色）：[`pure.md`](./pure.md)
- channel（通道）：[`channel.md`](./channel.md)
- math（数学）：[`math.md`](./math.md)
- perception（感知）：[`perception.md`](./perception.md)
- pattern（模式）：[`pattern.md`](./pattern.md)
- culture（文化）：[`culture.md`](./culture.md)
- lucky（玄学）：[`lucky.md`](./lucky.md)
- casino（牌型）：[`casino.md`](./casino.md)
