import { describe, expect, it } from 'vitest';
import { toColorInfo } from '../../color';
import { mathBadges } from '../math';

const badge = (id: string) => mathBadges.find(b => b.id === id)!;

const expectHit = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(true);
};

const expectMiss = (id: string, r: number, g: number, b: number) => {
  expect(badge(id).check(toColorInfo({ r, g, b }))).toBe(false);
};

describe('math 家族', () => {
  it('幂次三重：三通道均为 2 的幂', () => {
    expectHit('math-power-trinity', 1, 2, 4);
    expectHit('math-power-trinity', 128, 64, 32);
    expectHit('math-power-trinity', 1, 1, 1);
    expectMiss('math-power-trinity', 3, 4, 8);
    expectMiss('math-power-trinity', 0, 2, 4);
  });

  it('完全平方：三通道均为完全平方数', () => {
    expectHit('math-square-trinity', 0, 1, 4);
    expectHit('math-square-trinity', 225, 169, 144);
    expectMiss('math-square-trinity', 2, 4, 9);
  });

  it('素数之约：三通道均为质数', () => {
    expectHit('math-prime-trinity', 2, 3, 5);
    expectHit('math-prime-trinity', 251, 241, 239);
    expectMiss('math-prime-trinity', 4, 3, 5);
    expectMiss('math-prime-trinity', 1, 2, 3);
  });

  it('斐波那契：三通道均为斐波那契数', () => {
    expectHit('math-fibonacci-trinity', 0, 1, 2);
    expectHit('math-fibonacci-trinity', 233, 144, 89);
    expectMiss('math-fibonacci-trinity', 4, 5, 8);
  });

  it('回文三重：三通道均为回文数', () => {
    expectHit('math-palindrome-trinity', 0, 11, 22);
    expectHit('math-palindrome-trinity', 252, 191, 101);
    expectMiss('math-palindrome-trinity', 10, 11, 22);
    expectMiss('math-palindrome-trinity', 100, 101, 111);
  });

  it('满盈之数：三通道之和为 255', () => {
    expectHit('math-sum-255', 0, 0, 255);
    expectHit('math-sum-255', 85, 85, 85);
    expectMiss('math-sum-255', 1, 1, 1);
    expectMiss('math-sum-255', 100, 100, 100);
  });

  it('数位同和：三通道的十进制数位和相等', () => {
    expectHit('math-digit-sum-equal', 5, 5, 5);
    expectHit('math-digit-sum-equal', 12, 21, 30);
    expectHit('math-digit-sum-equal', 99, 99, 99);
    expectMiss('math-digit-sum-equal', 1, 2, 3);
    expectMiss('math-digit-sum-equal', 12, 21, 31);
  });

  it('互质三数：三通道最大公约数为 1', () => {
    expectHit('math-coprime-trinity', 1, 2, 3);
    expectHit('math-coprime-trinity', 255, 254, 253);
    expectMiss('math-coprime-trinity', 2, 4, 6);
    expectMiss('math-coprime-trinity', 0, 5, 10);
  });

  it('位满八极：三通道按位或为 255', () => {
    expectHit('math-bitwise-or-255', 15, 96, 240);
    expectHit('math-bitwise-or-255', 255, 0, 0);
    expectHit('math-bitwise-or-255', 128, 127, 0);
    expectMiss('math-bitwise-or-255', 1, 2, 4);
    expectMiss('math-bitwise-or-255', 254, 254, 254);
  });

  it('倍增之链：升序后成 1:2:4 且三数之和为完全平方数', () => {
    expectHit('math-doubling-ladder', 7, 14, 28);
    expectHit('math-doubling-ladder', 28, 7, 14);
    expectHit('math-doubling-ladder', 252, 126, 63);
    expectMiss('math-doubling-ladder', 1, 2, 4);
    expectMiss('math-doubling-ladder', 2, 4, 8);
    expectMiss('math-doubling-ladder', 7, 14, 30);
    expectMiss('math-doubling-ladder', 0, 0, 0);
  });
});
