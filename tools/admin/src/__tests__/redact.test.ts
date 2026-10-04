import { describe, expect, it } from 'vitest';
import { AdminDbError, redactConnectionString, redactSecrets } from '../db';
import { SECRET_CONNECTION, SECRET_PASSWORD } from './fixtures';

describe('连接串脱敏', () => {
  it('redactConnectionString 只留 host:port/db', () => {
    expect(redactConnectionString(SECRET_CONNECTION)).toBe('db.example.com:5432/postgres');
  });

  it('脱敏结果不含用户名、密码、协议或查询参数', () => {
    const redacted = redactConnectionString(
      `${SECRET_CONNECTION}?sslmode=require&user=postgres`,
    );
    expect(redacted).not.toContain(SECRET_PASSWORD);
    expect(redacted).not.toContain('postgres.ref');
    expect(redacted).not.toContain('postgresql://');
    expect(redacted).not.toContain('sslmode');
  });

  it('解析失败时也不回显原文', () => {
    const redacted = redactConnectionString(`not-a-url-${SECRET_PASSWORD}`);
    expect(redacted).toBe('(unparseable-connection-string)');
    expect(redacted).not.toContain(SECRET_PASSWORD);
  });
});

describe('文本级脱敏：日志与错误信息', () => {
  it('抹掉 postgres:// 连接串', () => {
    const text = `connect failed: ${SECRET_CONNECTION} host unreachable`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(SECRET_PASSWORD);
    expect(redacted).not.toContain('db.example.com');
    expect(redacted).toContain('postgresql://***');
  });

  it('抹掉 DATABASE_URL 赋值（= 与 : 两种写法）', () => {
    expect(redactSecrets(`DATABASE_URL=${SECRET_CONNECTION}`)).not.toContain(SECRET_PASSWORD);
    expect(redactSecrets(`DATABASE_URL: ${SECRET_CONNECTION}`)).not.toContain(SECRET_PASSWORD);
    expect(redactSecrets(`DATABASE_URL=${SECRET_CONNECTION}`)).toContain('DATABASE_URL=***');
  });

  it('AdminDbError 的 message 已脱敏，但保留 SQLSTATE', () => {
    const err = new AdminDbError(
      `cannot execute INSERT in a read-only transaction (${SECRET_CONNECTION})`,
      '25006',
    );
    expect(err.message).not.toContain(SECRET_PASSWORD);
    expect(err.code).toBe('25006');
  });
});
