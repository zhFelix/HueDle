/**
 * 参数解析：用 Node 内置的 `node:util.parseArgs`，**不引 commander/yargs**。
 *
 * 子命令：
 *   - `stats`：只读统计，文本输出（可 `--html` 生成静态报告）；
 *   - `ui`   ：只读统计的本地交互页面（`node:http`，只监听 127.0.0.1，见 `src/ui/`）。
 *
 * `add-badge` / `rollback` 属第二阶段（见 `src/addbadge/README.md`）。
 */
import { parseArgs } from 'node:util';
import { UI_DEFAULT_PORT } from './ui/server';
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from './window';

export interface StatsCommand {
  command: 'stats';
  days: number;
  /** 相对路径按 `tools/admin` 解析；undefined 表示不生成 HTML。 */
  htmlPath: string | undefined;
  includeNames: boolean;
  help: boolean;
}

export interface UiCommand {
  command: 'ui';
  days: number;
  /** 监听端口；0 = 让内核分配空闲端口。地址永远是 127.0.0.1，不可配置。 */
  port: number;
  includeNames: boolean;
  help: boolean;
}

export type AdminCommand = StatsCommand | UiCommand;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `HueDle 本地管理工具（只读统计）

用法：
  tsx src/cli.ts stats [--days <n>] [--html <path>] [--include-names]
  tsx src/cli.ts ui    [--days <n>] [--port <n>] [--include-names]

选项：
  --days <n>        回看窗口天数，默认 30（1–${MAX_WINDOW_DAYS}）
  --html <path>     仅 stats：额外生成自包含静态 HTML 报告（默认 out/stats-report.html）
  --port <n>        仅 ui：监听端口，默认 ${UI_DEFAULT_PORT}（0 = 内核分配空闲端口）
  --include-names   显示用户名明细（默认关闭；ui 里只在页面显示，不写任何文件）
  -h, --help        显示本帮助

退出码：0 成功；2 参数错误；3 数据库错误；5 疑似部署环境，拒绝启动。

stats 不监听任何端口。ui 只监听 127.0.0.1（绝不为 0.0.0.0），只有 GET 路由，
无登录、无 CORS、无写端点，检测到 NODE_ENV=production / RAILWAY_* / 外部 PORT 时拒绝启动。`;

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

/** `--days` 校验：正整数，上限见 {@link MAX_WINDOW_DAYS}（防呆，不是安全边界）。 */
export function parseDaysOption(rawDays: string): number {
  if (!/^\d+$/.test(rawDays)) {
    throw new UsageError(`--days 必须是正整数，收到：${rawDays}`);
  }
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days <= 0) {
    throw new UsageError(`--days 必须是正整数，收到：${rawDays}`);
  }
  if (days > MAX_WINDOW_DAYS) throw new UsageError(`--days 不能超过 ${MAX_WINDOW_DAYS}`);
  return days;
}

/** `--port` 校验：0（内核分配）到 65535 的整数。 */
export function parsePortOption(rawPort: string): number {
  if (!/^\d+$/.test(rawPort)) {
    throw new UsageError(`--port 必须是 0–65535 的整数，收到：${rawPort}`);
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port 必须是 0–65535 的整数，收到：${rawPort}`);
  }
  return port;
}

function parseStatsCommand(rest: string[]): StatsCommand {
  let values;
  try {
    values = parseArgs({
      args: fillBareHtml(rest),
      options: {
        days: { type: 'string' },
        html: { type: 'string' },
        'include-names': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }).values;
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const rawDays = values.days ?? String(DEFAULT_WINDOW_DAYS);
  return {
    command: 'stats',
    days: parseDaysOption(rawDays),
    htmlPath: values.html,
    includeNames: values['include-names'] === true,
    help: values.help === true,
  };
}

function parseUiCommand(rest: string[]): UiCommand {
  let values;
  try {
    values = parseArgs({
      args: rest,
      options: {
        days: { type: 'string' },
        port: { type: 'string' },
        'include-names': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }).values;
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  return {
    command: 'ui',
    days: parseDaysOption(values.days ?? String(DEFAULT_WINDOW_DAYS)),
    port: parsePortOption(values.port ?? String(UI_DEFAULT_PORT)),
    includeNames: values['include-names'] === true,
    help: values.help === true,
  };
}

export function parseAdminArgs(argv: string[]): AdminCommand {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { command: 'stats', days: DEFAULT_WINDOW_DAYS, htmlPath: undefined, includeNames: false, help: true };
  }
  if (command === 'stats') return parseStatsCommand(rest);
  if (command === 'ui') return parseUiCommand(rest);
  throw new UsageError(`未知子命令：${command}（已实现 stats / ui）`);
}
