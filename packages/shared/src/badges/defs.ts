/**
 * 全项目**原始徽章定义**（未注入定价）。
 *
 * 这个模块存在的唯一理由，是**打破一个自举死锁**：
 *
 *   - `index.ts` 在模块加载期就调用 `compose()` 给每条徽章注入定价，
 *     而它对缺少定价的徽章**直接抛错**（这是刻意的，防静默给 0 分）；
 *   - 但「生成定价」的 `enumerate` 命令也需要先加载徽章表。
 *
 * 于是新增徽章后：要定价 → 得跑 enumerate → 得加载表 → 表说没有定价 → 跑不了。
 *
 * 所以原始定义必须住在**一个不组装、不抛错的模块**里。枚举器只 import 这里，
 * 永远不碰 `index.ts` 的组装逻辑。
 *
 * 实测踩过：一次加 50 条徽章，`pnpm run enumerate` 直接失败，
 * 且报错信息里推荐运行的正是这条跑不起来的命令。
 *
 * ⚠️ 顺序即对外顺序（图鉴、快照测试都依赖它），改动前先看 `index.ts` 的注释。
 */
import type { BadgeDef } from '../types';
import { casinoBadges as casinoDefs } from './casino';
import { channelBadges as channelDefs } from './channel';
import { cultureBadges as cultureDefs } from './culture';
import { extremeBadges as extremeDefs } from './extreme';
import { grayBadges as grayDefs } from './gray';
import { luckyBadges as luckyDefs } from './lucky';
import { mathBadges as mathDefs } from './math';
import { patternBadges as patternDefs } from './pattern';
import { perceptionBadges as perceptionDefs } from './perception';
import { pureBadges as pureDefs } from './pure';

export const allBadgeDefs: BadgeDef[] = [
  ...grayDefs,
  ...extremeDefs,
  ...pureDefs,
  ...channelDefs,
  ...mathDefs,
  ...perceptionDefs,
  ...patternDefs,
  ...cultureDefs,
  ...luckyDefs,
  ...casinoDefs,
];
