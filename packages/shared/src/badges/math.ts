// family: math — 代表色 #010101
import type { BadgeDef, ColorInfo } from '../types';
import {
  digitSum,
  gcd,
  isFibonacci,
  isPalindromeNumber,
  isPerfectSquare,
  isPowerOfTwo,
  isPrime,
} from './helpers';

// private：把三通道升序排列，供数与数之间成比例/成关系的判定使用
function ascending(r: number, g: number, b: number): [number, number, number] {
  return [r, g, b].sort((x, y) => x - y) as [number, number, number];
}

export const mathBadges: BadgeDef[] = [
  {
    id: 'math-power-trinity',
    name: '幂次三重',
    description: 'R、G、B 均为 2 的幂',
    family: 'math',
    check: (color: ColorInfo) =>
      isPowerOfTwo(color.r) && isPowerOfTwo(color.g) && isPowerOfTwo(color.b),
  },
  {
    id: 'math-square-trinity',
    name: '完全平方',
    description: 'R、G、B 均为完全平方数',
    family: 'math',
    check: (color: ColorInfo) =>
      isPerfectSquare(color.r) && isPerfectSquare(color.g) && isPerfectSquare(color.b),
  },
  {
    id: 'math-prime-trinity',
    name: '素数之约',
    description: 'R、G、B 均为质数',
    family: 'math',
    check: (color: ColorInfo) => isPrime(color.r) && isPrime(color.g) && isPrime(color.b),
  },
  {
    id: 'math-fibonacci-trinity',
    name: '斐波那契',
    description: 'R、G、B 均为斐波那契数',
    family: 'math',
    check: (color: ColorInfo) =>
      isFibonacci(color.r) && isFibonacci(color.g) && isFibonacci(color.b),
  },
  {
    id: 'math-palindrome-trinity',
    name: '回文三重',
    description: 'R、G、B 均为回文数（0–9 或 11、22、…、252 这类正读反读相同的数）',
    family: 'math',
    check: (color: ColorInfo) =>
      isPalindromeNumber(color.r) &&
      isPalindromeNumber(color.g) &&
      isPalindromeNumber(color.b),
  },
  {
    id: 'math-sum-255',
    name: '满盈之数',
    description: 'R + G + B = 255',
    family: 'math',
    check: (color: ColorInfo) => color.r + color.g + color.b === 255,
  },
  {
    id: 'math-digit-sum-equal',
    name: '数位同和',
    description: 'R、G、B 的十进制数位和两两相等',
    family: 'math',
    check: (color: ColorInfo) =>
      digitSum(color.r) === digitSum(color.g) && digitSum(color.g) === digitSum(color.b),
  },
  {
    id: 'math-coprime-trinity',
    name: '互质三数',
    description: 'R、G、B 的最大公约数为 1',
    family: 'math',
    check: (color: ColorInfo) => gcd(gcd(color.r, color.g), color.b) === 1,
  },
  {
    id: 'math-bitwise-or-255',
    name: '位满八极',
    description: 'R、G、B 按位或的结果为 255',
    family: 'math',
    check: (color: ColorInfo) => (color.r | color.g | color.b) === 255,
  },
  {
    id: 'math-doubling-ladder',
    name: '倍增之链',
    description:
      '将 R、G、B 升序排列后成 1 : 2 : 4 的比例，且最小通道大于 0、三通道之和为完全平方数',
    family: 'math',
    check: (color: ColorInfo) => {
      const [a, b, c] = ascending(color.r, color.g, color.b);
      return a > 0 && b === 2 * a && c === 4 * a && isPerfectSquare(a + b + c);
    },
  },
];
