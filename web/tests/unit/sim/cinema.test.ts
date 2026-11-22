// Cinematic effects on the globe: the meteor follows the model's altitude track and reaches the impact point exactly
// at impact; the lightning-like cracks are deterministic, grow with the rupture, flicker and fade.
import { describe, expect, it } from 'vitest';
import { METEOR_DIR, altitudeAt, buildCracks, cinemaFor, crackAlpha, crackProgress, hashSeed, jagged, meteorPose, rng, ruptureSeconds, truncate, type CinemaState } from '../../../src/map/cinema';
import { runImpact } from '../../../src/sim/impact';
import { runQuake } from '../../../src/sim/earthquake';

const impactInput = { lat: 41, lon: 29, diameter: 500, density: 3000, velocity: 20, angle: 45, target: 'sedimentary' as const, waterDepth: 3000, composition: 'stony' as const };
const meteorOf = (inp: typeof impactInput, t: number) => cinemaFor(runImpact(inp), t) as Extract<CinemaState, { kind: 'meteor' }>;

describe('building the state from a result', () => {
  it('an impact gives a meteor with its altitude track; an earthquake gives a quake with its rupture length', () => {
    const m = meteorOf(impactInput, -3);
    expect(m.kind).toBe('meteor');
    expect(m.altitude[0][1]).toBeCloseTo(100, 0);
    expect(m.entryT).toBeLessThan(0);
    const q = cinemaFor(runQuake({ lat: 38, lon: 142, magnitude: 7, depth: 15, fault: 'all' }), 1)!;
    expect(q.kind).toBe('quake');
    if (q.kind === 'quake') {
      expect(q.lengthKm).toBeGreaterThan(30);
      expect(q.strikeDeg).toBeNull(); // the point-source earthquake has no strike
    }
  });
  it('a result with no cinematic gives null', () => {
    expect(cinemaFor({ ...runImpact(impactInput), engine: 'flood' }, 0)).toBeNull();
  });
});

describe('the meteor', () => {
  it('flies the model altitude track: 100 km at entry, falling, with a straight lead-in from space before', () => {
    const m = meteorOf(impactInput, 0);
    expect(altitudeAt(m.altitude, m.entryT)).toBeCloseTo(100, 0);
    expect(altitudeAt(m.altitude, m.entryT - 2)).toBeGreaterThan(130); // coming in from beyond 100 km
    let prev = Infinity;
    for (let k = 0; k <= 20; k++) {
      const a = altitudeAt(m.altitude, m.entryT + (-m.entryT * k) / 20);
      expect(a).toBeLessThanOrEqual(prev + 1e-6);
      prev = a;
    }
  });
  it('arrives at the ground point exactly at impact, along the screen direction, and flashes there', () => {
    const gz = { x: 400, y: 300 };
    const before = meteorPose(meteorOf(impactInput, -3), gz, 500);
    expect(before.flying).toBe(true);
    // up and to the left of the impact point
    expect(before.x).toBeLessThan(gz.x);
    expect(before.y).toBeLessThan(gz.y);
    expect(Math.hypot(before.x - gz.x, before.y - gz.y)).toBeCloseTo((before.alt / 100) * 500, 3);
    const at0 = meteorPose(meteorOf(impactInput, 0), gz, 500);
    expect(at0.flying).toBe(false);
    expect(at0.burst.x).toBeCloseTo(gz.x, 0); // a ground impact: the flash is at the impact point
    expect(at0.burst.y).toBeCloseTo(gz.y, 0);
    expect(at0.flash).toBeCloseTo(1, 6);
    expect(meteorPose(meteorOf(impactInput, 6), gz, 500).flash).toBeLessThan(0.05);
  });
  it('heats as it enters the air: cold in space, hot low down', () => {
    const gz = { x: 0, y: 0 };
    const m = meteorOf(impactInput, 0);
    const hotness = (t: number) => meteorPose({ ...m, t }, gz, 500).heat;
    expect(hotness(m.entryT - 1)).toBe(0);
    expect(hotness(-0.2)).toBeGreaterThan(0.9);
    expect(hotness(-0.2)).toBeGreaterThanOrEqual(hotness(m.entryT / 2));
  });
  it('an airburst flashes at its burst altitude, up the track, not on the ground', () => {
    const gz = { x: 400, y: 300 };
    const small = meteorOf({ ...impactInput, diameter: 19, density: 3300, velocity: 19, angle: 18 }, 0.5);
    const p = meteorPose(small, gz, 500);
    expect(Math.hypot(p.burst.x - gz.x, p.burst.y - gz.y)).toBeGreaterThan(40);
    expect(Math.sign(p.burst.x - gz.x)).toBe(Math.sign(METEOR_DIR.x));
  });
});

describe('lightning-like cracks', () => {
  it('the random generator and the cracks are deterministic for a place', () => {
    expect(rng(7)()).toBe(rng(7)());
    expect(hashSeed(38.3, 142.4)).toBe(hashSeed(38.3, 142.4));
    expect(hashSeed(38.3, 142.4)).not.toBe(hashSeed(35.6, 139.7));
    const a = buildCracks(123, 300, 0.4, 20);
    const b = buildCracks(123, 300, 0.4, 20);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });
  it('a jagged path joins its end points and is not straight', () => {
    const p = jagged({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.3, 5, rng(1));
    expect(p[0]).toEqual({ x: 0, y: 0 });
    expect(p[p.length - 1]).toEqual({ x: 100, y: 0 });
    expect(p.length).toBe(33);
    expect(Math.max(...p.map((q) => Math.abs(q.y)))).toBeGreaterThan(0.5);
  });
  it('the main fault line runs through the epicentre along the strike; branches leave it', () => {
    const angle = Math.PI / 3;
    const cracks = buildCracks(5, 400, angle, 20);
    const mains = cracks.filter((c) => c.order === 0);
    expect(mains).toHaveLength(2);
    for (const m of mains) expect(m.pts[0]).toEqual({ x: 0, y: 0 });
    const tipA = mains[0].pts[mains[0].pts.length - 1];
    const tipB = mains[1].pts[mains[1].pts.length - 1];
    expect(tipA.x).toBeCloseTo(-tipB.x, 6);
    expect(Math.atan2(tipA.y, tipA.x)).toBeCloseTo(angle, 6);
    expect(cracks.filter((c) => c.order === 1).length).toBeGreaterThan(8);
  });
  it('cracks grow with the rupture, and a truncated path is a prefix of the full path', () => {
    const dur = ruptureSeconds(60);
    expect(dur).toBe(20);
    const main = buildCracks(9, 300, 0, dur)[0];
    expect(crackProgress(main, 0, dur)).toBe(0);
    expect(crackProgress(main, dur / 2, dur)).toBeCloseTo(0.5, 6);
    expect(crackProgress(main, dur + 5, dur)).toBe(1);
    const half = truncate(main.pts, 0.5);
    expect(half.length).toBeLessThan(main.pts.length);
    expect(half.slice(0, -1)).toEqual(main.pts.slice(0, half.length - 1));
    expect(truncate(main.pts, 1)).toBe(main.pts);
  });
  it('they are dark before the rupture, bright during it, and fade away afterwards', () => {
    const dur = 20;
    expect(crackAlpha(-1, dur, 3)).toBe(0);
    const during = Array.from({ length: 50 }, (_, k) => crackAlpha(1 + k * 0.3, dur, 3));
    expect(Math.max(...during)).toBeGreaterThan(0.85);
    expect(Math.min(...during)).toBeLessThan(Math.max(...during)); // it flickers
    expect(crackAlpha(dur + 20, dur, 3)).toBeLessThan(0.05);
  });
  it('rupture time follows the length at 3 km/s, within sensible limits', () => {
    expect(ruptureSeconds(300)).toBe(40);
    expect(ruptureSeconds(3)).toBe(4);
    expect(ruptureSeconds(90)).toBe(30);
  });
});
