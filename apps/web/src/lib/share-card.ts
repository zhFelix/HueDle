/**
 * 今日结果分享卡片（见 docs/DESIGN.md 第 15 节）。
 *
 * ## 为什么要拆两层
 *
 * jsdom **不实现 Canvas**（`canvas.getContext('2d')` 返回 `null`），
 * 如果把「算坐标 + 画」写在一个函数里，整个功能就变成测试盲区。
 * 所以这里硬性拆开：
 *
 * 1. **布局层**（`layoutShareCard`）—— 纯函数，输入
 *    `{ hex, cp, rarity, badges, date }`，输出**绘制指令数组** `DrawCommand[]`。
 *    所有坐标、换行、截断、「等 N 枚」的折叠都在这一层，**一次都不碰 ctx**，
 *    因此可以在没有 Canvas 的环境里直接断言。
 * 2. **绘制层**（`drawShareCard` / `setupShareCanvas`）—— 薄，只负责把指令喂给 ctx。
 *    这一层不做任何决策，单测不覆盖；真正的正确性靠浏览器里导出的图看。
 *
 * 文字宽度估算**不依赖 `ctx.measureText`**（布局层拿不到 ctx）：
 * 用 {@link estimateTextWidth} 按字符类别（CJK 全角 / 拉丁半角）估，
 * 单独导出以便测试。估算偏保守（宁短勿溢出）。
 *
 * ## 高清
 *
 * 逻辑尺寸 1080×1350（社交平台竖图），画布实体像素 = 逻辑尺寸 × dpr，
 * 且 dpr 至少 2（见 {@link resolveDpr}），再用 `ctx.scale` 把坐标缩回逻辑空间。
 *
 * ## 分享降级
 *
 * 1. `navigator.canShare({ files })` 且 `navigator.share` 存在 → 系统分享面板；
 * 2. 否则 → 直接下载 PNG；
 * 3. 用户取消（`AbortError`）**不是错误**，返回 `'cancelled'`，不弹提示。
 */
import type { ScoreRarity } from '@huedle/shared';
import { formatCp } from './format';
import { rarityStyle } from './rarity';

// ── 常量 ──────────────────────────────────────────────────────────────────

/** 逻辑宽度（导出实体像素 = 该值 × dpr）。 */
export const CARD_WIDTH = 1080;
/** 逻辑高度。1080×1350 是社交平台竖图比例。 */
export const CARD_HEIGHT = 1350;
/** dpr 下限——手机之外的设备也导出 2×，避免糊。 */
export const MIN_DPR = 2;
/** 卡片上的站点地址：收到图的人得知道去哪玩。 */
export const SITE_ADDRESS = 'zhFelix.github.io/HueDle';
/** 引导语（DESIGN 第 15 节）。 */
export const GUIDANCE_TEXT = '你今天抽到了什么颜色？';
/** 徽章最多画几枚，超出折叠成「等 N 枚」。 */
export const MAX_BADGES = 6;

const CARD_BG = '#0A0A0A';
const ACCENT = '#FBBF24';
const TEXT_PRIMARY = '#FAFAFA';
const TEXT_SECONDARY = '#A3A3A3';
const TEXT_MUTED = '#737373';
const TEXT_BADGE = '#E5E5E5';

const PAD = 80;
const SWATCH_Y = 176;
const SWATCH_W = CARD_WIDTH - PAD * 2;
const SWATCH_H = 400;
const BADGE_HEADING_Y = 616;
const BADGE_START_Y = 656;
const BADGE_LINE_HEIGHT = 42;
const BADGE_TEXT_X = PAD + 30;
const BADGE_TEXT_FONT_SIZE = 32;
const CP_LABEL_Y = 985;
const CP_VALUE_Y = 1018;
const RARITY_Y = 1128;
const GUIDANCE_Y = 1210;
const SITE_Y = 1268;

/** 中文系统字体栈。 */
export const SANS_STACK =
  'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
/** HEX 用的等宽字体栈。 */
export const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// ── 类型 ──────────────────────────────────────────────────────────────────

/** 布局层只需要徽章的中文名（`Badge` 结构上可直接传入）。 */
export interface ShareCardBadge {
  name: string;
}

/** 布局层输入——一张卡片需要的全部数据。 */
export interface ShareCardInput {
  /** 大写带 # 的 7 字符 hex。 */
  hex: string;
  /** 总 CP（原始数值，卡片内自行加千位分隔）。 */
  cp: number;
  /** 本次抽取的稀有度档位（7 档）。 */
  rarity: ScoreRarity;
  /** 计分保留的徽章列表。 */
  badges: readonly ShareCardBadge[];
  /** UTC 日期，形如 `2026-10-03`。 */
  date: string;
}

type TextAlign = 'left' | 'center' | 'right';
type TextBaseline = 'top' | 'middle' | 'alphabetic';

/** 绘制指令：矩形（可选圆角 / 描边）。 */
export interface RectCommand {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  radius?: number;
  stroke?: string;
  lineWidth?: number;
}

/** 绘制指令：文本。`y` 是 `baseline` 指定的基准位置。 */
export interface TextCommand {
  type: 'text';
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align: TextAlign;
  baseline?: TextBaseline;
}

export type DrawCommand = RectCommand | TextCommand;

/** 布局层输出。 */
export interface ShareCardLayout {
  width: number;
  height: number;
  commands: DrawCommand[];
}

// ── 字体 / 文字估算（导出以便测试） ────────────────────────────────────────

/** 生成一条 SANS 字体串，如 `700 44px system-ui, …`。 */
export function sansFont(size: number, weight = 400): string {
  return `${weight} ${size}px ${SANS_STACK}`;
}

/** 生成一条等宽字体串。 */
export function monoFont(size: number, weight = 400): string {
  return `${weight} ${size}px ${MONO_STACK}`;
}

/** 全角 / CJK 码点集合（近似即可，估算只需保守）。 */
function isWideChar(codePoint: number): boolean {
  return (
    codePoint === 0x2026 || // …
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/**
 * 按字符类别估算文本宽度（像素）。
 *
 * - CJK / 全角 / `…` 记 1 em；
 * - 空格 0.28 em；
 * - 其余（拉丁、数字、标点）0.56 em。
 *
 * 不追求精确，只保证**不低估**常见中英混排的视觉宽度。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === ' ') em += 0.28;
    else if (isWideChar(cp)) em += 1;
    else em += 0.56;
  }
  return em * fontSize;
}

/**
 * 超出 `maxWidth` 时按字符数截断并补 `…`。
 *
 * 布局层没有 ctx，不能 measureText，所以按 {@link estimateTextWidth} 估。
 * 空结果也至少返回 `…`，避免画出一个空字符串。
 */
export function truncateText(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize);
  let out = '';
  let width = 0;
  for (const ch of text) {
    const w = estimateTextWidth(ch, fontSize);
    if (width + w + ellipsisWidth > maxWidth) break;
    out += ch;
    width += w;
  }
  return out.length > 0 ? `${out}…` : ellipsis;
}

// ── 布局层（纯函数，不碰 ctx） ────────────────────────────────────────────

function text(
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: TextAlign,
): TextCommand {
  return { type: 'text', text: value, x, y, font, color, align, baseline: 'top' };
}

/**
 * 把一次结果摊平成绘制指令数组。
 *
 * 排版顺序（自上而下）：标题 / 日期 → 大色块 + HEX → 徽章列表 → 总 CP + 稀有度
 * → 引导语 → 站点地址。稀有度代表色一律取 `lib/rarity.ts` 的 `accent`。
 */
export function layoutShareCard(input: ShareCardInput): ShareCardLayout {
  const commands: DrawCommand[] = [];
  const { label: rarityLabel, accent } = rarityStyle(input.rarity);

  // 背景
  commands.push({
    type: 'rect',
    x: 0,
    y: 0,
    w: CARD_WIDTH,
    h: CARD_HEIGHT,
    color: CARD_BG,
  });

  // 标题 + 日期
  commands.push(text('HueDle', PAD, 72, sansFont(44, 700), ACCENT, 'left'));
  commands.push(text(input.date, CARD_WIDTH - PAD, 80, sansFont(32), TEXT_SECONDARY, 'right'));

  // 大色块 + HEX
  commands.push(text('今日颜色', PAD, 140, sansFont(30), TEXT_MUTED, 'left'));
  commands.push({
    type: 'rect',
    x: PAD,
    y: SWATCH_Y,
    w: SWATCH_W,
    h: SWATCH_H,
    color: input.hex,
    radius: 28,
    stroke: 'rgba(255, 255, 255, 0.14)',
    lineWidth: 2,
  });
  const chipW = estimateTextWidth(input.hex, 56) + 64;
  const chipH = 84;
  const chipX = PAD + 40;
  const chipY = SWATCH_Y + SWATCH_H - chipH - 40;
  commands.push({
    type: 'rect',
    x: chipX,
    y: chipY,
    w: chipW,
    h: chipH,
    color: 'rgba(0, 0, 0, 0.55)',
    radius: 16,
  });
  commands.push(text(input.hex, chipX + 32, chipY + 18, monoFont(56, 700), '#FFFFFF', 'left'));

  // 徽章列表
  commands.push(text('徽章', PAD, BADGE_HEADING_Y, sansFont(30), TEXT_MUTED, 'left'));
  const shown = input.badges.slice(0, MAX_BADGES);
  let y = BADGE_START_Y;
  for (const badge of shown) {
    commands.push({ type: 'rect', x: PAD, y: y + 10, w: 12, h: 12, color: accent, radius: 3 });
    commands.push(
      text(
        truncateText(badge.name, CARD_WIDTH - PAD - BADGE_TEXT_X, BADGE_TEXT_FONT_SIZE),
        BADGE_TEXT_X,
        y,
        sansFont(BADGE_TEXT_FONT_SIZE, 500),
        TEXT_BADGE,
        'left',
      ),
    );
    y += BADGE_LINE_HEIGHT;
  }
  if (input.badges.length === 0) {
    commands.push(text('没有命中任何徽章。', BADGE_TEXT_X, y, sansFont(30), TEXT_MUTED, 'left'));
  } else if (input.badges.length > MAX_BADGES) {
    // N 必须是**还没画出来的条数**，不是总数。
    // 「等 9 枚」在中文里读作「还有 9 个」——若填总数，看图的人会以为一共 15 枚，
    // 实际只漏了 3 枚。措辞也用「还有」而不是「等」，避免"列举未尽"的歧义。
    const hidden = input.badges.length - MAX_BADGES;
    commands.push(text(`还有 ${hidden} 枚`, BADGE_TEXT_X, y, sansFont(30), TEXT_MUTED, 'left'));
  }

  // 总 CP + 稀有度
  commands.push(text('总 CP', PAD, CP_LABEL_Y, sansFont(30), TEXT_MUTED, 'left'));
  commands.push(text(formatCp(input.cp), PAD, CP_VALUE_Y, sansFont(84, 700), TEXT_PRIMARY, 'left'));
  commands.push({ type: 'rect', x: PAD, y: RARITY_Y + 4, w: 8, h: 44, color: accent, radius: 4 });
  commands.push(text(rarityLabel, PAD + 24, RARITY_Y, sansFont(44, 600), accent, 'left'));

  // 引导语 + 站点地址
  commands.push(text(GUIDANCE_TEXT, CARD_WIDTH / 2, GUIDANCE_Y, sansFont(34, 500), TEXT_PRIMARY, 'center'));
  commands.push(text(SITE_ADDRESS, CARD_WIDTH / 2, SITE_Y, sansFont(30, 600), ACCENT, 'center'));

  return { width: CARD_WIDTH, height: CARD_HEIGHT, commands };
}

// ── 绘制层（薄） ──────────────────────────────────────────────────────────

/**
 * 把布局层的指令逐条画到 ctx 上。**不做任何决策**。
 *
 * `roundRect` 是较新的 API，缺失时退回直角——只影响观感，不影响内容。
 */
export function drawShareCard(ctx: CanvasRenderingContext2D, layout: ShareCardLayout): void {
  for (const cmd of layout.commands) {
    if (cmd.type === 'rect') {
      ctx.beginPath();
      if (cmd.radius && typeof ctx.roundRect === 'function') {
        ctx.roundRect(cmd.x, cmd.y, cmd.w, cmd.h, cmd.radius);
      } else {
        ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
      }
      ctx.fillStyle = cmd.color;
      ctx.fill();
      if (cmd.stroke) {
        ctx.lineWidth = cmd.lineWidth ?? 1;
        ctx.strokeStyle = cmd.stroke;
        ctx.stroke();
      }
    } else {
      ctx.font = cmd.font;
      ctx.fillStyle = cmd.color;
      ctx.textAlign = cmd.align;
      ctx.textBaseline = cmd.baseline ?? 'top';
      ctx.fillText(cmd.text, cmd.x, cmd.y);
    }
  }
}

/** 解析 dpr：显式传入优先，否则读 `devicePixelRatio`，并钳到至少 {@link MIN_DPR}。 */
export function resolveDpr(dpr?: number): number {
  const raw = dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : MIN_DPR);
  const value = Number.isFinite(raw) && (raw as number) > 0 ? (raw as number) : MIN_DPR;
  return Math.max(MIN_DPR, value);
}

/**
 * 按 dpr 放大画布并返回已 `scale` 的 ctx。
 *
 * jsdom 里 `getContext('2d')` 返回 `null`——返回 `null` 而不是抛异常，
 * 让尺寸断言可以在无 Canvas 环境下照跑（画布实体像素已经设好了）。
 */
export function setupShareCanvas(
  canvas: HTMLCanvasElement,
  dpr?: number,
): CanvasRenderingContext2D | null {
  const scale = resolveDpr(dpr);
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  return ctx;
}

/** 建一张分享卡片画布（逻辑尺寸见 {@link CARD_WIDTH}）。 */
export function createShareCanvas(dpr?: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  const canvas = document.createElement('canvas');
  const ctx = setupShareCanvas(canvas, dpr);
  return { canvas, ctx };
}

/** 把画布导出成 PNG Blob。 */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas-unavailable'));
      return;
    }
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('png-encode-failed'));
    }, 'image/png');
  });
}

/** 布局 + 绘制 + 编码，得到最终 PNG。 */
export async function renderShareCardPng(
  input: ShareCardInput,
  dpr?: number,
): Promise<Blob> {
  const { canvas, ctx } = createShareCanvas(dpr);
  if (!ctx) throw new Error('canvas-unavailable');
  drawShareCard(ctx, layoutShareCard(input));
  return canvasToPngBlob(canvas);
}

// ── 分享 / 下载降级 ───────────────────────────────────────────────────────

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** 下载文件名：`huedle-<日期>-<hex>.png`（hex 去掉 # 并小写）。 */
export function shareCardFilename(date: string, hex: string): string {
  const bare = hex.replace(/^#/, '').toLowerCase();
  return `huedle-${date}-${bare}.png`;
}

/** `navigator` 中本功能用到的两个方法（注入以便测试降级分支）。 */
export interface ShareChannel {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
}

export interface ShareDeps {
  /** 默认取全局 `navigator`。 */
  nav?: ShareChannel;
  /** 默认走 {@link downloadBlob}，测试可注入以拦截下载分支。 */
  download?: (blob: Blob, filename: string) => void;
}

/** `<a download>` + `URL.createObjectURL` 落地一个文件。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  // Firefox 需要节点在文档里才会响应 click
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立即 revoke 在部分浏览器会打断下载，延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * 分享一个已经编码好的 Blob，按能力降级：
 * 系统分享 → 下载；用户取消返回 `'cancelled'`（**不是错误**）。
 */
export async function shareCardBlob(
  blob: Blob,
  filename: string,
  deps: ShareDeps = {},
): Promise<ShareOutcome> {
  const nav = deps.nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const download = deps.download ?? downloadBlob;
  const files = [new File([blob], filename, { type: 'image/png' })];

  if (nav?.share && nav.canShare?.({ files })) {
    try {
      await nav.share({ files });
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
      throw error;
    }
  }

  download(blob, filename);
  return 'downloaded';
}

/** 一站式：布局 → 绘制 → 编码 → 分享 / 下载。 */
export async function shareDailyCard(
  input: ShareCardInput,
  deps: ShareDeps & { dpr?: number } = {},
): Promise<ShareOutcome> {
  const blob = await renderShareCardPng(input, deps.dpr);
  return shareCardBlob(blob, shareCardFilename(input.date, input.hex), deps);
}
