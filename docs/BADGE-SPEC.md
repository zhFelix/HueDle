# HueDle 徽章作者规范 v1（冻结契约）

> 本文件是并行开发时的**唯一接口契约**。所有徽章作者必须严格按此实现，
> 不得自行改动类型、路径、导出名或 CP 区间。

> ## ⚠️ v3 变更（**当前生效，优先于下文**）
>
> 项目已迁移到**概率定价**，见 [PRICING-SPEC.md](./PRICING-SPEC.md)。与下文冲突时**以 PRICING-SPEC 为准**：
>
> | 下文章节 | 状态 |
> |---|---|
> | §3 类型定义中的 `cp` / `rarity` 字段 | ❌ **已移除**。作者改写 `BadgeDef`（无这两个字段），`cp`/`rarity` 由枚举数据注入 |
> | §3「CP 校准表」（common 5–15 … mythic 500–800） | ❌ **作废**，见 PRICING-SPEC 第 2/3 节 |
> | §9 家族配额表（mythic/anomaly/epic 名额） | ❌ **作废**。配额约束已从 `registry.test.ts` 删除 |
> | §6 反冗余规范 | ✅ 仍有效（回归检查见 §11 `group`） |
> | §7 测试要求、§8 交付物格式 | ✅ 仍有效 |
> | §11 `group` 取代字段 | ✅ 仍有效，且是唯一的「取最高」机制 |
> | §12 casino 家族 | ✅ 仍有效（但该家族的 `mythic 0 条` 等配额要求已作废） |
>
> **对作者最重要的一条**：你现在**不能**挑一条徽章的稀有度或分值。
> 你只写判定规则，稀有度由它的实测概率决定。想让它更稀有，就写更窄的规则——
> 而不是「给它标个 mythic」。

---

## 0. 本阶段的边界

- **只做第一版徽章表**，不计算稀有度阈值、不跑 2^24 枚举、不调参。
- CP 值按第 3 节的校准表**设计性给定**，后续会用实测分布统一回调。
- 徽章表预期会继续扩充，所以结构必须可增量添加。

---

## 1. 计分模型（已变更）

| 项 | 规则 |
|---|---|
| 命中徽章 | **全部计分**，不再按 family 取最高 |
| `family` | **仅用于图鉴分类/筛选**，不参与计分 |
| 总 CP | `sum(所有命中徽章的 cp)` |
| 稀有度 | 由总 CP 查阈值表（阈值待实测反推，本阶段不定稿） |

**作者推论**：因为叠加计分，单条徽章的 CP 必须克制；高分应当来自「多条同时命中」，
而不是「单条爆分」。因此**禁止**写出必然互相蕴含的条件（见第 6 节）。

---

## 2. 目录与文件契约（路径已冻结）

```
packages/shared/
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
└─ src/
   ├─ types.ts                    # 类型定义（由脚手架作者写）
   ├─ color.ts                    # toColorInfo / rgbToHsl（由脚手架作者写）
   ├─ scoring.ts                  # 后续阶段，本阶段不写
   └─ badges/
      ├─ helpers.ts               # 判定辅助函数（由脚手架作者写）
      ├─ index.ts                 # 汇总 barrel（由脚手架作者写）
      ├─ gray.ts                  # 灰阶家族
      ├─ extreme.ts               # 极端家族
      ├─ pure.ts                  # 纯色家族
      ├─ channel.ts               # 通道家族
      ├─ math.ts                  # 数学家族
      ├─ perception.ts            # 感知家族
      ├─ pattern.ts               # 模式家族
      ├─ culture.ts               # 文化家族
      ├─ lucky.ts                 # 玄学家族
      └─ __tests__/
         ├─ <family>.test.ts      # 每个家族一个测试文件
         └─ registry.test.ts      # 全局结构校验（由脚手架作者写）
```

**导出命名约定**：文件 `<family>.ts` 必须导出

```ts
export const <family>Badges: Badge[] = [ /* ... */ ];
```

例：`gray.ts` → `export const grayBadges: Badge[]`。
barrel 顺序固定为：gray, extreme, pure, channel, math, perception, pattern, culture, lucky。

---

## 3. 类型定义（已冻结，见 `src/types.ts`）

```ts
export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }   // h∈[0,360) s,l∈[0,100]
export interface ColorInfo extends RGB { hex: string; hsl: HSL }  // hex 形如 "#002FA7"（大写带#）

export type BadgeRarity =
  | 'common' | 'uncommon' | 'rare' | 'epic' | 'anomaly' | 'mythic';

export type Family =
  | 'gray' | 'extreme' | 'pure' | 'channel' | 'math'
  | 'perception' | 'pattern' | 'culture' | 'lucky';

export interface Badge {
  id: string;                 // kebab-case 英文，全局唯一
  name: string;               // 中文展示名
  description: string;        // 中文，必须是可判定的条件式
  rarity: BadgeRarity;
  cp: number;
  family: Family;
  check: (color: ColorInfo) => boolean;
}
```

> `ScoreRarity`（总分稀有度）与 `BadgeRarity` 共用同一组字面量，但**阈值表各自独立**。
> 本阶段只产出 `BadgeRarity`，`ScoreRarity` 的 `getRarity()` 留给后续阶段。

### CP 校准表（按 `rarity` 取值，同 rarity 内要有区分度）

| rarity | 单徽章 CP 区间 | 说明 |
|---|---|---|
| common | 5–15 | 基础特征 |
| uncommon | 20–40 | 命中 2–3 条的量级 |
| rare | 50–100 | 明显特殊 |
| epic | 120–200 | 强特征 |
| anomaly | 250–400 | 极窄条件 |
| mythic | 500–800 | 唯一/精确色 |

### 全局配额（防止叠加后人人神话）

- `mythic`：全项目 **≤ 4 条**，且名额已预分配：`culture` 1、`math` 1、`extreme` 1、`pattern` 1。其余家族 **不得**出现 mythic。
- `anomaly`：全项目 **≤ 6 条**，预分配：`gray` 1、`pure` 1、`channel` 1、`perception` 1、`lucky` 1，余 1 条自由。
- `epic`：**每个家族 ≤ 2 条**。

---

## 4. 可用判定 API（已冻结，见 `src/badges/helpers.ts` 与 `src/color.ts`）

作者**只能**使用下列函数与 `ColorInfo` 自带字段。**不得**自行新增 helper（如确需新增，在自己家族文件内以
模块私有函数实现，并加 `// private` 注释）。

```ts
// ---- src/badges/helpers.ts ----
export function isPowerOfTwo(n: number): boolean;   // 0 → false；1 → true；2 → true
export function isPrime(n: number): boolean;        // 0,1 → false；2 → true；负数 → false
export function isPerfectSquare(n: number): boolean;// 0 → true
export function isFibonacci(n: number): boolean;    // 0,1,2,3,5,8 → true
export function digitSum(n: number): number;        // 255 → 12
export function isPalindromeNumber(n: number): boolean; // 121 → true；0..9 → true
export function gcd(a: number, b: number): number;
export function lcm(a: number, b: number): number;
export function maxChannel(c: RGB): number;
export function minChannel(c: RGB): number;
export function channelSum(c: RGB): number;
export function distinctChannelCount(c: RGB): number;  // 888 → 1；808 → 2；123 → 3
export function isGray(c: RGB): boolean;               // r===g && g===b
export function hexBytes(hex: string): [string, string, string]; // "#002FA7" → ["00","2F","A7"]
export function toHexByte(n: number): string;          // 0 → "00"；255 → "FF"（大写）

// ---- src/color.ts ----
export function rgbToHsl(rgb: RGB): HSL;               // h 归一到 [0,360)，s/l ∈ [0,100]
export function toColorInfo(rgb: RGB): ColorInfo;
```

> `ColorInfo` 同时带 `r/g/b`（0–255 整数）、`hex`（大写、带 `#`、7 字符）、`hsl`。

---

## 5. 徽章字段规范

### `id`
- kebab-case 纯英文小写，全局唯一；
- 建议带家族语义前缀，避免撞名，例如 `gray-true-monochrome`、`math-binary-beauty`。

### `name`
- 中文，2–6 字优先，有辨识度与"收藏感"；
- 同一 family 内不得重名。

### `description`
- **必须是可判定的条件式**，读者能据此手算出是否命中；
- 用 `R/G/B` 指代通道，`HEX` 指代十六进制；
- ✅ 好例子：`R = G = B`、`G = 0 且 B = 0，R > 0`、`R、G、B 均为 2 的幂`
- ❌ 坏例子：`很暗的颜色`、`接近灰色`、`好看的蓝`

### `check`
硬性约束：

1. **纯函数**：不读外部变量、不写状态、不依赖时间/随机/网络；
2. 只用 `color` 参数与第 4 节 API；
3. **禁止正则与 hex 模糊匹配**（唯一例外：文化家族的精确色值比较，如 `hex === '#002FA7'`）；
4. 不得抛异常（含除零、越界）；
5. 必须真正对应 `description`，不得实现得比描述更宽或更窄。

### 展示用色
每个家族文件顶部加一行注释，记录该家族的代表色，供图鉴页取色：

```ts
// family: gray — 代表色 #808080
```

---

## 6. 反冗余规范（重要，因为叠加计分）

同一家族内（跨家族也建议遵守）：

1. **禁止蕴含式重复**：不得出现 A 成立时 B 必然成立的对子。
   - ❌ `R = G = B` 与 `R = G = B 且 R < 255`
   - ❌ `R = G = B` 与 `R = G`
   - ❌ `R > G > B` 与 `R > G`
2. **禁止"凑数尾巴"**：不得在已有条件后加一个几乎恒真的附加项来制造新徽章。
3. **允许的部分重叠必须写明理由**：在家族文档的备注里说明两条徽章为何不构成蕴含。
4. 同家族内的条件应当**覆盖不同的判定维度**，而不是同一维度的更细切分。

> 判定标准：对颜色空间随机采样时，两条徽章的命中集合重合度应显著低于 100%；
> 若一条的命中集合是另一条的子集，即视为违反。

---

## 7. 测试要求

每个家族文件必须配一个 `__tests__/<family>.test.ts`（Vitest），内容要求：

1. **逐条徽章的 hit 用例**：至少 1 个明确应命中的 `ColorInfo`；
2. **逐条徽章的 miss 用例**：至少 1 个明确不应命中的 `ColorInfo`；
3. 断言用 `toColorInfo({ r, g, b })` 构造，**不要手写 ColorInfo 字面量**；
4. 用 `badges.find(b => b.id === 'xxx')!` 取徽章，`expect(badge.check(c)).toBe(true / false)`；
5. 测试按 `describe('<family> 家族')` 分组，`it` 标题用徽章中文名。

示例骨架：

```ts
import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { grayBadges } from '../gray';

const hit = (r: number, g: number, b: number) => {
  const badge = grayBadges.find(b => b.id === 'gray-true-monochrome')!;
  expect(badge.check(toColorInfo({ r, g, b }))).toBe(true);
};

describe('gray 家族', () => {
  it('灰阶行者：R=G=B 命中', () => {
    hit(0x12, 0x12, 0x12);
    hit(255, 255, 255);
  });
});
```

> 每个家族文件应保证**至少有 6 条徽章**，并确保测试真的会失败（不要写恒真断言）。

---

## 8. 交付物清单（每个家族作者）

1. `packages/shared/src/badges/<family>.ts` — 徽章实现
2. `packages/shared/src/badges/__tests__/<family>.test.ts` — Vitest 用例
3. `docs/badges/<family>.md` — 家族文档，格式见下

### 家族文档格式

```md
# <family> 家族

代表色：`#808080`
家族定位：一句话说明这个家族在玩什么。

| id | 名称 | 条件 | 稀有度 | CP |
|---|---|---|---|---|
| gray-true-monochrome | 灰阶行者 | R = G = B | common | 10 |

## 备注
- 反冗余说明（若存在允许的重叠，写清为何不构成蕴含）
```

---

## 9. 家族配额总表

| family | 中文 | 目标条数 | mythic 名额 | anomaly 名额 | epic 上限 |
|---|---|---|---|---|---|
| gray | 灰阶 | 6 | 0 | 1 | 2 |
| extreme | 极端 | 6 | 1 | 0 | 2 |
| pure | 纯色 | 6 | 0 | 1 | 2 |
| channel | 通道 | 6 | 0 | 1 | 2 |
| math | 数学 | 10 | 1 | 0 | 2 |
| perception | 感知 | 8 | 0 | 1 | 2 |
| pattern | 模式 | 8 | 1 | 0 | 2 |
| culture | 文化 | 8 | 1 | 0 | 2 |
| lucky | 玄学 | 6 | 0 | 1 | 2 |
| **合计** | | **64** | **4** | **6** | |

---

## 10. 本阶段禁止事项

- ❌ 跑 2^24 枚举或反推稀有度阈值
- ❌ 修改 `types.ts` / `helpers.ts` / `color.ts` 的既有签名（如需扩展，先报告给集成者）
- ❌ 跨家族写文件（只碰自己负责的 3 个交付物）
- ❌ 引入新的 npm 依赖

---

# v2 增补（`group` 取代字段 + casino 家族）

> 背景：参见 [research/RNGDLE-NOTES.md](./research/RNGDLE-NOTES.md) 第 5 节。
> RNGdle 用 family 做「包含关系取最高」；HueDle 的 `family` 已改为纯展示分类，
> 因此新增一个**与之正交**的 `group` 字段承担取代职责。

## 11. `group` 字段（取代 / supersession）

```ts
export interface Badge {
  // ...既有字段不变
  family: Family;    // 展示分类，不参与计分
  group?: string;    // 【新增】取代组，可选
  check: (color: ColorInfo) => boolean;
}
```

### 语义

计分时：**同一 `group` 只取 CP 最高的那一条**，其余仍算「已获得」但不计分
（`ScoreResult.supersededBadges`）。无 `group` 的徽章全部计分。

### 什么时候才该用 group（严格）

**只在成员之间存在「命中集合包含」或「高度重叠」时使用** —— 即同一条判定规则的
不同强度 / 阈值档位。典型形状：

| 形状 | 例 |
|---|---|
| 阶梯型（contains → exact） | `casino-has-pair` / `casino-two-pair` / `casino-three-kind` / `casino-four-kind` / `casino-five-kind` |
| 档位型（同维度按阈值切档） | 同一指标的多档阈值 |

### 什么时候**不**该用 group

- **只是主题相关** → 那是 `family` 的职责。把主题相关的徽章放进同一 group 会**静默吞掉玩家得分**。
- **两个不同特征恰好相关**（例如 `pure-only-red` 天然蕴含 `pattern-echo`）→ **不要**同组。
  它们表达的是不同维度；玩家应该同时拿到两笔分。允许它们共存，重叠是正常的。

### 自动校验（registry 测试第 8/9 条）

- `group` 必须非空且 kebab-case；
- 每个 group **至少 2 名成员**（单成员分组无意义）；
- 每个 group 的成员在大规模采样上**必须真的被同时命中过**——
  成员互斥的分组会被测试直接判失败。

> 也就是说：**不要去凑 group。** 现有 64 条里若没有真正同规则不同强度的组合，
> 就一条都不加，这是正确答案，不是偷懒。

### 命名

`<family>-<dimension>`，如 `gray-neutrality`、`casino-rank-count`。
命名空间全局，允许跨 family 同组。

---

## 12. casino 家族（新增，第 10 个家族）

| 项 | 值 |
|---|---|
| family | `casino` |
| 代表色 | `#C8102E` |
| 条数 | **12** |
| mythic 配额 | **0**（全局 4 个名额已被 extreme/math/pattern/culture 占满） |
| anomaly 配额 | **≤ 1**（全局已用 5/6） |
| epic 上限 | 2 |

### 设计依据

把 `ColorInfo.hex` 的 **6 个十六进制字符**当作 6 张牌，点数为 `0–F`（共 16 种），
按**字符出现次数**判扑克牌型。这是 RNGdle Casino 套装的思路在颜色上的对应物。

`pattern` 家族走的是「位置 / 相邻」维度（echo、half-loop、mirror-bytes），
`casino` 走的是「计数 / 组合」维度，两者交叉但不应包含。

### 必须用 group 表达包含链

牌型天然嵌套（五条 ⊂ 四条 ⊂ 三条 ⊂ 至少一对），
**这正是 group 存在的理由**——请把同一条链上的牌型写成「至少型」条件并归入同一 group，
由引擎取最高分，而不是把条件掰成互斥的「恰好型」。

预期至少两条链：
- `casino-rank-count`：至少一对 / 两对 / 三条 / 葫芦 / 四条 / 五条 / 六条
- `casino-sequence`：顺子（连续 5 个不同点数）/ 长顺（连续 6 个）/ 皇家（最高顺）

其余名额可用于「同花」（6 字符全部落在 `0-7` 或全部落在 `8-F` 这两个「花色」之一）、
「散牌」（6 字符两两不同——**注意这会与 `pattern-all-distinct` 条件接近，请核实是否逐字等价，
若等价则不要重复定义**）等。

### 禁止事项（本次踩过的坑）

- ❌ 不要再定义一条与既有徽章**条件逐字等价**的规则（此前 `pattern-ascending` 与
  `channel-ascending` 撞车，只能整条删除）。
- ❌ 不要用「三通道全相等 = 三条」——`gray-true-monochrome` 已经是 `R = G = B`，
  这是逐字等价。请用**字符计数**维度区分。
- ❌ 不要定义「六字符全为 0-9 或全为 A-F」之外没有实际区分度的凑数规则。

### 交付物（与既有家族相同）

1. `packages/shared/src/badges/casino.ts` → `export const casinoBadges: Badge[]`
2. `packages/shared/src/badges/__tests__/casino.test.ts`
3. `docs/badges/casino.md`

---

## 13. v2 家族配额总表（更新）

| family | 中文 | 条数 | mythic | anomaly | epic 上限 |
|---|---|---|---|---|---|
| gray | 灰阶 | 6 | 0 | 1 | 2 |
| extreme | 极端 | 6 | 1 | 0 | 2 |
| pure | 纯色 | 6 | 0 | 1 | 2 |
| channel | 通道 | 6 | 0 | 1 | 2 |
| math | 数学 | 10 | 1 | 0 | 2 |
| perception | 感知 | 8 | 0 | 1 | 2 |
| pattern | 模式 | 8 | 1 | 0 | 2 |
| culture | 文化 | 8 | 1 | 0 | 2 |
| lucky | 玄学 | 6 | 0 | 1 | 2 |
| **casino** | **牌型** | **12** | **0** | **≤1** | **2** |
| **合计** | | **76** | **4** | **≤6** | |
