// Where the assistant's satellite is in its orbit, and where that lands on the screen.
//
// The satellite is the assistant's mascot: the team's own 3D model, circling the globe. Its orbit uses NISAR's
// real altitude and inclination so it looks right, but its POSITION IS NOT REAL: it is not NISAR's (or any
// satellite's) live location, it moves far faster than a real orbit, and it is drawn many times larger than
// life. The app says so wherever the satellite is described.
//
// Pure maths, no map and no DOM, so it can be tested. The camera model is the one MapLibre's globe uses (and
// map/halo.ts already relies on): the camera looks at the map centre on the globe's surface from a distance
// set by the field of view, tilted by the pitch and turned by the bearing.

export type Vec3 = [number, number, number];

export const EARTH_RADIUS_KM = 6371;
/** NISAR's orbit: 747 km altitude, 98.4 degrees inclination (sun-synchronous, near-polar). */
export const ORBIT_ALTITUDE_KM = 747;
export const ORBIT_INCLINATION_DEG = 98.4;
/** One lap on screen. A real lap at this altitude takes about 100 minutes; this is for show. */
export const ORBIT_PERIOD_S = 150;

const RAD = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3, kb = 1): Vec3 => [a[0] + kb * b[0], a[1] + kb * b[1], a[2] + kb * b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Unit position and unit velocity on a circular orbit, in Earth-fixed axes (x: 0°N 0°E, y: 0°N 90°E, z: north pole). */
export function orbitState(angleRad: number, inclinationDeg = ORBIT_INCLINATION_DEG, nodeDeg = 0): { pos: Vec3; vel: Vec3 } {
  const i = inclinationDeg * RAD;
  const o = nodeDeg * RAD;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  // in the orbit plane, then tilt by the inclination about x, then turn the ascending node about z
  const tilt = (x: number, y: number): Vec3 => {
    const yy = y * Math.cos(i);
    const zz = y * Math.sin(i);
    return [x * Math.cos(o) - yy * Math.sin(o), x * Math.sin(o) + yy * Math.cos(o), zz];
  };
  return { pos: tilt(c, s), vel: tilt(-s, c) };
}

/** Orbit angle at a time. The ascending node drifts slowly so successive laps pass over different longitudes. */
export function orbitAt(seconds: number): { pos: Vec3; vel: Vec3 } {
  return orbitState((2 * Math.PI * seconds) / ORBIT_PERIOD_S, ORBIT_INCLINATION_DEG, -(seconds / ORBIT_PERIOD_S) * 24);
}

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
  /** degrees */
  pitch: number;
  /** degrees */
  bearing: number;
  /** vertical field of view, degrees */
  fov: number;
  /** viewport height, CSS px */
  height: number;
  /** where the map centre is drawn, CSS px */
  centre: { x: number; y: number };
}

export interface Projected {
  x: number;
  y: number;
  /** on-screen magnification of something at the satellite's distance, relative to the map centre (1 = same). */
  scale: number;
  /** false when the Earth is in the way (or the point is behind the camera). */
  visible: boolean;
  /** screen axes as Earth-fixed unit vectors: right, up, and towards the camera */
  right: Vec3;
  up: Vec3;
  toCamera: Vec3;
}

/** Globe radius in CSS px: the same as MapLibre's globe (latitude clamped to the Mercator limit). */
export function globeRadiusPx(zoom: number, lat: number): number {
  return (512 * 2 ** zoom) / (2 * Math.PI * Math.cos(Math.min(Math.abs(lat), 85.051129) * RAD));
}

/** Project a point at `altitudeKm` above the Earth-fixed unit direction `pos`. */
export function projectSatellite(cam: Camera, pos: Vec3, altitudeKm = ORBIT_ALTITUDE_KM): Projected {
  const lam = cam.lon * RAD;
  const phi = cam.lat * RAD;
  // local axes at the map centre
  const upLocal: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const east: Vec3 = [-Math.sin(lam), Math.cos(lam), 0];
  const north: Vec3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  const b = cam.bearing * RAD;
  const p = cam.pitch * RAD;
  const forward = add(mul(north, Math.cos(b)), east, Math.sin(b)); // the ground direction that points up the screen
  const right = cross(forward, upLocal);
  const toCamera = add(mul(upLocal, Math.cos(p)), forward, -Math.sin(p));
  const up = add(mul(forward, Math.cos(p)), upLocal, Math.sin(p));

  const R = globeRadiusPx(cam.zoom, cam.lat);
  const h = cam.height / 2 / Math.tan((cam.fov * RAD) / 2); // camera to map centre, px
  // everything relative to the map centre on the surface, in px
  const k = 1 + altitudeKm / EARTH_RADIUS_KM;
  const v = mul(add(mul(pos, k), upLocal, -1), R);
  const depth = h - dot(v, toCamera); // distance in front of the camera
  const scale = depth > 1 ? h / depth : 0;

  // is the Earth between the camera and the satellite?
  const camPos = mul(toCamera, h);
  const centreOfGlobe = mul(upLocal, -R);
  const d = add(v, camPos, -1); // camera -> satellite
  const m = add(camPos, centreOfGlobe, -1); // globe centre -> camera
  const A = dot(d, d);
  const B = 2 * dot(m, d);
  const C = dot(m, m) - R * R;
  const disc = B * B - 4 * A * C;
  let hidden = false;
  if (disc > 0) {
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    hidden = t > 0 && t < 1;
  }
  return {
    x: cam.centre.x + dot(v, right) * scale,
    y: cam.centre.y - dot(v, up) * scale,
    scale,
    visible: depth > 1 && !hidden,
    right,
    up,
    toCamera,
  };
}

/**
 * How the model is turned, as a 3x3 matrix (column-major, columns = where the model's x, y and z axes point) in
 * screen axes (x right, y up, z towards the viewer). The model flies along its long body axis (+y), its solar
 * panels (x) lie across the direction of travel, and their flat face (z) looks away from the Earth, so from
 * above you see the whole shape rather than an edge.
 */
export function attitude(pos: Vec3, vel: Vec3, view: Pick<Projected, 'right' | 'up' | 'toCamera'>): number[] {
  const y = vel; // along the track
  const z = pos; // away from the Earth
  const x = cross(y, z); // across the track
  const toScreen = (a: Vec3) => [dot(a, view.right), dot(a, view.up), dot(a, view.toCamera)];
  return [...toScreen(x), ...toScreen(y), ...toScreen(z)];
}
