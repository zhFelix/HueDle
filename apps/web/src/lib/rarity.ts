/**
 * 稀有度的视觉映射（基调见 docs/DESIGN.md 第 12 节）。
 *
 * `ScoreRarity` 是 **7 档**（比 `BadgeRarity` 多一个最低档 `trash`），不要漏。
 * 这里写的是**完整 Tailwind 类名**而非拼接字符串——Tailwind v4 靠静态扫描
 * 提取类名，拼接出来的 `bg-${x}` 不会被生成。类名字符串放在 .ts 里同样会被扫到。
 *
 * 全部效果只用手写 Tailwind 工具类，**不引入任何动画库**：
 * `anomaly` 用内置 `animate-pulse`，`mythic` 用渐变。
 */
import type { BadgeRarity, ScoreRarity } from '@huedle/shared';

export interface RarityStyle {
  /** 中文档位名。 */
  label: string;
  /** 徽章胶囊样式。 */
  badge: string;
  /** 色块 / 图例的纯色或渐变样式。 */
  swatch: string;
  /**
   * 该档位的**代表色**（大写带 # 的 7 字符 hex）。
   *
   * Tailwind 类名只活在 DOM 里，Canvas 分享卡片拿不到，所以这里给一份纯色值，
   * 与 `swatch` 的取色一一对应（`mythic` 取渐变起点 fuchsia-500）。
   * 分享卡片一律从这里读，**不得另起一套映射**。
   */
  accent: string;
}

export const RARITY_STYLES: Record<ScoreRarity, RarityStyle> = {
  trash: {
    label: '废料',
    badge: 'border border-neutral-700 bg-neutral-800 text-neutral-400',
    swatch: 'bg-neutral-800',
    accent: '#262626',
  },
  common: {
    label: '普通',
    badge: 'border border-neutral-500/40 bg-neutral-600/20 text-neutral-300',
    swatch: 'bg-neutral-500',
    accent: '#737373',
  },
  uncommon: {
    label: '罕见',
    badge: 'border border-blue-500/40 bg-blue-500/15 text-blue-300',
    swatch: 'bg-blue-500',
    accent: '#3B82F6',
  },
  rare: {
    label: '稀有',
    badge: 'border border-purple-500/50 bg-purple-500/15 text-purple-300',
    swatch: 'bg-purple-500',
    accent: '#A855F7',
  },
  epic: {
    label: '史诗',
    badge: 'border border-amber-400/50 bg-amber-400/15 text-amber-300',
    swatch: 'bg-amber-400',
    accent: '#FBBF24',
  },
  anomaly: {
    label: '异常',
    badge: 'border border-red-500/60 bg-red-600/20 text-red-300 animate-pulse',
    swatch: 'bg-red-600',
    accent: '#DC2626',
  },
  mythic: {
    label: '神话',
    badge: 'border border-transparent bg-gradient-to-r from-fuchsia-500 via-amber-400 to-cyan-400 text-neutral-900',
    swatch: 'bg-gradient-to-r from-fuchsia-500 via-amber-400 to-cyan-400',
    accent: '#D946EF',
  },
};

/** 未知档位（理论上不可达）时退到 `common`，避免运行时 undefined 渲染。 */
export function rarityStyle(rarity: ScoreRarity | BadgeRarity): RarityStyle {
  return RARITY_STYLES[rarity as ScoreRarity] ?? RARITY_STYLES.common;
}

/** 按稀有度从低到高，供图例 / 图鉴排序使用。 */
export const RARITY_ORDER: readonly ScoreRarity[] = [
  'trash',
  'common',
  'uncommon',
  'rare',
  'epic',
  'anomaly',
  'mythic',
] as const;
