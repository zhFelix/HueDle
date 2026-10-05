/**
 * 徽章源码指纹 ↔ `pricing.gen.ts` 新鲜度。
 *
 * 这一组断言回答的是一个**默认测试以前答不了**的问题：
 * 「`check` 改了，但枚举没重跑」——`pricing.gen.ts` 是生成文件，
 * `registry.test.ts` / `casino.test.ts` 对它的校验全是自洽的（详见
 * `src/badgeSourceFingerprint.ts` 的模块头注释），唯一做完整交叉校验的
 * `scripts/supersession.test.ts` 又不在默认套件里。
 *
 * 这里用**源文件文本指纹**把它变成默认套件能发现的红：枚举把生成时的指纹写进
 * `pricing.gen.ts` 的 `SOURCE_FINGERPRINT`，本文件重算比对。
 */
import { describe, expect, it } from 'vitest';

import {
  FINGERPRINT_STALE_MESSAGE,
  computeBadgeSourceFingerprint,
  fingerprintSourceEntries,
  listFingerprintedBadgeFiles,
  readBadgeSourceEntries,
  stripNonInfluentialText,
} from '../../badgeSourceFingerprint';
import { SOURCE_FINGERPRINT } from '../../pricing.gen';
import { allBadgeDefs } from '../defs';

/**
 * 期望被指纹覆盖的家族文件，**从徽章表推导**（`def.family` 与文件名一致，这是
 * `ADD-BADGE.md` 的字段约束，也由既有测试锁着）。不写死名单——新增家族时这里
 * 自动跟随，漏收某个家族文件会让下面的集合相等断言变红。
 */
const FAMILY_FILES = [...new Set(allBadgeDefs.map(def => def.family))]
  .map(family => `${family}.ts`)
  .sort();

/** 把源码里的实现改一个字符，用来证明指纹对实现敏感。 */
function mutateImplementation(text: string): string {
  const flipped = text.replace('===', '!==');
  if (flipped !== text) return flipped;
  // 少数文件没有 `===`（例如 perception.ts），退回到同样改真实代码的替换。
  return text.replace('const ', 'let ');
}

/**
 * 把 `name` / `description` 的**文案内容**整体换掉（保持键与结构不变），
 * 用来证明「改文案不用重跑枚举」。
 *
 * 只匹配「键与值同一行」和「键行 + 下一行值」两种真实存在的写法；
 * 其余写法不动（本用例会断言替换次数 > 0，避免空转）。
 */
function rewriteCopyWithMarker(source: string): { text: string; count: number } {
  let count = 0;
  const text = source.replace(
    /((?:^|\n)[ \t]*(?:name|description)[ \t]*:(?:[ \t]*\n[ \t]*)?)(?:'[^'\n]*'|"[^"\n]*")/g,
    (_match, head: string) => {
      count++;
      return `${head}'改过的文案'`;
    },
  );
  return { text, count };
}

describe('徽章源码指纹 → pricing.gen.ts 新鲜度', () => {
  it('SOURCE_FINGERPRINT 与当前徽章源码一致（不一致说明生成文件已过期）', () => {
    const current = computeBadgeSourceFingerprint();
    expect(current, FINGERPRINT_STALE_MESSAGE).toBe(SOURCE_FINGERPRINT);
  });

  it('覆盖全部家族文件 + helpers.ts；排除组装文件、文档渲染与测试', () => {
    const files = listFingerprintedBadgeFiles();
    // 集合相等（不只是「包含」）：漏收某个家族文件、或把不该收的文件收进来，都会红。
    expect([...files].sort()).toEqual([...FAMILY_FILES, 'helpers.ts'].sort());
    expect(files).toContain('helpers.ts');
    // helpers.ts 是所有家族共用的判定函数库，改它确实会改 hits → 必须在指纹内。
    expect(files).not.toContain('index.ts');
    expect(files).not.toContain('defs.ts');
    expect(files).not.toContain('renderDoc.ts');
    expect(files).not.toContain('helpers.test.ts');
    expect(files.every(name => name.endsWith('.ts'))).toBe(true);
  });

  it('确定性：连续两次相同；条目顺序（含倒序、轮转）不影响结果', () => {
    const entries = readBadgeSourceEntries();
    const first = fingerprintSourceEntries(entries);
    expect(fingerprintSourceEntries(entries)).toBe(first);
    expect(first).toBe(computeBadgeSourceFingerprint());
    expect(first).toHaveLength(64);
    expect(fingerprintSourceEntries([...entries].reverse())).toBe(first);
    const rotated = [...entries.slice(3), ...entries.slice(0, 3)];
    expect(fingerprintSourceEntries(rotated)).toBe(first);
  });

  it('敏感：任一参与文件（含 helpers.ts）的实现改一个字符都会改指纹', () => {
    const entries = readBadgeSourceEntries();
    const base = fingerprintSourceEntries(entries);
    for (const target of [...FAMILY_FILES, 'helpers.ts']) {
      const mutated = entries.map((entry) => {
        if (entry.path !== target) return entry;
        const text = mutateImplementation(entry.text);
        // 先证明这次变异真的改到了文本，否则本循环是空转
        expect(text, `${target} 里没有可变异的位置`).not.toBe(entry.text);
        return { ...entry, text };
      });
      expect(fingerprintSourceEntries(mutated), `${target} 改动后指纹应当变化`).not.toBe(base);
    }
  });

  it('敏感：新增 / 删除 / 改名文件都会改指纹', () => {
    const entries = readBadgeSourceEntries();
    const base = fingerprintSourceEntries(entries);
    const removed = entries.slice(1);
    expect(fingerprintSourceEntries(removed)).not.toBe(base);
    const renamed = entries.map((entry, index) =>
      index === 0 ? { ...entry, path: 'renamed-family.ts' } : entry,
    );
    expect(fingerprintSourceEntries(renamed)).not.toBe(base);
  });

  it('文案：name / description 改动不触发指纹变化（改文案不用重跑枚举）', () => {
    const entries = readBadgeSourceEntries();
    const base = fingerprintSourceEntries(entries);

    let replacements = 0;
    const rewritten = entries.map((entry) => {
      const { text, count } = rewriteCopyWithMarker(entry.text);
      replacements += count;
      return { ...entry, text };
    });

    expect(replacements, '本用例必须真的改到文案，否则是空转').toBeGreaterThan(0);
    expect(rewritten.map(e => e.text)).not.toEqual(entries.map(e => e.text));
    expect(fingerprintSourceEntries(rewritten)).toBe(base);
  });

  it('文案剔除：真实语料里所有 name / description 都被剔净', () => {
    for (const entry of readBadgeSourceEntries()) {
      const stripped = stripNonInfluentialText(entry.text);
      expect(stripped, `${entry.path} 里仍有未剔除的 name/description`).not.toMatch(
        /^[ \t]*(?:name|description)[ \t]*:/m,
      );
      // 剔除后仍保留 check 行（不能把实现一起吃掉）
      if (entry.text.includes('check')) expect(stripped).toContain('check');
    }
  });

  it('文案剔除：覆盖单行 / 续行 / 多行模板串；拿不准的写法一律保留', () => {
    const sample = [
      'export const xs = [',
      '  {',
      "    id: 'a',",
      "    name: '甲',",
      '    description:',
      "      '续行写法',",
      '    check: c => c.r === 0,',
      '  },',
      '  {',
      "    id: 'b',",
      '    name: `模板',
      "     含插值 ${SOME_CONST}`,",
      '    check: c => c.g === 0,',
      '  },',
      '  {',
      "    id: 'c',",
      '    name: SOME_CONST,',
      "    description: 'a' + 'b',",
      '    check: c => c.b === 0,',
      '  },',
      '];',
    ].join('\n');

    const stripped = stripNonInfluentialText(sample);
    // 单行与续行写法被剔除
    expect(stripped).not.toContain("'甲'");
    expect(stripped).not.toContain('续行写法');
    // 含插值的模板串：拿不准 → 整段保留（fail-closed）
    expect(stripped).toContain('name: `模板');
    expect(stripped).toContain('含插值 ${SOME_CONST}');
    // 标识符取值、拼接取值：保留
    expect(stripped).toContain('name: SOME_CONST');
    expect(stripped).toContain("description: 'a' + 'b'");
    // 实现部分一行不少
    expect(stripped).toContain('check: c => c.r === 0');
    expect(stripped).toContain('check: c => c.g === 0');
    expect(stripped).toContain('check: c => c.b === 0');

    // 只有文案不同 → 剔除结果完全相同
    const changedCopy = sample.replace("'甲'", "'乙'").replace('续行写法', '另一种说法');
    expect(changedCopy).not.toBe(sample);
    expect(stripNonInfluentialText(changedCopy)).toBe(stripped);

    // 拿不准的写法若真的变了，指纹必须跟着变（fail-closed 的方向）
    const changedUncertain = sample.replace('SOME_CONST', 'OTHER_CONST');
    expect(stripNonInfluentialText(changedUncertain)).not.toBe(stripped);
  });
});
