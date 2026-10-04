import { describe, expect, it } from 'vitest';
import { parseAdminArgs, UsageError } from '../argv';

describe('参数解析（node:util.parseArgs，无第三方依赖）', () => {
  it('默认 days=30、不生成 HTML、不显示用户名', () => {
    const args = parseAdminArgs(['stats']);
    expect(args).toMatchObject({
      command: 'stats',
      days: 30,
      htmlPath: undefined,
      includeNames: false,
      help: false,
    });
  });

  it('--days 30 --html out/report.html', () => {
    const args = parseAdminArgs(['stats', '--days', '30', '--html', 'out/report.html']);
    expect(args.days).toBe(30);
    expect(args.htmlPath).toBe('out/report.html');
  });

  it('裸 --html 用默认路径', () => {
    expect(parseAdminArgs(['stats', '--html']).htmlPath).toBe('out/stats-report.html');
  });

  it('--include-names 是布尔开关', () => {
    expect(parseAdminArgs(['stats', '--include-names']).includeNames).toBe(true);
  });

  it('无子命令或 --help 走帮助分支', () => {
    expect(parseAdminArgs([]).help).toBe(true);
    expect(parseAdminArgs(['--help']).help).toBe(true);
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5']])('--days %s 被拒绝', value => {
    expect(() => parseAdminArgs(['stats', '--days', value])).toThrow(UsageError);
  });

  it('未知子命令被拒绝', () => {
    expect(() => parseAdminArgs(['add-badge'])).toThrow(UsageError);
  });
});
