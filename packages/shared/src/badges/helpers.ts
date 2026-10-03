/**
 * 徽章判定辅助函数（见 docs/BADGE-SPEC.md 第 4 节，签名已冻结）。
 * 作者只能使用这些函数与 ColorInfo 自带字段，不得自行新增 helper。
 */
import type { RGB } from '../types';

/** 是否为 2 的幂（整数）。0 与负数、非整数一律 false：0 → false，1 → true，2 → true。 */
export function isPowerOfTwo(n: number): boolean {
  if (!Number.isInteger(n) || n < 1) return false;
  return (n & (n - 1)) === 0;
}

/** 是否为质数。0、1、负数与非整数一律 false：2 → true。 */
export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

/** 是否为完全平方数（整数）。0 → true（0 = 0²），负数与非整数 false。 */
export function isPerfectSquare(n: number): boolean {
  if (!Number.isInteger(n) || n < 0) return false;
  const root = Math.sqrt(n);
  return Number.isInteger(root);
}

/** 是否为斐波那契数（整数，含 0）。判定：5n²+4 或 5n²−4 为完全平方数。 */
export function isFibonacci(n: number): boolean {
  if (!Number.isInteger(n) || n < 0) return false;
  return isPerfectSquare(5 * n * n + 4) || isPerfectSquare(5 * n * n - 4);
}

/** 十进制数位之和（对 n 取绝对值后逐位相加）：255 → 12。非有限数 → 0。 */
export function digitSum(n: number): number {
  if (!Number.isFinite(n)) return 0;
  let rest = Math.abs(Math.trunc(n));
  let sum = 0;
  while (rest > 0) {
    sum += rest % 10;
    rest = Math.floor(rest / 10);
  }
  return sum;
}

/** 是否为十进制回文数。0..9 → true，121 → true；负数与非整数 false。 */
export function isPalindromeNumber(n: number): boolean {
  if (!Number.isInteger(n) || n < 0) return false;
  const s = String(n);
  return s === [...s].reverse().join('');
}

/** 最大公约数（对参数取绝对值，Euclid 算法）。gcd(0, 0) → 0。 */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** 最小公倍数。任一参数为 0 时返回 0，避免除零与无意义的 0。 */
export function lcm(a: number, b: number): number {
  const x = Math.abs(Math.trunc(a));
  const y = Math.abs(Math.trunc(b));
  if (x === 0 || y === 0) return 0;
  return (x / gcd(x, y)) * y;
}

/** 三通道最大值。 */
export function maxChannel(c: RGB): number {
  return Math.max(c.r, c.g, c.b);
}

/** 三通道最小值。 */
export function minChannel(c: RGB): number {
  return Math.min(c.r, c.g, c.b);
}

/** 三通道之和。 */
export function channelSum(c: RGB): number {
  return c.r + c.g + c.b;
}

/** 不同通道值的个数：888 → 1；808 → 2；123 → 3。 */
export function distinctChannelCount(c: RGB): number {
  return new Set([c.r, c.g, c.b]).size;
}

/** 是否为严格灰阶：r === g && g === b（含纯黑与纯白）。 */
export function isGray(c: RGB): boolean {
  return c.r === c.g && c.g === c.b;
}

/** 拆分 hex 为三个大写字节串："#002FA7" → ["00","2F","A7"]（容忍大小写与缺失的 #）。 */
export function hexBytes(hex: string): [string, string, string] {
  const raw = (hex.startsWith('#') ? hex.slice(1) : hex).toUpperCase();
  const padded = raw.padStart(6, '0');
  return [padded.slice(0, 2), padded.slice(2, 4), padded.slice(4, 6)];
}

/** 0–255 通道值 → 大写两位十六进制：0 → "00"；255 → "FF"（越界夹到 [0,255]）。 */
export function toHexByte(n: number): string {
  const clamped = Math.min(255, Math.max(0, Math.trunc(n)));
  return clamped.toString(16).toUpperCase().padStart(2, '0');
}
