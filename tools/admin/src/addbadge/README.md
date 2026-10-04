# 第二阶段（加徽章流水线）的落位说明

本目录在第一阶段**只有这份说明，没有实现**。`docs/ADMIN.md` §3 定义的模块将落在这里：

| 计划文件 | 职责 |
|---|---|
| `spec.ts` | 条件 spec 的类型 + 手写校验器（不引 zod/ajv） |
| `build.ts` | `toSource()` / `toPredicate()` 两个后端 |
| `families.ts` | 家族文件与 id/name 清单的只读读取 |
| `insert.ts` | 末尾插入 + 缩进模板 + 写盘后三自检 |
| `dryrun.ts` | 2²⁴ 全色域干跑 + 包含/Jaccard 冗余检测 |
| `pipeline.ts` | 阶段编排、失败分类、退出码 |
| `rollback.ts` | 快照与还原（git 快路径 + 复制兜底） |

第一阶段只交付 `src/stats.ts`（M1–M8）、`src/db.ts`（只读连接与守卫）、
`src/render/`（文本 + 自包含 HTML）与 `src/cli.ts` 的 `stats` 子命令。
`argv.ts` 已按「子命令表」设计，加 `add-badge` / `rollback` 时只扩展解析分支，
不需要改动统计路径。
