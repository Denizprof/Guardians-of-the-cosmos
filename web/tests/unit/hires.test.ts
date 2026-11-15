import { describe, expect, it } from 'vitest';
import { isPlaceholder } from '../../src/map/hires';

const fill = (n: number, rgb: [number, number, number]) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4);
  return a;
};

describe('Esri placeholder detection', () => {
  it('flags the flat light-grey "Map data not yet available" tile', () => {
    expect(isPlaceholder(fill(1024, [204, 204, 204]))).toBe(true);
  });
  it('keeps real imagery: green fields, dark water, bright roofs', () => {
    for (const rgb of [[40, 90, 40], [10, 25, 50], [235, 235, 235], [150, 120, 100]] as [number, number, number][]) {
      expect(isPlaceholder(fill(1024, rgb))).toBe(false);
    }
  });
  it('keeps a tile that is only partly grey', () => {
    const a = fill(1024, [204, 204, 204]);
    for (let i = 0; i < 300; i++) a.set([30, 80, 30, 255], i * 4);
    expect(isPlaceholder(a)).toBe(false);
  });
});
