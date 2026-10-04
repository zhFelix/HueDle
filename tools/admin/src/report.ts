/**
 * 报告模型：CLI 只读统计的**唯一**数据形态。
 *
 * 关键约定：`names` 里可能带用户名（PII），但**只有文本渲染器会读它**；
 * HTML 渲染器（见 `render/html.ts`）永远不输出 `names` 的内容。
 */
import type { MetricId } from './stats';
import type { Table } from './analyze';

export interface SectionResult {
  id: MetricId;
  title: string;
  question: string;
  table: Table;
  notes: string[];
}

/** 用户名明细行：仅终端显示。 */
export interface NameDetail {
  name: string;
  days: number;
  lastDate: string;
}

export interface StatsReport {
  generatedAt: string;
  windowDays: number;
  windowStart: string;
  /** 已脱敏的连接标识：`host:port/db`，绝不含用户名/密码。 */
  connection: string;
  totals: { draws: number; players: number };
  sections: SectionResult[];
  /** 空数组表示未请求或没有数据；有值时只允许文本渲染器读取。 */
  names: NameDetail[];
  namesRequested: boolean;
  warnings: string[];
}
