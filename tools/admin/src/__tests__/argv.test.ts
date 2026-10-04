import { describe, expect, it } from 'vitest';
import { parseAdminArgs, UsageError, type StatsCommand, type UiCommand } from '../argv';

/** 断言拿到的是 `stats` 子命令（联合类型收窄，不改动原有断言）。 */
function asStats(argv: string[]): StatsCommand {
  const args = parseAdminArgs(argv);
  if (args.command !== 'stats') throw new Error(`期望 stats，收到 ${args.command}`);
  return args;
}

/** 断言拿到的是 `ui` 子命令。 */
function asUi(argv: string[]): UiCommand {
  const args = parseAdminArgs(argv);
  if (args.command !== 'ui') throw new Error(`期望 ui，收到 ${args.command}`);
  return args;
}

describe('参数解析（node:util.parseArgs，无第三方依赖）', () => {
  it('默认 days=30、不生成 HTML、不显示用户名', () => {
    const args = asStats(['stats']);
    expect(args).toMatchObject({
      command: 'stats',
      days: 30,
      htmlPath: undefined,
      includeNames: false,
      help: false,
    });
  });

  it('--days 30 --html out/report.html', () => {
    const args = asStats(['stats', '--days', '30', '--html', 'out/report.html']);
    expect(args.days).toBe(30);
    expect(args.htmlPath).toBe('out/report.html');
  });

  it('裸 --html 用默认路径', () => {
    expect(asStats(['stats', '--html']).htmlPath).toBe('out/stats-report.html');
  });

  it('--include-names 是布尔开关', () => {
    expect(asStats(['stats', '--include-names']).includeNames).toBe(true);
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

describe('ui 子命令参数', () => {
  it('默认 days=30、port=4321、不显示用户名', () => {
    expect(asUi(['ui'])).toMatchObject({
      command: 'ui',
      days: 30,
      port: 4321,
      includeNames: false,
      help: false,
    });
  });

  it('--days 7 --port 0 --include-names', () => {
    const args = asUi(['ui', '--days', '7', '--port', '0', '--include-names']);
    expect(args.days).toBe(7);
    expect(args.port).toBe(0);
    expect(args.includeNames).toBe(true);
  });

  it('ui 不接受 --html（那个选项只属于 stats）', () => {
    expect(() => parseAdminArgs(['ui', '--html', 'x.html'])).toThrow(UsageError);
  });

  it.each([['0'], ['-1'], ['99999'], ['abc'], ['1.5'], ['1e3']])('--days %s 被拒绝', value => {
    expect(() => parseAdminArgs(['ui', '--days', value])).toThrow(UsageError);
  });

  it.each([['-1'], ['65536'], ['abc'], ['1.5']])('--port %s 被拒绝', value => {
    expect(() => parseAdminArgs(['ui', '--port', value])).toThrow(UsageError);
  });
});
