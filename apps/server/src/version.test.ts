import { describe, expect, it } from 'vitest';
import { readPackageVersion, resolveAppVersion } from './version.js';

describe('app version', () => {
  it('prefers MEMORA_VERSION and falls back to the package version', () => {
    expect(resolveAppVersion({ MEMORA_VERSION: ' 1.2.3 ' }, '9.9.9')).toBe('1.2.3');
    expect(resolveAppVersion({}, '9.9.9')).toBe('9.9.9');
    expect(resolveAppVersion({ MEMORA_VERSION: '  ' }, '9.9.9')).toBe('9.9.9');
    expect(resolveAppVersion({}, undefined)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reads the monorepo package version', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
