import { describe, expect, it } from 'vitest';
import { INTERACTION } from '../../src/constants';

describe('smoke', () => {
  it('INTERACTION.DRAG_DEAD_ZONE_PX === 5', () => {
    expect(INTERACTION.DRAG_DEAD_ZONE_PX).toBe(5);
  });
});
