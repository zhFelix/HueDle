/**
 * 本地身份标识（见 docs/DESIGN.md 第 7.1 / 11 节）。
 *
 * 本地模式没有账户系统，用 `crypto.randomUUID()` 生成匿名 ID 存 localStorage；
 * 种子 = `${utcDate}:local:${anonymousId}`，因此**同一设备同一天结果固定**，
 * 换设备或清缓存会重置（这是设计上已知且接受的取舍）。
 */
import type { Identity } from '@huedle/shared';
import { STORAGE_KEYS } from './storage';

/** 浏览器不支持 `crypto.randomUUID` 时的兜底：同样输出 v4 形状的 UUID。 */
function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return fallbackUuid();
}

/**
 * 取匿名 ID：不存在则生成并写入 `huedle:anonymousId`，之后恒返回同一个值。
 *
 * 存储不可用（隐私模式 / 被禁用）时不抛异常，降级为「本次会话内稳定」的 ID。
 */
export function getAnonymousId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(STORAGE_KEYS.anonymousId);
    if (existing) return existing;

    const created = createId();
    globalThis.localStorage?.setItem(STORAGE_KEYS.anonymousId, created);
    return created;
  } catch {
    return createId();
  }
}

/** 本地模式身份的便捷构造：`getDailyColorInfo(getLocalIdentity(), date)`。 */
export function getLocalIdentity(): Identity {
  return { mode: 'local', anonymousId: getAnonymousId() };
}
