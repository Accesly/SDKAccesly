import { describe, expect, it } from 'vitest';
import { REACT_ADAPTER_VERSION } from '../src/index.js';

describe('@accesly/react smoke', () => {
  it('exposes a REACT_ADAPTER_VERSION string', () => {
    expect(typeof REACT_ADAPTER_VERSION).toBe('string');
  });
});
