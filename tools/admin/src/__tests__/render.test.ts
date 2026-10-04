import { describe, expect, it } from 'vitest';
import { renderHtml } from '../render/html';
import { renderText } from '../render/text';
import {
  sampleReport,
  SECRET_PASSWORD,
  SECRET_USERNAME,
} from './fixtures';

describe('HTML 渲染层：自包含、可 file:// 打开', () => {
  const html = renderHtml(sampleReport());

  it('不含任何 <script>', () => {
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('不含 http:// 或 https:// 外链（CSS/图片/字体全内联，无外部请求）', () => {
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('保留统计表格与问句', () => {
    expect(html).toContain('M1');
    expect(html).toContain('每日抽取量');
  });

  it('对数据库文本做 HTML 转义（防注入）', () => {
    const evil = renderHtml(
      sampleReport({
        sections: [
          {
            id: 'M1',
            title: '<img src=x onerror=alert(1)>',
            question: 'q',
            table: { columns: ['a'], rows: [['<script>alert(1)</script>']] },
            notes: [],
          },
        ],
      }),
    );
    expect(evil).not.toContain('<img src=x');
    expect(evil).not.toContain('<script>alert');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('HTML 渲染层：绝不包含用户名明细（决定 #3）', () => {
  const report = sampleReport({
    namesRequested: true,
    names: [
      { name: SECRET_USERNAME, days: 7, lastDate: '2026-01-01' },
      { name: 'bob', days: 2, lastDate: '2025-12-31' },
    ],
  });

  it('输出里不出现任何用户名', () => {
    const html = renderHtml(report);
    expect(html).not.toContain(SECRET_USERNAME);
    expect(html).not.toContain('bob');
  });

  it('但会说明"明细已获取、仅终端显示"', () => {
    const html = renderHtml(report);
    expect(html).toContain('仅在终端显示');
    expect(html).toContain('2 条');
  });
});

describe('文本渲染层：终端才显示用户名', () => {
  const report = sampleReport({
    namesRequested: true,
    names: [{ name: SECRET_USERNAME, days: 7, lastDate: '2026-01-01' }],
  });

  it('--include-names 时文本包含用户名', () => {
    expect(renderText(report)).toContain(SECRET_USERNAME);
  });

  it('未开启时文本不含用户名', () => {
    const text = renderText(sampleReport({ namesRequested: false, names: [] }));
    expect(text).not.toContain(SECRET_USERNAME);
  });
});

describe('报告脱敏（决定 #4）', () => {
  it('文本与 HTML 都不含密码 / DATABASE_URL 字面量', () => {
    const report = sampleReport();
    for (const output of [renderText(report), renderHtml(report)]) {
      expect(output).not.toContain(SECRET_PASSWORD);
      expect(output).not.toContain('DATABASE_URL');
    }
  });
});
