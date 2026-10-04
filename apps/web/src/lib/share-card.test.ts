/**
 * 分享卡片测试（见 docs/DESIGN.md 第 15 节）。
 *
 * 布局层是纯函数，断言直接打在**绘制指令数组**上——jsdom 不实现 Canvas，
 * 但这一层根本不需要 ctx。绘制层（真正 fillText）不在这里测，
 * 由浏览器里导出的 PNG 负责验收。
 */
import { describe, expect, it, vi } from 'vitest';
import { formatCp } from './format';
import { RARITY_ORDER, rarityStyle } from './rarity';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GUIDANCE_TEXT,
  MAX_BADGES,
  SITE_ADDRESS,
  createShareCanvas,
  estimateTextWidth,
  layoutShareCard,
  resolveDpr,
  shareCardBlob,
  shareCardFilename,
  truncateText,
  type DrawCommand,
  type ShareCardInput,
} from './share-card';

const BASE: ShareCardInput = {
  hex: '#002FA7',
  cp: 1_790_000_000,
  rarity: 'mythic',
  badges: [{ name: '纯蓝' }, { name: '极值' }],
  date: '2026-10-03',
};

/** 把指令里的文字拼起来，方便断言「画了什么」。 */
function textsOf(commands: DrawCommand[]): string {
  return commands
    .filter((c): c is Extract<DrawCommand, { type: 'text' }> => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

function colorsOf(commands: DrawCommand[]): string[] {
  return commands.map(c => c.color);
}

describe('① 布局包含必需内容', () => {
  it('HEX / 日期 / CP / 稀有度中文名 / 徽章名 / 引导语 / 站点地址都在指令里', () => {
    const { commands } = layoutShareCard(BASE);
    const texts = textsOf(commands);

    expect(texts).toContain('#002FA7');
    expect(texts).toContain('2026-10-03');
    expect(texts).toContain(formatCp(BASE.cp));
    expect(texts).toContain(rarityStyle('mythic').label);
    expect(texts).toContain('纯蓝');
    expect(texts).toContain(GUIDANCE_TEXT);
    expect(texts).toContain(SITE_ADDRESS);
  });

  it('大色块用的就是今日 hex（矩形填充色）', () => {
    const { commands } = layoutShareCard(BASE);
    const rects = commands.filter(c => c.type === 'rect');
    expect(rects.some(r => r.color === BASE.hex && r.w === CARD_WIDTH - 160)).toBe(true);
  });

  it('逻辑尺寸是 1080×1350', () => {
    const layout = layoutShareCard(BASE);
    expect(layout.width).toBe(1080);
    expect(layout.height).toBe(1350);
  });
});

describe('② 徽章过多时折叠', () => {
  const many: ShareCardInput = {
    ...BASE,
    badges: Array.from({ length: 20 }, (_, i) => ({ name: `徽章${i + 1}` })),
  };

  it('只画前 MAX_BADGES 枚，折叠提示写的是「还有 14 枚」（剩余数，不是总数）', () => {
    const texts = textsOf(layoutShareCard(many).commands);

    for (let i = 1; i <= MAX_BADGES; i++) {
      expect(texts, `第 ${i} 枚应被画出来`).toContain(`徽章${i}\n`);
    }
    expect(texts).not.toContain(`徽章${MAX_BADGES + 1}`);
    // 20 枚总数、画了 6 枚 → 还剩 14 枚。写总数会让人以为一共 20+ 枚。
    expect(texts).toContain('还有 14 枚');
    expect(texts).not.toContain('等 20 枚');
  });

  it('徽章不超限时不出现折叠字样', () => {
    const texts = textsOf(layoutShareCard(BASE).commands);
    expect(texts).not.toContain('还有 ');
  });
});

describe('③ 超长徽章名截断', () => {
  const longName = '这是一个非常非常非常长的徽章名字用来测试截断逻辑是否正常工作';

  it('布局层把长名字截断并补省略号', () => {
    const { commands } = layoutShareCard({ ...BASE, badges: [{ name: longName }] });
    const drawn = textsOf(commands)
      .split('\n')
      .find(t => t.startsWith('这是一个'));

    expect(drawn).toBeDefined();
    expect(drawn?.endsWith('…')).toBe(true);
    expect(drawn?.length).toBeLessThan(longName.length);
  });

  it('truncateText 直接可测：不超宽原样返回，超宽带省略号', () => {
    expect(truncateText('纯蓝', 200, 32)).toBe('纯蓝');
    const cut = truncateText(longName, 200, 32);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateTextWidth(cut, 32)).toBeLessThanOrEqual(200);
  });

  it('estimateTextWidth 单独导出：中文比同字号拉丁宽', () => {
    expect(estimateTextWidth('中', 32)).toBeGreaterThan(estimateTextWidth('a', 32));
    expect(estimateTextWidth('', 32)).toBe(0);
  });
});

describe('④ 同稀有度用同一套代表色', () => {
  it('卡片用的强调色就是 lib/rarity.ts 的 accent（不写死色值）', () => {
    for (const rarity of RARITY_ORDER) {
      const { commands } = layoutShareCard({ ...BASE, rarity });
      expect(colorsOf(commands), `${rarity} 缺少代表色`).toContain(rarityStyle(rarity).accent);
      // 稀有度名字也用同一色
      const label = commands.find(
        c => c.type === 'text' && c.text === rarityStyle(rarity).label,
      );
      expect(label?.color).toBe(rarityStyle(rarity).accent);
    }
  });

  it('7 档代表色两两不同（防止误抄同一个值）', () => {
    const accents = RARITY_ORDER.map(r => rarityStyle(r).accent);
    expect(new Set(accents).size).toBe(RARITY_ORDER.length);
  });
});

describe('⑤ 画布尺寸按 devicePixelRatio 放大', () => {
  it('dpr=2 → 实际像素 2160×2700', () => {
    const { canvas } = createShareCanvas(2);
    expect(canvas.width).toBe(2160);
    expect(canvas.height).toBe(2700);
  });

  it('dpr=3 → 3240×4050；dpr 低于 2 被钳到 2', () => {
    expect(createShareCanvas(3).canvas.width).toBe(CARD_WIDTH * 3);
    expect(createShareCanvas(1).canvas.width).toBe(CARD_WIDTH * 2);
    expect(resolveDpr(1)).toBe(2);
    expect(resolveDpr(2)).toBe(2);
    expect(resolveDpr(4)).toBe(4);
  });

  it('jsdom 没有 Canvas：getContext 返回 null，但不抛异常、尺寸照设', () => {
    const { canvas, ctx } = createShareCanvas(2);
    expect(ctx).toBeNull();
    expect(canvas.height).toBe(CARD_HEIGHT * 2);
  });
});

describe('⑥ 分享降级', () => {
  const blob = new Blob(['png-bytes'], { type: 'image/png' });
  const filename = 'huedle-2026-10-03-002fa7.png';

  it('navigator.share 可用且 canShare 为真 → 走系统分享，不下载', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const download = vi.fn();

    const outcome = await shareCardBlob(blob, filename, {
      nav: { share, canShare },
      download,
    });

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect(canShare).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
  });

  it('navigator.share 不存在 → 走下载分支', async () => {
    const download = vi.fn();
    const outcome = await shareCardBlob(blob, filename, { nav: {}, download });

    expect(outcome).toBe('downloaded');
    expect(download).toHaveBeenCalledWith(blob, filename);
  });

  it('canShare 为假 → 同样降级到下载', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();
    const outcome = await shareCardBlob(blob, filename, {
      nav: { share, canShare: () => false },
      download,
    });

    expect(outcome).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('文件名规则：huedle-<日期>-<hex>.png', () => {
    expect(shareCardFilename('2026-10-03', '#002FA7')).toBe(filename);
  });
});

describe('⑦ 用户取消不报错', () => {
  const blob = new Blob(['png-bytes'], { type: 'image/png' });

  it('share 抛 AbortError → 返回 cancelled，不下载、不抛', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abort);
    const download = vi.fn();

    await expect(
      shareCardBlob(blob, 'a.png', { nav: { share, canShare: () => true }, download }),
    ).resolves.toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('非取消失败仍然抛出（交给调用方兜底，不被当成取消吞掉）', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      shareCardBlob(blob, 'a.png', { nav: { share, canShare: () => true } }),
    ).rejects.toThrow('boom');
  });
});
