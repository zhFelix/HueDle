/**
 * 参数解析：用 Node 内置的 `node:util.parseArgs`，**不引 commander/yargs**。
 *
 * 子命令：
 *   - `stats`：只读统计，文本输出（可 `--html` 生成静态报告）；
 *   - `ui`   ：只读统计的本地交互页面（`node:http`，只监听 127.0.0.1，见 `src/ui/`）；
 *   - `add-badge`：加徽章流水线（**提交给 detached 子进程**，CLI/UI 只读状态文件）；
 *   - `rollback` ：按快照手动回滚。
 */
import { parseArgs } from 'node:util';
import { UI_DEFAULT_PORT } from './ui/server';
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from './window';
import { FAMILIES } from './addbadge/spec';

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

export interface AddBadgeCommand {
  command: 'add-badge';
  /** `--spec <file.json>`：结构化 spec 或带 handwritten 的 spec。 */
  specPath: string | undefined;
  /** `--ts <表达式>`：手写路径的快捷方式（需同时给出 --id/--name/--description/--family）。 */
  ts: string | undefined;
  /** `--helper <name>`（可重复）：手写路径干跑要 import 的 private helper **名字**（不是实现）。 */
  helpers: string[];
  id: string | undefined;
  name: string | undefined;
  description: string | undefined;
  family: string | undefined;
  group: string | undefined;
  /** 检出 stale 锁时是否强制接管（上一次没跑完 → 默认拒绝并报告）。 */
  force: boolean;
  /** 是否等管道结束（默认等；`--no-wait` 提交后立即返回）。 */
  wait: boolean;
  /** 只打印当前状态，不提交任何东西。 */
  statusOnly: boolean;
  help: boolean;
}

export interface RollbackCommand {
  command: 'rollback';
  /** 快照目录（status.json 里的 snapshotPath）。 */
  snapshot: string | undefined;
  help: boolean;
}

export type AdminCommand = StatsCommand | UiCommand | AddBadgeCommand | RollbackCommand;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `HueDle 本地管理工具

用法：
  tsx src/cli.ts stats [--days <n>] [--html <path>] [--include-names]
  tsx src/cli.ts ui    [--days <n>] [--port <n>] [--include-names]
  tsx src/cli.ts add-badge --spec <file.json> [--force] [--no-wait]
  tsx src/cli.ts add-badge --spec <badges.json>   # 内容是数组 = 批量（一个事务，只跑一次枚举）
  tsx src/cli.ts add-badge --ts <expr> --id <id> --name <n> --description <d> --family <f>
                           [--group <g>] [--helper <name>]... [--force] [--no-wait]
  tsx src/cli.ts add-badge --status
  tsx src/cli.ts rollback --snapshot <dir>

选项：
  --days <n>        回看窗口天数，默认 30（1–${MAX_WINDOW_DAYS}）
  --html <path>     仅 stats：额外生成自包含静态 HTML 报告（默认 out/stats-report.html）
  --port <n>        仅 ui：监听端口，默认 ${UI_DEFAULT_PORT}（0 = 内核分配空闲端口）
  --include-names   显示用户名明细（默认关闭；ui 里只在页面显示，不写任何文件）
  --spec <path>     仅 add-badge：JSON spec（when 结构化，或 handwritten 手写）。
                    **内容是数组时 = 批量**：N 条一起提交，干跑/枚举/docs/supersession/test
                    对整批只跑一次；整批是一个事务（任意一条失败 → 全部回滚）。
  --ts <expr>       仅 add-badge：手写单表达式（可引用家族文件里已有的 private helper）
  --helper          仅 add-badge：可重复；手写路径干跑要 import 的 private helper 名字
  --id/--name/--description/--family/--group   仅 add-badge --ts：元数据
  --force           仅 add-badge：检出未跑完的管道时强制接管锁（默认拒绝并报告）
  --no-wait         仅 add-badge：提交后立即返回（管道在 detached 子进程里继续跑）
  --status          仅 add-badge：只打印当前状态文件，不提交
  -h, --help        显示本帮助

退出码：0 成功；2 失败但已自动回滚（或参数/spec 错误）；3 全局平衡类失败（**保留现场**）；
        4 回滚本身失败（工作区未完全还原）；5 疑似部署环境，拒绝启动；
        6 已有管道在跑，拒绝并发；7 受影响路径有未提交改动，拒绝开跑；
        8 检出未跑完的管道，需先人工处理（或 --force）。

stats 不监听任何端口。ui 只监听 127.0.0.1（绝不为 0.0.0.0），检测到
NODE_ENV=production / RAILWAY_* / 外部 PORT 时拒绝启动。
add-badge 的管道**永远跑在 detached 子进程里**：浏览器/终端断开都不会让仓库停在半写状态。`;

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

function parseAddBadgeCommand(rest: string[]): AddBadgeCommand {
  let values;
  try {
    values = parseArgs({
      args: rest,
      options: {
        spec: { type: 'string' },
        ts: { type: 'string' },
        'helper': { type: 'string', multiple: true, default: [] },
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        family: { type: 'string' },
        group: { type: 'string' },
        force: { type: 'boolean', default: false },
        'no-wait': { type: 'boolean', default: false },
        status: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }).values;
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  if (values.family !== undefined && !(FAMILIES as readonly string[]).includes(values.family)) {
    throw new UsageError(`--family 必须是 ${FAMILIES.join('/')} 之一，收到：${values.family}`);
  }
  if (values.group !== undefined && values.group.trim() === '') {
    throw new UsageError('--group 不能是空串（不要用 group 就直接省略它）');
  }
  return {
    command: 'add-badge',
    specPath: values.spec,
    ts: values.ts,
    helpers: values['helper'] ?? [],
    id: values.id,
    name: values.name,
    description: values.description,
    family: values.family,
    group: values.group,
    force: values.force === true,
    wait: values['no-wait'] !== true,
    statusOnly: values.status === true,
    help: values.help === true,
  };
}

function parseRollbackCommand(rest: string[]): RollbackCommand {
  let values;
  try {
    values = parseArgs({
      args: rest,
      options: {
        snapshot: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }).values;
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  return { command: 'rollback', snapshot: values.snapshot, help: values.help === true };
}

export function parseAdminArgs(argv: string[]): AdminCommand {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { command: 'stats', days: DEFAULT_WINDOW_DAYS, htmlPath: undefined, includeNames: false, help: true };
  }
  // `pnpm run <script> -- --spec x` 会把分隔符 `--` 原样传下来（pnpm 12 实测），
  // 而文档里推荐的就是这种写法——这里吃掉它，避免它被当成位置参数报错。
  const args = rest[0] === '--' ? rest.slice(1) : rest;
  if (command === 'stats') return parseStatsCommand(args);
  if (command === 'ui') return parseUiCommand(args);
  if (command === 'add-badge') return parseAddBadgeCommand(args);
  if (command === 'rollback') return parseRollbackCommand(args);
  throw new UsageError(`未知子命令：${command}（已实现 stats / ui / add-badge / rollback）`);
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
