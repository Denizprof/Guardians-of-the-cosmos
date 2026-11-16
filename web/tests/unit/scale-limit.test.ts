import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, maxZoomForScale, zoomCeiling } from '../../src/map/style';

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

// Regression: dragging the globe over a pole put the camera at latitude +-90, where cos(lat) is ~0 and the
// limit came out near z-36. MapLibre's setMaxZoom() throws for a value under minZoom, and when that 'moveend'
// was fired synchronously from a React effect (setPadding on a layout change) the whole app was replaced by
// the "Something went wrong" screen with "maxZoom must be greater than the current minZoom".
describe('closest zoom stays valid at the poles', () => {
  it('is finite and usable at +-90 and beyond', () => {
    for (const lat of [90, -90, 89.99999, -89.99999, 120, -120]) {
      const z = maxZoomForScale(lat);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThan(14);
      expect(z).toBeLessThanOrEqual(maxZoomForScale(0));
    }
  });
  it('never returns NaN or -Infinity for a latitude that is not a number', () => {
    for (const lat of [NaN, Infinity, -Infinity, undefined as unknown as number]) expect(Number.isFinite(maxZoomForScale(lat))).toBe(true);
  });
  it('zoomCeiling never goes under the map minimum zoom nor over MAX_ZOOM', () => {
    for (const lat of [0, 41, 85, 90, -90, NaN]) {
      for (const min of [-2, 0, 16, 20]) {
        const z = zoomCeiling(lat, min);
        expect(z).toBeGreaterThanOrEqual(min);
        if (min <= MAX_ZOOM) expect(z).toBeLessThanOrEqual(MAX_ZOOM);
      }
    }
  });
});
