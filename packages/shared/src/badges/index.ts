/**
 * 全局徽章表 barrel（见 docs/BADGE-SPEC.md 第 2 节、docs/PRICING-SPEC.md 第 5 节）。
 *
 * 家族顺序固定为：gray, extreme, pure, channel, math, perception, pattern, culture, lucky, casino。
 *
 * **本文件负责把作者写的 `BadgeDef` 与枚举导出的 `PRICING` 合成为完整 `Badge`。**
 * 作者只写规则，`cp` / `rarity` 一律由价格表注入，不手填。
 */
import type { Badge, BadgeDef } from '../types';
import { PRICING } from '../pricing.gen';

import { grayBadges as grayDefs } from './gray';
import { extremeBadges as extremeDefs } from './extreme';
import { pureBadges as pureDefs } from './pure';
import { channelBadges as channelDefs } from './channel';
import { mathBadges as mathDefs } from './math';
import { perceptionBadges as perceptionDefs } from './perception';
import { patternBadges as patternDefs } from './pattern';
import { cultureBadges as cultureDefs } from './culture';
import { luckyBadges as luckyDefs } from './lucky';
import { casinoBadges as casinoDefs } from './casino';

/**
 * 给一条徽章定义注入定价。
 *
 * 定价缺失属于**致命不一致**（意味着新增了徽章但没重跑枚举），因此直接抛错而不是静默降级——
 * 静默降级会让新徽章偷偷拿 0 分，是最难发现的那类 bug。
 */
function compose(def: BadgeDef): Badge {
  const pricing = PRICING[def.id];
  if (!pricing) {
    throw new Error(
      `徽章 "${def.id}" 缺少定价数据。新增或改名徽章后必须重跑：`
      + 'pnpm -C packages/shared run enumerate',
    );
  }
  return { ...def, cp: pricing.ep, rarity: pricing.rarity };
}

const composeAll = (defs: BadgeDef[]): Badge[] => defs.map(compose);

/** 各家族徽章表（含派生定价），顺序与源文件声明顺序一致。 */
export const grayBadges: Badge[] = composeAll(grayDefs);
export const extremeBadges: Badge[] = composeAll(extremeDefs);
export const pureBadges: Badge[] = composeAll(pureDefs);
export const channelBadges: Badge[] = composeAll(channelDefs);
export const mathBadges: Badge[] = composeAll(mathDefs);
export const perceptionBadges: Badge[] = composeAll(perceptionDefs);
export const patternBadges: Badge[] = composeAll(patternDefs);
export const cultureBadges: Badge[] = composeAll(cultureDefs);
export const luckyBadges: Badge[] = composeAll(luckyDefs);
export const casinoBadges: Badge[] = composeAll(casinoDefs);

/** 全项目徽章表（家族顺序固定，便于图鉴展示与快照测试）。 */
export const allBadges: Badge[] = [
  ...grayBadges,
  ...extremeBadges,
  ...pureBadges,
  ...channelBadges,
  ...mathBadges,
  ...perceptionBadges,
  ...patternBadges,
  ...cultureBadges,
  ...luckyBadges,
  ...casinoBadges,
];
