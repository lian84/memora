import { describe, expect, it } from 'vitest';
import { clampPanelWidth, PANEL_MIN_WIDTH } from './panel-width';

describe('panel width', () => {
  it('keeps the panel within usable bounds', () => {
    expect(clampPanelWidth(100, 1440)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(1000, 1440)).toBe(900);
    expect(clampPanelWidth(500, 800)).toBe(440);
  });
});
