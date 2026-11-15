import { describe, expect, it } from 'vitest';
import { maxZoomForScale } from '../../src/map/style';

describe('closest zoom keeps the scale bar at 50 m or more', () => {
  it('is about z18.3 at the equator and lower towards the poles', () => {
    expect(maxZoomForScale(0)).toBeCloseTo(18.26, 1);
    expect(maxZoomForScale(41)).toBeLessThan(maxZoomForScale(0));
    expect(maxZoomForScale(60)).toBeCloseTo(17.26, 1);
  });
  it('gives 0.5 m per pixel at that zoom', () => {
    const lat = 41;
    const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** maxZoomForScale(lat);
    expect(mpp).toBeCloseTo(0.5, 3);
  });
});
