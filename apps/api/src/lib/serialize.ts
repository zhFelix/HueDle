/**
 * 数据库行 → API 响应体的序列化。
 *
 * 形状与前端 `apps/web/src/lib/storage.ts` 的 `HistoryItem` **逐字段一致**：
 * `{ date, hex, cp, rarity, badgeIds }` —— 前端下一轮接登录模式时可以直接喂给存储层。
 */
import type { ScoreRarity } from '@huedle/shared';
import type { DailyRow } from '../db/store';

export interface HistoryItem {
  date: string;
  hex: string;
  cp: number;
  rarity: ScoreRarity;
  badgeIds: string[];
}

/** 存档里的 `badge_ids` 是 JSON 文本；脏数据视为空数组，绝不抛。 */
export function parseBadgeIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function toHistoryItem(row: DailyRow): HistoryItem {
  return {
    date: row.date,
    hex: row.hex,
    cp: row.cp,
    rarity: row.rarity as ScoreRarity,
    badgeIds: parseBadgeIds(row.badge_ids),
  };
}
