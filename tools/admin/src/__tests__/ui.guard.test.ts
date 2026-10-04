/**
 * 硬约束②「部署环境下拒绝启动」的测试。
 *
 * 三层：
 *   1. 纯函数 `findDeploymentReason()` 逐条判定（快、精确）；
 *   2. `main()` 注入 env，断言返回**非零退出码**且 stderr 说明了原因；
 *   3. 真子进程（`tsx src/cli.ts ui`）断言真实进程退出码非 0 —— 证明第 2 层
 *      确实接到了 `process.exitCode` 上，而不只是"函数返回值好看"。
 *
 * 三种注入都是**在监听之前**被拦下的，所以这些用例不会起任何服务（CI 安全）。
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ROOT, main } from '../cli';
import { EXIT_DEPLOYMENT_REFUSED, findDeploymentReason } from '../ui/guard';

const run = promisify(execFile);

describe('findDeploymentReason：只拒绝部署迹象', () => {
  it('干净环境（只有普通变量）不拒绝', () => {
    expect(findDeploymentReason({})).toBeUndefined();
    expect(findDeploymentReason({ NODE_ENV: 'development', HOME: '/Users/x' })).toBeUndefined();
    expect(findDeploymentReason({ NODE_ENV: 'test', PATH: '/usr/bin' })).toBeUndefined();
  });

  it('NODE_ENV=production → 拒绝，原因点名 NODE_ENV', () => {
    const reason = findDeploymentReason({ NODE_ENV: 'production' });
    expect(reason).toContain('NODE_ENV=production');
  });

  it('任何 RAILWAY_ 前缀 → 拒绝，原因点名具体变量', () => {
    const reason = findDeploymentReason({ RAILWAY_ENVIRONMENT: 'production' });
    expect(reason).toContain('RAILWAY_ENVIRONMENT');
    expect(reason).toContain('RAILWAY_');
    expect(findDeploymentReason({ RAILWAY_SERVICE_ID: 'abc' })).toContain('RAILWAY_SERVICE_ID');
  });

  it('外部设置的 PORT → 拒绝，原因点名 PORT', () => {
    const reason = findDeploymentReason({ PORT: '8080' });
    expect(reason).toContain('PORT');
    expect(reason).toContain('8080');
    expect(reason).toContain('--port');
  });

  it('RENDER / DYNO / FLY_* 同样拒绝（docs/ADMIN.md §1.5）', () => {
    expect(findDeploymentReason({ RENDER: 'true' })).toContain('RENDER');
    expect(findDeploymentReason({ DYNO: 'web.1' })).toContain('DYNO');
    expect(findDeploymentReason({ FLY_APP_NAME: 'huedle' })).toContain('FLY_APP_NAME');
  });

  it('空串与未设置等价（不误判）', () => {
    expect(findDeploymentReason({ PORT: '', NODE_ENV: '', RENDER: '' })).toBeUndefined();
  });
});

describe('main()：注入部署环境 → 非零退出码 + 说明原因', () => {
  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }, 'NODE_ENV=production'],
    ['RAILWAY_ENVIRONMENT=x', { RAILWAY_ENVIRONMENT: 'x' }, 'RAILWAY_ENVIRONMENT'],
    ['外部 PORT', { PORT: '9999' }, 'PORT'],
  ])('%s', async (_name, env, expected) => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(message => {
      errors.push(String(message));
    });
    let code: number;
    try {
      code = await main(['ui', '--days', '30'], { env });
    } finally {
      spy.mockRestore();
    }

    expect(code).not.toBe(0);
    expect(code).toBe(EXIT_DEPLOYMENT_REFUSED);
    const stderr = errors.join('\n');
    expect(stderr).toContain('拒绝启动');
    expect(stderr).toContain(expected);
    // 拒绝发生在连库之前：不应该出现"数据库错误"。
    expect(stderr).not.toContain('数据库错误');
  });
});

describe('真子进程：NODE_ENV=production 时退出码非 0', () => {
  it('tsx src/cli.ts ui → exitCode !== 0 且 stderr 说明原因', async () => {
    let code = 0;
    let stderr = '';
    try {
      await run(resolve(ADMIN_ROOT, 'node_modules/.bin/tsx'), ['src/cli.ts', 'ui', '--days', '30'], {
        cwd: ADMIN_ROOT,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 60_000,
      });
    } catch (err) {
      const failure = err as { code?: number; stderr?: string };
      code = typeof failure.code === 'number' ? failure.code : 1;
      stderr = failure.stderr ?? '';
    }

    expect(code).not.toBe(0);
    expect(stderr).toContain('拒绝启动');
    expect(stderr).toContain('NODE_ENV=production');
    // 没有监听、没有连库。
    expect(stderr).not.toContain('http://127.0.0.1');
  }, 60_000);
});
