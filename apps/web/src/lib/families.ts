/**
 * 徽章家族的展示元数据（图鉴分组标题用）。
 *
 * ── 为什么是静态映射，而不是运行时读源文件 ──────────────────────────────────
 *
 * 家族顺序与代表色的**唯一权威**是 `packages/shared/src/badges/*.ts` 每个文件
 * 第一行的 `// family: <name> — 代表色 #XXXXXX`（barrel `badges/index.ts` 的顺序
 * 也是照此固定的）。但 web 端不该在运行时去读这些源文件：
 *
 *   1. 浏览器里根本没有 `packages/shared/src/**`（构建后只有打包产物）；
 *   2. 字体/标题色属于**展示层**决定，让展示层在运行时反解源文件是把构建期契约
 *      泄漏成运行期依赖；
 *   3. 静态常量可被 Tailwind / 打包器静态分析，也不会让图鉴首屏多一次 IO。
 *
 * 代价是这份映射可能与源文件漂移。测试 `useBadges.test.ts` 用 `allBadges`
 * 交叉断言「每个 family 都出现且条数一致」，顺序则与 barrel 声明的固定顺序一致，
 * 一旦 shared 新增家族而这里漏了，测试立刻失败。
 */
import type { Family } from '@huedle/shared';

/** 家族中文名 + 代表色调（代表色取自各家族源文件首行的声明）。 */
export interface FamilyMeta {
  /** 中文展示名，如「灰阶」。 */
  label: string;
  /** 代表色 `#RRGGBB`，只用于分组标题的小色点。 */
  color: string;
}

/**
 * 固定家族顺序：gray, extreme, pure, channel, math, perception, pattern,
 * culture, lucky, casino —— 与 `packages/shared/src/badges/index.ts` 的
 * barrel 声明顺序（以及 docs/DESIGN.md 第 12.1 节）一致。
 */
export const FAMILY_ORDER: readonly Family[] = [
  'gray',
  'extreme',
  'pure',
  'channel',
  'math',
  'perception',
  'pattern',
  'culture',
  'lucky',
  'casino',
] as const;

/** 家族 → 中文名 + 代表色。 */
export const FAMILY_META: Record<Family, FamilyMeta> = {
  gray: { label: '灰阶', color: '#808080' },
  extreme: { label: '极端', color: '#FF0000' },
  pure: { label: '纯色', color: '#FF0000' },
  channel: { label: '通道', color: '#00FF00' },
  math: { label: '数学', color: '#010101' },
  perception: { label: '感知', color: '#FF6600' },
  pattern: { label: '模式', color: '#A5A5A5' },
  culture: { label: '文化', color: '#002FA7' },
  lucky: { label: '玄学', color: '#FFD700' },
  casino: { label: '牌型', color: '#C8102E' },
};
