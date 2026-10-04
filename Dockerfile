# HueDle API —— Railway / 任意容器平台
#
# 为什么不用 Nixpacks 自动检测：这是 pnpm monorepo，API 依赖 workspace 里的
# `@huedle/shared`，自动检测容易只装 apps/api 一个包、拿不到 workspace 链接。
# 显式 Dockerfile 更可控。
#
# 用 Node 24：代码用了 `process.loadEnvFile()`（20.12+ 才有）。CI 已在
# Node 24 + Linux 上跑通全部 52 个 api 测试，所以运行环境本身是验证过的。

FROM node:24-slim

# 固定 pnpm 版本，与根 package.json 的 packageManager 一致。
# 不用 corepack：Node 25 起已移除，现在开始用是给自己埋雷。
RUN npm install -g pnpm@12.8.1

WORKDIR /app

# 先只复制清单文件：依赖没变时这层能命中缓存，不必每次重装。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# tools/admin 是**只在本地跑的**管理工具，但它是个 workspace 包，
# lockfile 里有它的 importer；不 COPY 清单的话 `--frozen-lockfile` 会以
# ERR_PNPM_OUTDATED_LOCKFILE 失败，**整个 Railway 构建挂掉**。
# 只 COPY 清单（26 行），它的源码由 .dockerignore 挡住，不进镜像。
COPY tools/admin/package.json tools/admin/

# 必须装 devDependencies：`tsx` 在 devDependencies 里，而运行时要靠它。
#   `@huedle/shared` 的相对 import 不带扩展名，Node 原生 ESM 解析不了；
#   要么用 tsx，要么给 shared 加构建步骤。这里选前者。
RUN pnpm install --frozen-lockfile

COPY . .

# 文档里说明这是「只读」的部署：建表由 `pnpm -C apps/api migrate` 单独执行，
# 应用启动只做连通性自检，失败就退出，绝不带着坏连接对外服务。

ENV NODE_ENV=production
# Railway 会注入 PORT，这里只是本地 docker run 时的兜底。
ENV PORT=3001
EXPOSE 3001

# 只启动 API。migrate 不放在启动脚本里——多实例同时启动会并发建表。
CMD ["pnpm", "-C", "apps/api", "start"]
