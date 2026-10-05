# 加徽章流水线（第二阶段）

`docs/ADD-BADGE.md` 是权威流程；本目录是它的**自动化**。设计契约见 `docs/ADMIN.md` §3。

## 架构上最关键的一条

**管道跑在 detached 子进程里，不跑在 HTTP 请求处理器里。**

```
UI / CLI（只读状态文件）  ──提交──▶  子进程（detached，真正跑管道）
                                       │ 进度写
                                       ▼
                             out/addbadge/status.json + pipeline.lock
```

理由：枚举要 ~4.5 分钟，浏览器随时可能刷新/关闭。管道若跑在请求里，浏览器一断
管道就死，仓库会停在半写状态（`pricing.gen.ts` 已改、`docs/BADGES.md` 没改），
而且没有任何东西保证回滚被执行。现在：浏览器/终端断开都不影响子进程，回滚由
子进程自己完成；UI 只**轮询**状态文件（不用 SSE/WebSocket）。

## 文件落位

| 文件 | 职责 |
|---|---|
| `spec.ts` | 条件 spec 的类型 + 手写校验器（不用 zod/ajv） |
| `build.ts` | `toSource()` / `toPredicate()` 两个后端（语义等价有测试） |
| `compile.ts` | 两条路径合流 + 写盘前的静态检查（import / private helper） |
| `families.ts` | 家族文件与 id/name 清单的只读读取（字符串级，不解析 TS） |
| `insert.ts` | 末尾纯插入 + 缩进模板 + 三自检 |
| `dryrun.ts` | 2²⁴ 干跑 + 蕴含/Jaccard 冗余检测（`runDryRun` 单条；`runBatchDryRun` 批量：一次扫描 + **新 vs 新** N×N） |
| `pipeline.ts` | 阶段编排、失败分类、退出码（`runPipeline` 单条；`runBatchPipeline` 批量，共用同一核心） |
| `rollback.ts` | 快照与还原（git 快路径 + 复制兜底 + 证明回到绿） |
| `state.ts` | 状态文件 + 锁（原子写、O_EXCL、stale 检测） |
| `submit.ts` | 抢锁 → 写作业文件 → 拉起 detached 子进程 |
| `child.ts` | 子进程入口（写状态、释放锁） |
| `watch.ts` | 只读状态文件的观察者（CLI `--wait` 与 UI 轮询共用） |
| `commands.ts` | `add-badge` / `rollback` 两个子命令的编排 |

运行时产物（全部在 `out/addbadge/` 下，已被 `out/.gitignore` 的 `*` 挡住）：

- `status.json` —— 阶段、进度、开始时间、最终结论（成功 / 已回滚 / 需人工处理）；
- `pipeline.lock` —— `O_EXCL` 抢锁；已有管道在跑时新提交**被拒绝**，不排队、不并发；
- `snapshots/<runId>/` —— 回滚用的逐字节快照；
- `logs/<runId>.log` —— 子进程的 stdout/stderr；
- `jobs/<runId>.json` —— 提交时冻结的 spec。

## 用法

```bash
# 结构化 spec（when：JSON 表达式，词汇表 = helpers.ts + ColorInfo 字段 + 运算符）
pnpm -C tools/admin run add-badge -- --spec new-badge.json

# 批量：--spec 文件内容是**数组**。N 条一起提交 = 一个事务（全有或全无），
# 干跑/枚举/docs/supersession/test 对整批各只跑一次（N 条 ≈ 10 分钟，不是 N×10）。
pnpm -C tools/admin run add-badge -- --spec badges.json

# 手写路径（一等公民）：单表达式，可引用目标家族文件里**已经存在**的 private helper
pnpm -C tools/admin run add-badge -- --ts "onRanks(c, counts => counts.filter(n => n >= 5).length === 1)" \
  --id casino-e2e-straight --name 测试顺子 --description '恰好一种点数出现 5 次及以上' --family casino \
  --helper-eval "onRanks=color => { const counts = rankCounts(color); return counts !== null && (counts.filter(n => n >= 5).length === 1); }"

pnpm -C tools/admin run add-badge -- --status          # 只看状态，不提交
pnpm -C tools/admin run rollback  -- --snapshot <dir>  # 按快照手动回滚
```

## 批量的语义

- **一个事务**：N 条要么全部落地并跑完流水线，要么整批回滚；不产生「3 成功 2 失败」的半截状态。
- **只跑一次枚举**：`enumerate`（+ md5 幂等复跑）、`docs`、`supersession`、`test` 对整批各一次，与 N 无关。
- **跨文件**：N 条可落在不同家族文件；快照/回滚用 `affectedPathsFor(families)` 的并集，回滚后逐字节复原。
- **新 vs 新**：批量干跑在**一次扫描**里同时做「新 vs 既有」与「新 vs 新」的必然蕴含检查
  （同组豁免与单条一致）。**互相蕴含**（两条完全等价）会同时命中、双倍计分，必须合并/改写其一；
  **单向蕴含**（A ⊆ B）只算**警告**——部分包含是徽章系统的固有性质，管道会停在【待确认】，
  等人点「继续」（带 spec 内容哈希绑定确认）或「修改」（什么都不发生），**不是失败**。
- **supersession**：任意一条新徽章被 100% 取代 → **整批回滚**。
- 安全性质不变：脏工作区 exit 7、并发 exit 6、stale 锁 exit 8、全局平衡类失败保留现场 exit 3。
- 批量仍是 detached 子进程：状态文件里多写 `specCount` / `specs` / `hitsBySpec`，UI 仍只读轮询。

## 两条路径的地位

- **结构化**（`when`）：覆盖「单表达式且只用 `helpers.ts`」那部分（实测 128 条里 70 条）。
- **手写**（`handwritten.check` / `--ts`）：27% 的形态（casino 顺子、pattern 结构）表达不了，
  必须能手写。手写路径不是逃生舱——没有它这个工具就是残的。
  写盘前的干跑需要能执行这段逻辑，所以引用到的 private helper 要用 `evalHelpers` /
  `--helper-eval` 提供一份**仅用于求值**的副本（不会写进仓库）；
  它是否与文件里的实现逐字等价，**本工具无法证明**（见报告里的「不确定项」）。
  语法/类型错误由写盘后的 `tsc --noEmit` 兜（它在 enumerate 之前）。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功（不自动 commit：请 review diff 后自行提交） |
| 2 | 失败但**已自动回滚**（或参数/spec 错误，工作区零改动） |
| 3 | 全局平衡类失败 → **保留现场**，要求人工判断（绝不自动回滚，回滚会掩盖真实信号） |
| 4 | 回滚本身失败 → 工作区未完全还原，请人工介入 |
| 5 | 疑似部署环境，拒绝启动（`ui`） |
| 6 | 已有管道在跑，拒绝并发 |
| 7 | 受影响路径有未提交改动，拒绝开跑（不覆盖别人的工作） |
| 8 | 检出未跑完的管道（stale 锁），需先人工处理或 `--force` |
| 9 | 【待确认】：干跑只有单向蕴含警告、没有硬错误；子进程正常退出，工作区零改动——**这不是失败**，点「继续」再跑一次 |
