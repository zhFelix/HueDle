# 徽章取代审计：计分死徽章（supersession / dead badge）

> **本文件由 `pnpm -C packages/shared run supersession` 自动生成，请勿手改。**
>
> 目的：找出「在**所有**命中它的颜色上都会被同 group 更高 `ep` 成员取代」的徽章 ——
> 这种徽章永远拿不到分，存在只是图鉴摆设。
>
> 方法：全色域 `2²⁴` **单趟**精确遍历，只对有 `group` 的成员跑 `check`；
> 取代语义与 `src/scoring.ts` 的 `calculateScore` 一致（同组取 `ep` 最大，`ep` 相等不互相取代）。

## 0. 生成指纹

- 有 group 的成员：**11** 条，分布在 **2** 个组（`casino-rank-count`、`casino-sequence`）
- 全色域：16777216（2²⁴）
- 单趟遍历耗时：**49.33 s**
- 交叉校验（`hits` vs `PRICING[id].hits`）：**11 / 11 一致** ✅

## 1. 结论

- **100% 被取代的徽章：0 条** ✅ —— 不存在「计分死徽章」，每条 group 成员都至少在一部分命中颜色上单独计分。
- 被取代比例 > 99% 的成员：**0** 条 ✅
- 每个 group 的 ep 最大成员取代比例是否为 0：**全部为 0 ✅**
- 取代由包含关系解释（A ⊆ B 且 ep(A) > ep(B) ⇒ superseded(B) ≥ hits(A)）：**成立 ✅**
- 参考：若按「ep 越大 ratio 越小」这一**已被证伪**的期望衡量，有 **4** 处违反
  （group 允许是 DAG；该期望不是契约，断言已移除）。

  违反明细（ep 更大者反而有更高的被取代比例）：

  - casino-rank-count: casino-five-kind（ep=1152281，ratio=1.098901%）> casino-triple-pair（ep=33288，ratio=0.000000%）
  - casino-rank-count: casino-four-kind（ep=30253，ratio=2.625505%）> casino-full-house（ep=8082，ratio=1.734104%）
  - casino-rank-count: casino-three-kind（ep=1481，ratio=22.898780%）> casino-two-pair（ep=755，ratio=11.602806%）
  - casino-sequence: casino-straight-six（ep=211834，ratio=9.090909%）> casino-straight（ep=15432，ratio=7.284768%）

## 2. 逐组明细（组内按 `ep` 降序）

### `casino-rank-count`

| id | ep | hits | 被取代 | 被取代比例 | lostCp |
|---|---:|---:|---:|---:|---:|
| `casino-six-kind` | 104857600 | 16 | 0 | 0.000000% | 0 |
| `casino-five-kind` | 1152281 | 1456 | 16 | 1.098901% | 18,436,501 |
| `casino-triple-pair` | 33288 | 50400 | 0 | 0.000000% | 0 |
| `casino-four-kind` | 30253 | 55456 | 1456 | 2.625505% | 44,048,663 |
| `casino-full-house` | 8082 | 207600 | 3600 | 1.734104% | 29,093,438 |
| `casino-three-kind` | 1481 | 1133056 | 259456 | 22.898780% | 384,177,777 |
| `casino-two-pair` | 755 | 2223600 | 258000 | 11.602806% | 194,662,787 |
| `casino-pair` | 152 | 11011456 | 3149056 | 28.597998% | 479,794,795 |

### `casino-sequence`

| id | ep | hits | 被取代 | 被取代比例 | lostCp |
|---|---:|---:|---:|---:|---:|
| `casino-royal` | 2330169 | 720 | 0 | 0.000000% | 0 |
| `casino-straight-six` | 211834 | 7920 | 720 | 9.090909% | 152,520,145 |
| `casino-straight` | 15432 | 108720 | 7920 | 7.284768% | 122,218,130 |

## 3. 特别检查：`casino-pair`（`casino-rank-count` 最弱者）

- `casino-pair`：ep = 152，hits = 11,011,456，被取代 3,149,056，**比例 = 28.597998%**，lostCp = 479,794,795。
- 它未被取代的颜色有 **7,862,400** 个：这些颜色上 `casino-rank-count` 组里只有 `casino-pair` 一条命中（同组其它 7 条都是它的真子集）。
- ⚠️ 任务提示「分布底部有一个 176,788 色的大原子，只命中 `casino-pair` 一条」指的是**全表**
  （76 条徽章中只有 `casino-pair` 命中，故总分恰为最小）；那只是「组内仅 pair 命中」集合中
  额外不命中任何非组徽章的一小部分，**不是**取代比例的分母/补集，因此不能用它推出「接近 100% 被取代」。
- 数值对账：11,011,456 − 3,149,056 = 7,862,400（组内仅 pair 命中）；其中再剔除命中其它非组徽章的颜色后才是 176,788。
- 口径对照：若按「**全表**（不分 group）取最大 ep」这一错误口径统计，pair 的比例会是
  1 − 176,788 / 11,011,456 ≈ 98.39%，任务提示里的 176,788 正是这个口径的产物；
  但取代机制是 **group 内**的（见 `scoring.ts`），正确值是 28.597998% —— 两者相差很大，不能混用。

## 4. 可疑点

- ✅ **group 允许是偏序（DAG），不要求是一条包含链。** 判据不是 ep 排序，而是包含关系：
  本脚本断言「若 A ⊆ B 且 ep(A) > ep(B)，则 superseded(B) ≥ hits(A)」，实测**无违反**。
- ⚠️ **「同组内 ep 越大 ⇒ 取代比例越小」这条期望已被实测证伪，断言已移除。** 原因是
  `casino-rank-count` 不是包含链而是 DAG：它同时含「点数计数 ≥k」（pair→two-pair→triple-pair）
  与「同点数出现次数 ≥k」（three-kind→four-kind→five-kind→six-kind）两条独立分支，
  外加 `full-house` 交集节点。分支之间不可比（`casino-triple-pair` 与 `casino-three-kind` 互不包含），
  因此 `triple-pair` 的 ep 虽低于 `four-kind`，取代比例却是 0%。`casino-sequence` 同理（`straight` ⊃ `straight-six`）。
- 结论：**无需拆组。** DAG 形态下「同组取最高 ep」依然正确，且已由上面的包含关系断言守住；
  没有任何成员被 100% 取代。

## 5. 复现

| 项目 | 值 |
|---|---|
| 命令 | `pnpm -C packages/shared run supersession` |
| 单趟遍历耗时 | 49.33 s |
| 颜色空间 | 16777216（2²⁴，全枚举，非采样） |
