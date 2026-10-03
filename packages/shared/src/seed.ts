/**
 * 种子与每日颜色生成（见 docs/DESIGN.md 第 7 节）。
 *
 * 两种模式共用同一套颜色生成算法，**只有种子来源不同**：
 *
 *   - 本地模式：`${day}:local:${anonymousId}` —— 同一设备同一天结果固定，
 *     换设备或清缓存会重置；
 *   - 登录模式：`${day}:user:${userId}` —— 同一账户在任何设备上同一天结果一致。
 *
 * 本模块是**纯函数**：不读时间以外的任何外部状态，不碰存储、不碰网络。
 * 前端与后端 import 同一份代码，因此两端对同一个 `(identity, day)` 必然得到同一个颜色。
 */
import type { ColorInfo, RGB } from './types';
import { toColorInfo } from './color';

/** 颜色空间大小：24 位真彩色共 2²⁴ 种。同时也是定价枚举的样本空间。 */
export const COLOR_SPACE_SIZE = 0x1000000;

/**
 * FNV-1a 32 位哈希。
 *
 * 选它的理由：实现短、无依赖、雪崩性够好，且**跨平台逐位可复现**
 * （只用 `Math.imul` 的 32 位整数乘，不涉及浮点）。
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 身份标识。
 *
 * 判别式联合类型：`mode` 决定种子前缀与字段名，使得本地 ID 与账户 ID
 * 即使字符串完全相同也不会算出同一个颜色。
 */
export type Identity =
  | { mode: 'local'; anonymousId: string }
  | { mode: 'user'; userId: string };

/**
 * UTC 日期字符串 `YYYY-MM-DD`。
 *
 * 每日重置点是 **UTC 00:00**：用 `toISOString` 而不是本地时间，
 * 否则不同时区的玩家会在不同时刻换色，也会让服务端与客户端算不到一起。
 */
export function utcDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 把一个身份与一天拼成种子串。导出以便测试与排查（种子是可公开的，不是秘密）。 */
export function buildSeed(identity: Identity, date: Date = new Date()): string {
  const day = utcDate(date);
  return identity.mode === 'local'
    ? `${day}:local:${identity.anonymousId}`
    : `${day}:user:${identity.userId}`;
}

/**
 * 取某一天的颜色。
 *
 * 同一个 `(identity, day)` 必然返回同一个 RGB —— 这就是「刷新不变」的全部实现：
 * **没有存储、没有缓存、没有重抽**，结果纯粹由种子决定。
 */
export function getDailyColor(identity: Identity, date: Date = new Date()): RGB {
  const value = fnv1a(buildSeed(identity, date)) % COLOR_SPACE_SIZE;
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** `getDailyColor` 的便利包装：直接拿到含 hex 与 hsl 的完整颜色信息。 */
export function getDailyColorInfo(identity: Identity, date: Date = new Date()): ColorInfo {
  return toColorInfo(getDailyColor(identity, date));
}
