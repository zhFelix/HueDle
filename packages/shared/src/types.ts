/**
 * HueDle 共享类型契约（见 docs/BADGE-SPEC.md 第 3 节，已冻结）。
 * 签名不得改动；如需扩展，先报告给集成者并同步规范。
 */

/** 24 位真彩色，三通道取值均为 0–255 的整数。 */
export interface RGB {
  /** 红色通道，0–255。 */
  r: number;
  /** 绿色通道，0–255。 */
  g: number;
  /** 蓝色通道，0–255。 */
  b: number;
}

/** HSL 表示：h 归一到 [0,360)，s 与 l 均在 [0,100]。 */
export interface HSL {
  /** 色相，单位度，归一化到 [0,360)。 */
  h: number;
  /** 饱和度，0–100。 */
  s: number;
  /** 亮度，0–100。 */
  l: number;
}

/** 颜色完整信息：RGB 原值 + 大写带 # 的 hex（7 字符）+ HSL。 */
export interface ColorInfo extends RGB {
  /** 形如 "#002FA7" 的十六进制串，大写、带 #、恒为 7 字符。 */
  hex: string;
  /** 由 rgbToHsl 计算得到的 HSL。 */
  hsl: HSL;
}

/** 单条徽章的稀有度档位，由该徽章的 EP 导出（见 docs/PRICING-SPEC.md 第 3 节）。 */
export type BadgeRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'anomaly'
  | 'mythic';

/**
 * 一次抽取的稀有度档位，由总分的**百分位**导出（见 docs/PRICING-SPEC.md 第 4 节）。
 *
 * 与 {@link BadgeRarity} 是**两套独立的东西**：阈值互不相干，且多一个最低档 `trash`。
 * 不要混用。
 */
export type ScoreRarity = 'trash' | BadgeRarity;

/** 徽章家族，仅用于图鉴分类与筛选，不参与计分。 */
export type Family =
  | 'gray'
  | 'extreme'
  | 'pure'
  | 'channel'
  | 'math'
  | 'perception'
  | 'pattern'
  | 'culture'
  | 'lucky'
  | 'casino';

/**
 * 徽章定义（**作者手写**的部分）。
 *
 * 注意这里**没有** `cp` / `rarity`：它们是推导值，由全色域枚举出的概率决定，
 * 见 docs/PRICING-SPEC.md 第 5 节。作者只能写规则，不能挑分值。
 */
export interface BadgeDef {
  /** kebab-case 纯英文小写 id，全局唯一，建议带家族前缀。 */
  id: string;
  /** 中文展示名，2–6 字优先，同家族内不得重名。 */
  name: string;
  /** 中文可判定条件式描述，读者能据此手算出是否命中。 */
  description: string;
  /** 所属家族，仅用于图鉴分类与筛选。 */
  family: Family;
  /**
   * 取代组（supersession group），可选。
   *
   * 同一 group 的徽章在计分时**只取 CP 最高的一条**，其余仍算「已获得」但不计分
   * （标记为 superseded）。语义上等价于 RNGdle 的 family 机制。
   *
   * 使用条件（严格）：group 只在成员之间存在**命中集合包含或高度重叠**时使用，
   * 即「同一条判定规则的不同强度 / 阈值档位」。典型形状：
   *   - 阶梯型：`X` / `X-EXACT` / `X-FOUR` / `X-FIVE`
   *   - 档位型：同一维度按阈值切成的多档
   *
   * **不要**因为它和 family 名字像就拿来当分类用——主题分类是 family 的职责，
   * 把主题相关的徽章放进同一 group 会静默吞掉玩家的得分。
   *
   * 命名建议 `<family>-<dimension>`，如 `gray-neutrality`、`casino-pairs`；
   * 命名空间为全局，允许跨 family 同组。
   */
  group?: string;
  /** 纯函数判定：只用 color 参数与规范第 4 节 API，不得抛异常。 */
  check: (color: ColorInfo) => boolean;
}

/**
 * 完整徽章 = 作者写的 {@link BadgeDef} + 由概率导出的定价。
 *
 * 由 `badges/index.ts` 的 barrel 合成，**不要手写 `cp`/`rarity`**。
 */
export interface Badge extends BadgeDef {
  /** 期望点数 `ep = 100 / p`，由 `hits` 导出。见 docs/PRICING-SPEC.md 第 2 节。 */
  cp: number;
  /** 由 `cp` 按十进制分档导出的徽章稀有度。 */
  rarity: BadgeRarity;
}
