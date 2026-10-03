/**
 * 密码哈希（scrypt）。
 *
 * 格式：`scrypt$N$r$p$<saltHex>$<hashHex>`
 *
 * 设计要点：
 *   - **每个用户独立随机 salt**（16 字节），杜绝彩虹表与「同密码同哈希」；
 *   - 参数写进哈希串本身，将来调参可以逐条验证，不需要全表迁移；
 *   - 比对用 `timingSafeEqual`，不用 `===`（避免按字节提前返回的时序泄漏）；
 *   - 解析失败 / 参数异常一律返回 `false`，绝不抛异常（数据库内容同样不可信）。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
export const SALT_BYTES = 16;

/** scrypt 的内存上限：128 * N * r 再加 1MB 余量。 */
function maxmemFor(n: number, r: number): number {
  return 128 * n * r + 1024 * 1024;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    hash.toString('hex'),
  ].join('$');
}

/** 上限保护：即使 DB 里的参数被改坏，也不会让一次登录把内存打满。 */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) return false;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return false;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'hex');
    expected = Buffer.from(parts[5]!, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: maxmemFor(n, r) });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * 一个固定口令的哈希，用于「用户不存在」时消耗与真实校验等量的时间。
 *
 * 没有它的话，「用户不存在」会立刻返回而「密码错误」要跑一次 scrypt，
 * 攻击者仅凭响应时间就能枚举出哪些用户名已注册 —— 与统一文案的初衷相悖。
 */
export const DUMMY_PASSWORD_HASH = hashPassword('\u0000huedle-dummy-password\u0000');
