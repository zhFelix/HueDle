/**
 * 颜色转换：RGB → HSL / ColorInfo（见 docs/BADGE-SPEC.md 第 4 节，签名已冻结）。
 */
import type { ColorInfo, HSL, RGB } from './types';
import { toHexByte } from './badges/helpers';

/**
 * 将 0–255 的通道值转为大写两位十六进制。
 * 例如 0 → "00"，255 → "FF"。越界值会被夹到 [0,255]。
 */
function hexByte(n: number): string {
  return toHexByte(n);
}

/**
 * RGB → HSL。
 *
 * 采用标准 HSL 公式：
 * - 令 r,g,b 归一化到 [0,1]，max = 最大通道，min = 最小通道，d = max - min；
 * - l = (max + min) / 2；
 * - 当 d = 0（即 r = g = b，含纯黑与纯白）时，h = 0 且 s = 0；
 * - 否则 s = d / (1 - |2l - 1|)；
 * - h 按 max 落在哪个通道取 60 度分段：max=r 时 h = 60·((g-b)/d mod 6)，
 *   max=g 时 h = 60·((b-r)/d + 2)，max=b 时 h = 60·((r-g)/d + 4)；
 *   最后归一到 [0,360)。
 *
 * s 与 l 输出到 [0,100]，h 输出到 [0,360)。
 */
export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) {
      h = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / d + 2);
    } else {
      h = 60 * ((r - g) / d + 4);
    }

    if (h < 0) {
      h += 360;
    }
    h %= 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

/**
 * 由 RGB 构造完整 ColorInfo：
 * - `hex`：大写、带 `#`、恒为 7 字符（如 "#002FA7"）；
 * - `hsl`：由 {@link rgbToHsl} 计算；
 * - 同时保留原始 r/g/b。
 */
export function toColorInfo(rgb: RGB): ColorInfo {
  const hex = `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`;
  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    hex,
    hsl: rgbToHsl(rgb),
  };
}

/**
 * `"#RRGGBB"` → RGB。大小写均可，也接受不带 `#` 的写法。
 *
 * 解析失败返回 `null` 而**不抛异常**：这个函数会被用来读**用户可篡改的**
 * localStorage 数据，任何非法输入都只能当成"没有这条记录"。
 */
export function parseHex(hex: unknown): RGB | null {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/** `parseHex` + `toColorInfo` 的合并版；解析失败返回 `null`。 */
export function colorInfoFromHex(hex: unknown): ColorInfo | null {
  const rgb = parseHex(hex);
  return rgb === null ? null : toColorInfo(rgb);
}
