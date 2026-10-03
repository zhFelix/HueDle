import { describe, expect, it } from 'vitest';
import {
  channelSum,
  distinctChannelCount,
  digitSum,
  gcd,
  hexBytes,
  isFibonacci,
  isGray,
  isPalindromeNumber,
  isPerfectSquare,
  isPowerOfTwo,
  isPrime,
  lcm,
  maxChannel,
  minChannel,
  toHexByte,
} from './helpers';

describe('isPowerOfTwo', () => {
  it('0 → false，1 → true，2 → true，负数与小数 → false', () => {
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(2)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(isPowerOfTwo(4)).toBe(true);
    expect(isPowerOfTwo(128)).toBe(true);
    expect(isPowerOfTwo(255)).toBe(false);
    expect(isPowerOfTwo(-2)).toBe(false);
    expect(isPowerOfTwo(2.5)).toBe(false);
  });
});

describe('isPrime', () => {
  it('0,1 → false；2 → true；负数 → false', () => {
    expect(isPrime(0)).toBe(false);
    expect(isPrime(1)).toBe(false);
    expect(isPrime(2)).toBe(true);
    expect(isPrime(3)).toBe(true);
    expect(isPrime(4)).toBe(false);
    expect(isPrime(97)).toBe(true);
    expect(isPrime(100)).toBe(false);
    expect(isPrime(-7)).toBe(false);
    expect(isPrime(2.5)).toBe(false);
  });
});

describe('isPerfectSquare', () => {
  it('0 → true，1,4,9 → true，2 → false', () => {
    expect(isPerfectSquare(0)).toBe(true);
    expect(isPerfectSquare(1)).toBe(true);
    expect(isPerfectSquare(4)).toBe(true);
    expect(isPerfectSquare(9)).toBe(true);
    expect(isPerfectSquare(2)).toBe(false);
    expect(isPerfectSquare(-4)).toBe(false);
    expect(isPerfectSquare(2.25)).toBe(false);
  });
});

describe('isFibonacci', () => {
  it('0,1,2,3,5,8 → true；4,6,7 → false', () => {
    for (const n of [0, 1, 2, 3, 5, 8, 13, 21, 144]) {
      expect(isFibonacci(n)).toBe(true);
    }
    for (const n of [4, 6, 7, 9, 10, 20, 255]) {
      expect(isFibonacci(n)).toBe(false);
    }
    expect(isFibonacci(-1)).toBe(false);
  });
});

describe('digitSum', () => {
  it('255 → 12，0 → 0，1234 → 10', () => {
    expect(digitSum(255)).toBe(12);
    expect(digitSum(0)).toBe(0);
    expect(digitSum(1234)).toBe(10);
    expect(digitSum(9)).toBe(9);
    expect(digitSum(-255)).toBe(12);
  });
});

describe('isPalindromeNumber', () => {
  it('0..9 → true，121 → true，123 → false，负数 → false', () => {
    for (let n = 0; n <= 9; n += 1) {
      expect(isPalindromeNumber(n)).toBe(true);
    }
    expect(isPalindromeNumber(0)).toBe(true);
    expect(isPalindromeNumber(121)).toBe(true);
    expect(isPalindromeNumber(1221)).toBe(true);
    expect(isPalindromeNumber(123)).toBe(false);
    expect(isPalindromeNumber(-121)).toBe(false);
  });
});

describe('gcd / lcm', () => {
  it('gcd 基本与 0 边界', () => {
    expect(gcd(12, 8)).toBe(4);
    expect(gcd(17, 5)).toBe(1);
    expect(gcd(0, 5)).toBe(5);
    expect(gcd(0, 0)).toBe(0);
    expect(gcd(-12, 8)).toBe(4);
  });

  it('lcm 基本与 0 边界（不除零）', () => {
    expect(lcm(12, 8)).toBe(24);
    expect(lcm(3, 5)).toBe(15);
    expect(lcm(0, 5)).toBe(0);
    expect(lcm(0, 0)).toBe(0);
  });
});

describe('通道聚合', () => {
  it('maxChannel / minChannel / channelSum', () => {
    expect(maxChannel({ r: 1, g: 9, b: 4 })).toBe(9);
    expect(minChannel({ r: 1, g: 9, b: 4 })).toBe(1);
    expect(channelSum({ r: 255, g: 0, b: 0 })).toBe(255);
    expect(channelSum({ r: 1, g: 2, b: 3 })).toBe(6);
  });

  it('distinctChannelCount：888 → 1；808 → 2；123 → 3', () => {
    expect(distinctChannelCount({ r: 88, g: 88, b: 88 })).toBe(1);
    expect(distinctChannelCount({ r: 88, g: 0, b: 88 })).toBe(2);
    expect(distinctChannelCount({ r: 1, g: 2, b: 3 })).toBe(3);
    expect(distinctChannelCount({ r: 0, g: 0, b: 0 })).toBe(1);
  });

  it('isGray：仅严格相等为 true', () => {
    expect(isGray({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isGray({ r: 255, g: 255, b: 255 })).toBe(true);
    expect(isGray({ r: 18, g: 18, b: 18 })).toBe(true);
    expect(isGray({ r: 18, g: 18, b: 19 })).toBe(false);
    expect(isGray({ r: 1, g: 2, b: 3 })).toBe(false);
  });
});

describe('hex 工具', () => {
  it('hexBytes："#002FA7" → ["00","2F","A7"]', () => {
    expect(hexBytes('#002FA7')).toEqual(['00', '2F', 'A7']);
    expect(hexBytes('#ffffff')).toEqual(['FF', 'FF', 'FF']);
    expect(hexBytes('002FA7')).toEqual(['00', '2F', 'A7']);
  });

  it('toHexByte：0 → "00"；255 → "FF"（大写）', () => {
    expect(toHexByte(0)).toBe('00');
    expect(toHexByte(255)).toBe('FF');
    expect(toHexByte(10)).toBe('0A');
    expect(toHexByte(0x2f)).toBe('2F');
    expect(toHexByte(999)).toBe('FF');
    expect(toHexByte(-5)).toBe('00');
  });
});
