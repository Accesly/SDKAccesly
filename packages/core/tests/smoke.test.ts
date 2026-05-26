import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from '../src/index.js';

describe('@accesly/core smoke', () => {
  it('exposes a SDK_VERSION string', () => {
    expect(typeof SDK_VERSION).toBe('string');
    expect(SDK_VERSION.length).toBeGreaterThan(0);
  });
});
