// family: math — 代表色 #010101
import type { BadgeDef, ColorInfo } from '../types';
import {
  channelSum,
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
    {
    id: 'math-triangular-trinity',
    name: '三角三连',
    description: 'R、G、B 三个数均为三角数（0,1,3,6,10,15,21,28,...）',
    family: 'math',
    check: c => {
      const isTri = (n: number) => {
        const k = Math.round((Math.sqrt(8 * n + 1) - 1) / 2);
        return (k * (k + 1)) / 2 === n;
      };
      return isTri(c.r) && isTri(c.g) && isTri(c.b);
    },
  },
  {
    id: 'math-catalan-trinity',
    name: '加泰三连',
    description: 'R、G、B 三个数均为加泰罗尼亚数（1,2,5,14,42,132）',
    family: 'math',
    check: c => {
      const isCat = (n: number) =>
        n === 1 || n === 2 || n === 5 || n === 14 || n === 42 || n === 132;
      return isCat(c.r) && isCat(c.g) && isCat(c.b);
    },
  },
  {
    id: 'math-arithmetic-triad',
    name: '等差三数',
    description: 'R、G、B 升序排列后构成公差为正的等差数列',
    family: 'math',
    check: c => {
      const nums = [c.r, c.g, c.b].sort((a, b) => a - b);
      return nums[2] > nums[1] && nums[1] - nums[0] === nums[2] - nums[1];
    },
  },
  {
    id: 'math-pythagorean-triad',
    name: '勾股三数',
    description: 'R、G、B 升序排列后满足 a² + b² = c²',
    family: 'math',
    check: c => {
      const nums = [c.r, c.g, c.b].sort((a, b) => a - b);
      return (
        nums[0] > 0 &&
        nums[0] * nums[0] + nums[1] * nums[1] === nums[2] * nums[2]
      );
    },
  },
  {
    id: 'math-sum-prime',
    name: '质数之和',
    description: 'R + G + B 为质数',
    family: 'math',
    check: c => isPrime(channelSum(c)),
  },
  {
    id: 'math-sum-perfect-square',
    name: '平方之和',
    description: 'R + G + B 为完全平方数',
    family: 'math',
    check: c => isPerfectSquare(channelSum(c)),
  },
  {
    id: 'math-sum-fibonacci',
    name: '斐氏和',
    description: 'R + G + B 为斐波那契数',
    family: 'math',
    check: c => isFibonacci(channelSum(c)),
  },
];
