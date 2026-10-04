/**
 * 文本渲染器：CLI 的 stdout 形态。
 *
 * 这是**唯一**允许显示用户名明细（`report.names`）的渲染器——报告文件会被留存与转发，
 * 终端输出不会（见 docs/ADMIN.md §6.2 与本次任务书的第 3 条决定）。
 */
import type { StatsReport } from '../report';
import type { Table } from '../analyze';

function renderTable(table: Table): string[] {
  const header = `| ${table.columns.join(' | ')} |`;
  const divider = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const body = table.rows.map(row => `| ${row.join(' | ')} |`);
  const lines = [header, divider, ...body];
  if (table.rows.length === 0) lines.push('| （无数据） |');
  if (table.caption) lines.push(`_${table.caption}_`);
  return lines;
}

export function renderText(report: StatsReport): string {
  const lines: string[] = [];
  lines.push('HueDle 只读统计（本地管理工具，不监听端口）');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push(`窗口：最近 ${report.windowDays} 天（起始 ${report.windowStart}）`);
  lines.push(`连接：${report.connection}`);
  lines.push(
    `窗口总计：抽取 ${report.totals.draws} 次 / 玩家 ${report.totals.players} 人`,
  );
  lines.push('');

  for (const section of report.sections) {
    lines.push(`## ${section.id} ${section.title}`);
    lines.push(`问：${section.question}`);
    lines.push(...renderTable(section.table));
    for (const note of section.notes) lines.push(`注：${note}`);
    lines.push('');
  }

  if (report.namesRequested) {
    lines.push('## 用户明细（--include-names；仅终端显示，报告文件不含）');
    if (report.names.length === 0) {
      lines.push('（无数据）');
    } else {
      lines.push('| 用户名 | 抽取天数 | 最近一次 |');
      lines.push('| --- | --- | --- |');
      for (const row of report.names) {
        lines.push(`| ${row.name} | ${row.days} | ${row.lastDate} |`);
      }
    }
    lines.push('');
  }

  for (const warning of report.warnings) lines.push(`⚠ ${warning}`);
  return lines.join('\n');
}
