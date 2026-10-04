/**
 * 参数解析：用 Node 内置的 `node:util.parseArgs`，**不引 commander/yargs**。
 *
 * 目前只有一个子命令 `stats`；`add-badge` / `rollback` 属第二阶段（见 `src/addbadge/README.md`）。
 */
import { parseArgs } from 'node:util';

export interface StatsCommand {
  command: 'stats';
  days: number;
  /** 相对路径按 `tools/admin` 解析；undefined 表示不生成 HTML。 */
  htmlPath: string | undefined;
  includeNames: boolean;
  help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `HueDle 本地管理工具（只读统计）

用法：
  tsx src/cli.ts stats [--days <n>] [--html <path>] [--include-names]

选项：
  --days <n>        回看窗口天数，默认 30
  --html <path>     额外生成自包含静态 HTML 报告（默认 out/stats-report.html）
  --include-names   在**终端**显示用户名明细（报告文件永远不含用户名）
  -h, --help        显示本帮助

退出码：0 成功；2 参数错误；3 数据库错误。
本工具不监听任何端口，只连 Postgres 只读事务。`;

/** 允许 `--html` 不带值（用默认路径）：parseArgs 的 string 选项不允许裸标志，这里先补一个默认值。 */
function fillBareHtml(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    out.push(arg);
    if (arg === '--html') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.push('out/stats-report.html');
    }
  }
  return out;
}

export function parseAdminArgs(argv: string[]): StatsCommand {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { command: 'stats', days: 30, htmlPath: undefined, includeNames: false, help: true };
  }
  if (command !== 'stats') {
    throw new UsageError(`未知子命令：${command}（当前只实现 stats）`);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: fillBareHtml(rest),
      options: {
        days: { type: 'string' },
        html: { type: 'string' },
        'include-names': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const { values } = parsed;
  const rawDays = values.days ?? '30';
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days <= 0) {
    throw new UsageError(`--days 必须是正整数，收到：${rawDays}`);
  }
  // 上限纯属防呆：窗口太大对生产库的扫描成本高，也不会有更多结论。
  if (days > 3650) throw new UsageError('--days 不能超过 3650');

  return {
    command: 'stats',
    days,
    htmlPath: values.html,
    includeNames: values['include-names'] === true,
    help: values.help === true,
  };
}
