/**
 * 部署环境探测：**检测到部署迹象就拒绝启动**（docs/ADMIN.md §1.5）。
 *
 * 为什么要有这一层：`ui` 子命令会起一个 HTTP 服务，它连的是**生产库**、
 * 零认证、页面里含用户名与每日颜色。它唯一的安全前提是"只在这台开发机上跑"。
 * 一个忘记删掉的 npm script、一次 `railway up`、或者平台注入的 `PORT`
 * 都可能让它上线；所以这里宁可误拒，也不误开。
 *
 * 判定顺序（任一命中即拒绝）：
 *   1. `NODE_ENV === 'production'`；
 *   2. 任何 `RAILWAY_*` / `FLY_*` 前缀，或 `RENDER` / `DYNO` 键；
 *   3. 外部设置的 `PORT`（Railway 等平台会注入）——本服务**不读** `PORT`，
 *      端口只由 `--port` 指定，所以 `PORT` 存在本身就说明"这是被平台启动的"。
 *
 * 本模块是**纯函数**（接收 env 对象而不是直接读 `process.env`），因此可被秒级单测覆盖。
 */

/** 只关心字符串值的 env 视图（`process.env` 与测试注入的对象都满足）。 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** 命中即拒绝的前缀（平台注入的变量族）。 */
export const DEPLOY_ENV_PREFIXES = ['RAILWAY_', 'FLY_'] as const;

/** 命中即拒绝的精确键。 */
export const DEPLOY_ENV_KEYS = ['RENDER', 'DYNO'] as const;

/** `ui` 子命令因疑似部署环境而拒绝启动时的退出码（与 2=参数错、3=数据库错区分开）。 */
export const EXIT_DEPLOYMENT_REFUSED = 5;

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

/**
 * 返回拒绝启动的**明确原因**；可以安全启动时返回 `undefined`。
 *
 * 返回值会被原样打印到 stderr，所以它必须说明"检测到了什么"以及"因此不启动"。
 */
export function findDeploymentReason(env: EnvLike): string | undefined {
  if (env.NODE_ENV === 'production') {
    return '检测到 NODE_ENV=production：本服务是本地只读工具（连生产库、零认证），绝不部署。';
  }

  const prefixed = DEPLOY_ENV_PREFIXES.flatMap(prefix =>
    Object.keys(env)
      .filter(key => key.startsWith(prefix))
      .map(key => ({ key, prefix })),
  )[0];
  if (prefixed) {
    return `检测到部署平台环境变量 ${prefixed.key}（${prefixed.prefix}*）：本服务只允许在本机运行。`;
  }

  const keyed = DEPLOY_ENV_KEYS.find(key => nonEmpty(env[key]));
  if (keyed) {
    return `检测到部署平台环境变量 ${keyed}=${env[keyed]}：本服务只允许在本机运行。`;
  }

  if (nonEmpty(env.PORT)) {
    return (
      `检测到外部设置的 PORT=${env.PORT}（Railway 等平台会注入）：`
      + '本服务不读 PORT，端口只由 --port 指定，因此拒绝启动。'
    );
  }

  return undefined;
}
