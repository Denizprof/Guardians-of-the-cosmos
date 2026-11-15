// The assistant's satellite: orbit maths and where it lands on screen (map/satelliteOrbit.ts).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EARTH_RADIUS_KM, ORBIT_ALTITUDE_KM, ORBIT_INCLINATION_DEG, attitude, globeRadiusPx, orbitAt, orbitState, projectSatellite, type Camera, type Vec3 } from '../../src/map/satelliteOrbit';

const RAD = Math.PI / 180;
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (lon: number, lat: number): Vec3 => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const cam = (over: Partial<Camera> = {}): Camera => ({ lon: 0, lat: 0, zoom: 1.5, pitch: 0, bearing: 0, fov: 36.87, height: 900, centre: { x: 720, y: 450 }, ...over });

describe('orbit', () => {
  it('is a unit circle with velocity at right angles to position', () => {
    for (const a of [0, 0.7, 2.1, 4, 6]) {
      const { pos, vel } = orbitState(a);
      expect(len(pos)).toBeCloseTo(1, 10);
      expect(len(vel)).toBeCloseTo(1, 10);
      expect(dot(pos, vel)).toBeCloseTo(0, 10);
    }
  });
  it('reaches the latitude its inclination allows and no further (98.4° is near-polar)', () => {
    let maxZ = 0;
    for (let a = 0; a < 2 * Math.PI; a += 0.01) maxZ = Math.max(maxZ, Math.abs(orbitState(a).pos[2]));
    expect(maxZ).toBeCloseTo(Math.sin(ORBIT_INCLINATION_DEG * RAD), 3);
  });
  it('moves with time and comes back near its start after one lap, shifted in longitude', () => {
    const a = orbitAt(0).pos;
    const b = orbitAt(40).pos;
    expect(len([a[0] - b[0], a[1] - b[1], a[2] - b[2]])).toBeGreaterThan(0.5);
    expect(orbitAt(150).pos[2]).toBeCloseTo(a[2], 6); // same latitude after one lap
  });
});

describe('projection onto the screen', () => {
  it('a satellite straight above the map centre is drawn at the centre, nearer the camera than the ground', () => {
    const p = projectSatellite(cam(), at(0, 0));
    expect(p.x).toBeCloseTo(720, 6);
    expect(p.y).toBeCloseTo(450, 6);
    expect(p.visible).toBe(true);
    expect(p.scale).toBeGreaterThan(1);
  });
  it('is hidden when the Earth is in the way', () => {
    expect(projectSatellite(cam(), at(180, 0)).visible).toBe(false);
    expect(projectSatellite(cam(), at(140, 20)).visible).toBe(false);
  });
  it('is visible beside the limb: it flies above the surface, so it shows where the ground is already out of view', () => {
    const p = projectSatellite(cam(), at(92, 0));
    expect(p.visible).toBe(true);
    const R = globeRadiusPx(1.5, 0);
    expect(p.x - 720).toBeGreaterThan(R * 0.9); // just outside the globe's edge
  });
  it('east is right and north is up with the map north-up; turning the map turns the satellite with it', () => {
    const east = projectSatellite(cam(), at(30, 0));
    expect(east.x).toBeGreaterThan(720);
    expect(east.y).toBeCloseTo(450, 6);
    const north = projectSatellite(cam(), at(0, 30));
    expect(north.y).toBeLessThan(450);
    expect(north.x).toBeCloseTo(720, 6);
    const turned = projectSatellite(cam({ bearing: 90 }), at(0, 30)); // east is now up, so north is to the left
    expect(turned.x).toBeLessThan(720);
    expect(turned.y).toBeCloseTo(450, 6);
  });
  it('follows the map centre: looking at another place puts a satellite above that place at the centre', () => {
    const p = projectSatellite(cam({ lon: 35, lat: 39 }), at(35, 39));
    expect(p.x).toBeCloseTo(720, 6);
    expect(p.y).toBeCloseTo(450, 6);
  });
  it('a tilted camera sees a satellite above the centre higher on the screen', () => {
    expect(projectSatellite(cam({ pitch: 40 }), at(0, 0)).y).toBeLessThan(450);
  });
  it('the orbit height on screen matches the real ratio of altitude to Earth radius', () => {
    // seen edge-on at the limb, far from the camera axis: distance from the globe centre = R * (1 + 747/6371)
    const c = cam({ zoom: 0.5 });
    const R = globeRadiusPx(0.5, 0);
    const p = projectSatellite(c, at(90, 0));
    const h = 900 / 2 / Math.tan((36.87 * RAD) / 2);
    const expected = (R * (1 + ORBIT_ALTITUDE_KM / EARTH_RADIUS_KM) * h) / (h + R);
    expect(p.x - 720).toBeCloseTo(expected, 6);
  });
});

describe('attitude', () => {
  it('flies the model along its body axis with the panel face away from the Earth, axes at right angles', () => {
    const { pos, vel } = orbitState(1.1);
    const view = projectSatellite(cam(), pos);
    const m = attitude(pos, vel, view);
    const col = (i: number): Vec3 => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
    for (const i of [0, 1, 2]) expect(len(col(i))).toBeCloseTo(1, 6);
    expect(dot(col(0), col(1))).toBeCloseTo(0, 6);
    expect(dot(col(1), col(2))).toBeCloseTo(0, 6);
    expect(dot(col(0), col(2))).toBeCloseTo(0, 6);
    // model +z, expressed in screen axes, equals "away from the Earth"; model +y equals the direction of travel
    const outward: Vec3 = [dot(pos, view.right), dot(pos, view.up), dot(pos, view.toCamera)];
    const along: Vec3 = [dot(vel, view.right), dot(vel, view.up), dot(vel, view.toCamera)];
    for (const i of [0, 1, 2]) {
      expect(col(2)[i]).toBeCloseTo(outward[i], 6);
      expect(col(1)[i]).toBeCloseTo(along[i], 6);
    }
    // right-handed, so the model is not mirrored
    const x = col(0), y = col(1), z = col(2);
    const yz: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    expect(dot(x, yz)).toBeCloseTo(1, 6);
  });
});

describe('the shipped model (public/satellite)', () => {
  const dir = path.resolve(__dirname, '../../public/satellite');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'satellite.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(dir, 'satellite.bin'));
  it('is small enough for a web page and matches its description', () => {
    expect(bin.length).toBeLessThan(400_000);
    expect(bin.readUInt32LE(0)).toBe(meta.vertices);
    expect(bin.readUInt32LE(4)).toBe(meta.triangles * 3);
    expect(bin.length).toBe(8 + meta.vertices * 8 + meta.triangles * 3 * meta.indexBytes);
  });
  it('every triangle points at real vertices and every vertex names a listed material', () => {
    const n = meta.vertices;
    for (let i = 0; i < n; i++) expect(bin.readUInt16LE(8 + i * 8 + 6)).toBeLessThan(meta.materials.length);
    const start = 8 + n * 8;
    let max = 0;
    for (let i = 0; i < meta.triangles * 3; i++) max = Math.max(max, meta.indexBytes === 2 ? bin.readUInt16LE(start + i * 2) : bin.readUInt32LE(start + i * 4));
    expect(max).toBeLessThan(n);
    for (const m of meta.materials) expect(m.colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});
