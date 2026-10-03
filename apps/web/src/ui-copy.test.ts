/**
 * UI 文案红线检查（规则见 docs/UI-COPY.md）。
 *
 * 为什么要有这条测试：文案问题是**会反复复发**的——每次都有人"顺手解释一下机制"，
 * 而它不会让测试变红、不会报错，只会在玩家那里显得啰嗦和居高临下。
 * 靠纪律复查没用，得让机器拦。
 *
 * 只扫 `<template>` 块：`<script>` 里的注释**应该**讨论机制（那是给维护者看的），
 * 渲染出去的文字才受约束。
 */
import { describe, expect, it } from 'vitest';

/** 所有 SFC 的原始文本（Vite 的 `?raw` 导入，不碰文件系统、不需要 @types/node）。 */
const SFC_RAW = import.meta.glob('./**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 永远不该出现在界面上的措辞。
 *
 * 分三类（详细理由见 docs/UI-COPY.md）：
 *   - 解释一个玩家没问、也不存在的功能；
 *   - 背诵规则与禁令；
 *   - 把内部实现（类型名、函数名、算法）泄漏到界面上。
 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  // ① 解释机制 / 解释一个不存在的功能
  [/不并入|并入账户|合并到账户/, '解释「历史迁移」——一个我们没做、玩家也没问的功能'],
  [/两种模式抽到|不同的颜色/, '解释两种模式为何颜色不同（实现细节）'],
  [/每个身份每天一次|切换身份/, '背诵内部规则'],
  [/本地模式|登录模式/, '内部模式名——用「已登录 / 未登录」这类状态词'],

  // ② 背诵禁令 / 免责
  [/不能重抽|不能购买|不能追加/, '背诵禁令'],
  [/刷新不变/, '背诵规则——玩家自己会发现'],
  [/不是货币/, '没人会误解的免责声明'],

  // ③ 内部实现泄漏
  [/服务端|保存在/, '实现细节——玩家关心「换设备能不能看到」，不关心存在哪'],
  [/localStorage|sessionStorage/, '存储实现'],
  [/badgeIds|HistoryItem|restoreScore/, '内部类型 / 字段名'],
  [/useDailyColor|useHistory|useBadges|getDaily/, '内部函数名'],
  [/全色域|枚举|2²⁴|ep\s*=|fnv1a/i, '内部算法'],
];

/**
 * 取出顶层 `<template>` 块，**并剥掉 HTML 注释**。
 *
 * 用行首锚点，避免被缩进的嵌套 `<template v-if>` 干扰。
 * 注释必须剥掉：模板注释与 `<script>` 注释一样是写给维护者的，
 * 里面正当地讨论「本地模式 / 登录模式 / 存储键」，不该受文案规则约束。
 */
function templateOf(source: string): string | null {
  const m = /^<template>[\s\S]*?^<\/template>/m.exec(source);
  if (!m) return null;
  return m[0].replace(/<!--[\s\S]*?-->/g, '');
}

describe('UI 文案红线', () => {
  const entries = Object.entries(SFC_RAW)
    .map(([path, source]) => [path, templateOf(source)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null);

  it('扫描范围非空（防止 glob 失效导致这条测试变成恒真）', () => {
    expect(entries.length, '没扫到任何 .vue 模板，检查 import.meta.glob').toBeGreaterThan(5);
  });

  it('界面文案不含解释机制 / 背诵规则 / 内部实现的措辞', () => {
    const hits: string[] = [];
    for (const [path, template] of entries) {
      // 逐行检查，报错信息里能给出具体行号与原文
      template.split('\n').forEach((line, i) => {
        for (const [pattern, why] of FORBIDDEN) {
          if (pattern.test(line)) {
            hits.push(`${path}:${i + 1}  [${why}]\n      ${line.trim()}`);
          }
        }
      });
    }
    expect(hits, `界面文案踩了红线（见 docs/UI-COPY.md）：\n  ${hits.join('\n  ')}`).toEqual([]);
  });
});
