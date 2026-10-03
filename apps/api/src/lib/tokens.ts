/**
 * 会话令牌。
 *
 * - 明文 token：`randomBytes(32)` 的 hex，只在响应里出现一次；
 * - 库里存的只有 `sha256(token)`：即使数据库泄露，也无法直接冒充在线会话
 *   （token 有 256 位熵，无法反查）。
 */
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 32;

/** 会话有效期：30 天。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(from: Date = new Date(), ttlMs = SESSION_TTL_MS): string {
  return new Date(from.getTime() + ttlMs).toISOString();
}
