/**
 * `docs/BADGES.md` 渲染器（代码 → 文档 的唯一出口）。
 *
 * 设计约束：
 * - `allBadges`（`./index`）是徽章的唯一事实来源，本文件只负责把它渲染成 Markdown；
 * - `renderBadgesDoc` 是纯函数：同一输入必然得到同一输出；
 * - 输出**确定性**：固定家族/稀有度顺序、不写时间戳、不含随机数，
 *   否则 `__tests__/docs.test.ts` 的逐字节比较会永远失败；
 * - 家族代表色从各家族源文件顶部的 `// family: <name> — 代表色 #XXXXXX`
 *   注释里解析，解析不到时留空而不是报错。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Badge, BadgeRarity, Family } from '../types';
import { allBadges } from './index';
import { PRICING } from '../pricing.gen';
import { TOTAL_COLORS } from '../pricing';

/** 千位分隔的整数（EP 可达 10⁹，不分组读不出来）。 */
function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Math.round(n);
  return rounded.toLocaleString('en-US');
}

/** 命中概率：≥0.1% 用百分比，更小的用科学计数法（最小可到 6×10⁻⁸）。 */
function fmtProb(hits: number): string {
  const p = hits / TOTAL_COLORS;
  if (p >= 0.001) return `${(p * 100).toFixed(2)}%`;
  return p.toExponential(2);
}

/** 固定家族顺序（与 `badges/index.ts` 的 barrel 顺序一致，见 BADGE-SPEC 第 13 节）。 */
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
];

/** 家族中文名（见 docs/DESIGN.md 第 12.1 节 / BADGE-SPEC 第 13 节）。 */
export const FAMILY_LABEL: Readonly<Record<Family, string>> = {
  gray: '灰阶',
  extreme: '极端',
  pure: '纯色',
  channel: '通道',
  math: '数学',
  perception: '感知',
  pattern: '模式',
  culture: '文化',
  lucky: '玄学',
  casino: '牌型',
};

/** 固定稀有度顺序：由低到高。 */
export const RARITY_ORDER: readonly BadgeRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'anomaly',
  'mythic',
];

/** 家族源文件所在目录（`packages/shared/src/badges`）。 */
const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));

/** 匹配家族源文件顶部的 `// family: <name> — 代表色 #XXXXXX` 契约注释。 */
const FAMILY_ACCENT_RE = /^\/\/ family:\s*[a-z]+\s*—\s*代表色\s*(#[0-9A-Fa-f]{6})\s*$/m;

/** 从家族源文件解析代表色；文件缺失或注释缺失时返回空串。 */
function readFamilyAccent(family: Family): string {
  try {
    const source = readFileSync(join(SOURCE_DIR, `${family}.ts`), 'utf8');
    const matched = FAMILY_ACCENT_RE.exec(source);
    return matched ? matched[1].toUpperCase() : '';
  } catch {
    return '';
  }
}

/** Markdown 表格单元格转义：反斜杠、竖线与换行。 */
function cell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

/** 按固定顺序返回出现过的 key，未知 key 追加在末尾（保证确定性）。 */
function orderedKeys<K extends string>(known: readonly K[], present: Iterable<K>): K[] {
  const set = new Set(present);
  const extras = [...set].filter((k) => !known.includes(k)).sort();
  return [...known.filter((k) => set.has(k)), ...extras];
}

/**
 * 把 `allBadges` 渲染成 `docs/BADGES.md` 的完整 Markdown 文本。
 * 纯函数：输出只由 `badges` 与磁盘上的家族源文件注释决定，与调用时间无关。
 */
export function renderBadgesDoc(badges: Badge[] = allBadges): string {
  const byFamily = new Map<Family, Badge[]>();
  for (const badge of badges) {
    const list = byFamily.get(badge.family);
    if (list) list.push(badge);
    else byFamily.set(badge.family, [badge]);
  }

  const byRarity = new Map<BadgeRarity, number>();
  for (const badge of badges) {
    byRarity.set(badge.rarity, (byRarity.get(badge.rarity) ?? 0) + 1);
  }

  const groups = new Map<string, Badge[]>();
  for (const badge of badges) {
    if (badge.group === undefined) continue;
    const list = groups.get(badge.group);
    if (list) list.push(badge);
    else groups.set(badge.group, [badge]);
  }
  const groupNames = [...groups.keys()].sort();
  const supersededCount = groupNames.reduce((sum, name) => sum + groups.get(name)!.length - 1, 0);
  const groupedBadgeCount = groupNames.reduce((sum, name) => sum + groups.get(name)!.length, 0);

  const familyKeys = orderedKeys(FAMILY_ORDER, byFamily.keys());
  const rarityKeys = orderedKeys(RARITY_ORDER, byRarity.keys());

  const out: string[] = [];

  out.push('# HueDle 徽章总表');
  out.push('');
  out.push(
    '本表由 `allBadges`（`packages/shared/src/badges/index.ts`）渲染生成，'
      + '是徽章配额、判定条件与取代关系的只读快照。',
  );
  out.push('');
  out.push('> ⚠️ **本文件由脚本生成，请勿手改。** 修改徽章代码后请运行 '
    + '`pnpm -C packages/shared run docs` 重新生成。');
  out.push('');
  out.push('## 配额看板');
  out.push('');
  out.push(`- 徽章总数：**${badges.length}**`);
  out.push(`- 家族数：**${familyKeys.length}**`);
  out.push(`- 取代组（group）：**${groupNames.length}** 组，覆盖 **${groupedBadgeCount}** 条徽章`);
  out.push(
    `- 被取代关系数：**${supersededCount}**`
      + '（同组内除 CP 最高者外，计分时会被吞掉的成员数）',
  );
  out.push('');
  out.push('### 按 family 分布');
  out.push('');
  out.push('| family | 中文 | 条数 | 代表色 |');
  out.push('|---|---|---:|---|');
  for (const family of familyKeys) {
    const accent = readFamilyAccent(family);
    const label = FAMILY_LABEL[family as Family] ?? '';
    out.push(
      `| ${cell(family)} | ${cell(label)} | ${byFamily.get(family)!.length} `
        + `| ${accent ? `\`${accent}\`` : ''} |`,
    );
  }
  out.push('');
  out.push('### 按 rarity 分布');
  out.push('');
  out.push('| rarity | 条数 |');
  out.push('|---|---:|');
  for (const rarity of rarityKeys) {
    out.push(`| ${cell(rarity)} | ${byRarity.get(rarity) ?? 0} |`);
  }
  out.push('');
  out.push('## 家族明细');
  out.push('');
  out.push('家族按规范固定顺序排列；表内保持 `allBadges` 的声明顺序。');
  out.push('');

  for (const family of familyKeys) {
    const list = byFamily.get(family)!;
    const accent = readFamilyAccent(family);
    const label = FAMILY_LABEL[family as Family] ?? '';
    out.push(`### ${family} — ${label}`);
    out.push('');
    out.push(`- 条数：**${list.length}**`);
    out.push(`- 代表色：${accent ? `\`${accent}\`` : '（源文件未提供 `// family:` 代表色注释）'}`);
    out.push('');
    if (list.length === 0) {
      out.push('_（本家族当前没有徽章）_');
      out.push('');
      continue;
    }
    out.push('| id | 名称 | 判定条件 | 稀有度 | 命中数 | 概率 p | CP (ep) | group |');
    out.push('|---|---|---|---|---:|---:|---:|---|');
    for (const badge of list) {
      const pricing = PRICING[badge.id];
      const hits = pricing ? fmtInt(pricing.hits) : '—';
      const p = pricing ? fmtProb(pricing.hits) : '—';
      out.push(
        `| ${cell(badge.id)} | ${cell(badge.name)} | ${cell(badge.description)} `
          + `| ${cell(badge.rarity)} | ${hits} | ${p} | ${fmtInt(badge.cp)} `
          + `| ${badge.group ? cell(badge.group) : '—'} |`,
      );
    }
    out.push('');
  }

  out.push('## 取代组（supersession）');
  out.push('');
  out.push(
    '计分时，**同一 group 只取 CP 最高的一条**；其余成员仍算「已获得」，'
      + '但不计分（superseded）。没有 `group` 的徽章全部计分。',
  );
  out.push('');
  if (groupNames.length === 0) {
    out.push('_（当前没有徽章使用 `group`）_');
    out.push('');
  } else {
    for (const name of groupNames) {
      const members = [...groups.get(name)!].sort(
        (a, b) => b.cp - a.cp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const scoring = members[0];
      out.push(`### \`${cell(name)}\`（${members.length} 条）`);
      out.push('');
      out.push('| id | 名称 | CP | 计分 |');
      out.push('|---|---|---:|---|');
      for (const badge of members) {
        const isScoring = badge.id === scoring.id && badge.cp === scoring.cp;
        out.push(
          `| ${cell(badge.id)} | ${cell(badge.name)} | ${badge.cp} `
            + `| ${isScoring ? '✅ 计分' : '被取代'} |`,
        );
      }
      out.push('');
      const superseded = members.filter((b) => b !== scoring).map((b) => `\`${b.id}\``);
      out.push(`- 生效：\`${scoring.id}\`（CP ${scoring.cp}）`);
      out.push(`- 被取代：${superseded.length > 0 ? superseded.join('、') : '（无）'}`);
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push(
    '本文件由 `packages/shared/src/badges/renderDoc.ts` 渲染，'
      + '数据来源为 `packages/shared/src/badges/index.ts` 的 `allBadges`。',
  );
  out.push('重新生成：`pnpm -C packages/shared run docs`。');
  out.push('');
  out.push('**本文件由脚本生成，请勿手改。**');
  out.push('');

  return out.join('\n');
}
