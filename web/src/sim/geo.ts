// Geodesy helpers for drawing simulation zones on the globe (spherical Earth, mean radius).

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Point at `distKm` from (lat, lon) along `bearingDeg` on a sphere. Returns [lon, lat]. */
export function destination(lat: number, lon: number, distKm: number, bearingDeg: number): [number, number] {
  const d = distKm / EARTH_RADIUS_KM;
  const b = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  const lonDeg = ((toDeg(l2) + 540) % 360) - 180;
  return [lonDeg, toDeg(p2)];
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Closed ring of a geodesic circle, capped at a hemisphere so huge zones stay drawable. */
export function circleRing(lat: number, lon: number, radiusKm: number, steps = 128): [number, number][] {
  const r = Math.min(radiusKm, Math.PI * EARTH_RADIUS_KM * 0.5);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) ring.push(destination(lat, lon, r, (360 * i) / steps));
  // unwrap longitudes so a ring crossing the antimeridian stays continuous
  for (let i = 1; i < ring.length; i++) {
    let dl = ring[i][0] - ring[i - 1][0];
    while (dl > 180) { ring[i][0] -= 360; dl -= 360; }
    while (dl < -180) { ring[i][0] += 360; dl += 360; }
  }
  return ring;
}
