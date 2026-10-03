import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnonymousId, getLocalIdentity } from './identity';
import { STORAGE_KEYS } from './storage';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('getAnonymousId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('首次生成 v4 UUID 并持久化到 huedle:anonymousId', () => {
    const id = getAnonymousId();

    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem(STORAGE_KEYS.anonymousId)).toBe(id);
  });

  it('二次调用返回同一个值，且不会覆盖已存在的 ID', () => {
    const first = getAnonymousId();
    const second = getAnonymousId();

    expect(second).toBe(first);
    expect(localStorage.getItem(STORAGE_KEYS.anonymousId)).toBe(first);

    localStorage.setItem(STORAGE_KEYS.anonymousId, 'existing-id');
    expect(getAnonymousId()).toBe('existing-id');
  });

  it('localStorage 不可用（抛异常）时不抛，仍返回可用 ID', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    const id = getAnonymousId();
    expect(id).toMatch(UUID_V4);
    expect(getAnonymousId()).toMatch(UUID_V4);
  });

  it('getLocalIdentity 返回本地模式身份', () => {
    const identity = getLocalIdentity();

    expect(identity.mode).toBe('local');
    expect(identity).toEqual({ mode: 'local', anonymousId: getAnonymousId() });
  });
});
