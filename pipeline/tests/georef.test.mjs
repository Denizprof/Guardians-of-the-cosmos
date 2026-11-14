// node --test pipeline/tests
// georef.mjs on SYNTHETIC images: a rotated rectangle of "data" whose true pixel -> lon/lat
// mapping is known by construction (clearly synthetic: not NISAR data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { georeference, cropBox } from '../src/georef.mjs';

const M_PER_DEG = 111320;
const DEG = 0.001; // degrees per pixel of the synthetic image
const PX_M = DEG * M_PER_DEG; // ~111 m per pixel

/** Build an RGBA image with a rotated rectangle of data and the matching footprint ring. */
function synthetic({ w = 600, h = 500, cx = 300, cy = 250, rw = 360, rh = 300, angleDeg = 10, lon0 = 33.0, lat0 = -24.0, speckle = false } = {}) {
  const px = new Uint8ClampedArray(w * h * 4); // all zero: transparent black background
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const inside = (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    return Math.abs(u) <= rw / 2 && Math.abs(v) <= rh / 2;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const i = (y * w + x) * 4;
      px[i] = 120 + ((x * 7 + y * 3) % 100); // textured, never pure black
      px[i + 1] = 90;
      px[i + 2] = 60;
      px[i + 3] = 255;
    }
  }
  if (speckle) {
    // isolated single data pixels far outside the rectangle: must be ignored
    for (const [x, y] of [[2, 2], [w - 3, 4], [5, h - 4]]) {
      const i = (y * w + x) * 4;
      px[i] = 200; px[i + 1] = 200; px[i + 2] = 200; px[i + 3] = 255;
    }
  }
  const truth = (x, y) => [lon0 + DEG * x, lat0 - DEG * y]; // north-up image
  const corner = (su, sv) => {
    const u = (su * rw) / 2, v = (sv * rh) / 2;
    return [cx + u * cos - v * sin, cy + u * sin + v * cos];
  };
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const ring = corners.map(([x, y]) => truth(x, y));
  ring.push(ring[0]); // closed GeoJSON ring
  return { px, w, h, ring, truth, corners };
}

const errM = (a, b) => Math.hypot((a[0] - b[0]) * M_PER_DEG * Math.cos((b[1] * Math.PI) / 180), (a[1] - b[1]) * M_PER_DEG);

// Observed accuracy of the corner-matching heuristic on clean synthetic data is <= ~6 px at the
// four true image corners for the tilts real NISAR frames have (about +-25 deg).
for (const angle of [0, 4, 10, -10, 22]) {
  test(`georeference recovers the affine for a rectangle rotated ${angle} deg (corner error <= 6 px)`, () => {
    const s = synthetic({ angleDeg: angle });
    const geo = georeference(s.px, s.w, s.h, s.ring);
    for (const [x, y] of s.corners) {
      const e = errM(geo.toLonLat(x, y), s.truth(x, y)) / PX_M;
      assert.ok(e <= 6, `corner (${x.toFixed(0)},${y.toFixed(0)}) off by ${e.toFixed(1)} px`);
    }
    const e = errM(geo.toLonLat(300, 250), s.truth(300, 250)) / PX_M;
    assert.ok(e <= 3, `centre off by ${e.toFixed(1)} px`);
  });
}

// KNOWN LIMITATIONS (docs/qa/issues.md ISSUE-QA-12). `todo` tests run and are reported but never
// fail the run; each flips to a pass once the limitation is fixed.
test('reported residualMeters is an honest upper bound of the real corner error', { todo: 'ISSUE-QA-12' }, () => {
  const s = synthetic({ angleDeg: 4 });
  const geo = georeference(s.px, s.w, s.h, s.ring);
  const worst = Math.max(...s.corners.map(([x, y]) => errM(geo.toLonLat(x, y), s.truth(x, y))));
  assert.ok(geo.residualMeters >= worst / 3, `residual ${geo.residualMeters.toFixed(0)} m vs real worst corner error ${worst.toFixed(0)} m`);
});
test('a footprint rotated by ~45 deg is georeferenced correctly', { todo: 'ISSUE-QA-12' }, () => {
  const s = synthetic({ angleDeg: 45 });
  const geo = georeference(s.px, s.w, s.h, s.ring);
  for (const [x, y] of s.corners) assert.ok(errM(geo.toLonLat(x, y), s.truth(x, y)) / PX_M <= 6);
});

test('toPixel is the inverse of toLonLat', () => {
  const s = synthetic();
  const geo = georeference(s.px, s.w, s.h, s.ring);
  for (const [x, y] of [[0, 0], [123.4, 321.5], [599, 499], [300, 250]]) {
    const [lon, lat] = geo.toLonLat(x, y);
    const [x2, y2] = geo.toPixel(lon, lat);
    assert.ok(Math.abs(x - x2) < 1e-6 && Math.abs(y - y2) < 1e-6, `(${x},${y}) -> (${x2},${y2})`);
  }
});

test('isolated speckle pixels outside the data region do not corrupt the fit', () => {
  const clean = synthetic();
  const noisy = synthetic({ speckle: true });
  const a = georeference(clean.px, clean.w, clean.h, clean.ring);
  const b = georeference(noisy.px, noisy.w, noisy.h, noisy.ring);
  assert.ok(errM(a.toLonLat(300, 250), b.toLonLat(300, 250)) < 50, 'speckle moved the fit');
});

test('residual grows when the footprint is wrong (it reacts to inconsistent input)', () => {
  const s = synthetic();
  const bad = s.ring.map(([lon, lat], i) => [lon + (i % 2 ? 0.03 : -0.03), lat]); // shear the footprint ~3 km
  const good = georeference(s.px, s.w, s.h, s.ring);
  const worse = georeference(s.px, s.w, s.h, bad);
  assert.ok(worse.residualMeters > good.residualMeters * 3, `${worse.residualMeters} vs ${good.residualMeters}`);
});

test('a fully empty image fails loudly or reports a large residual (never a confident fit)', () => {
  const s = synthetic();
  let out;
  try {
    out = georeference(new Uint8ClampedArray(s.px.length), s.w, s.h, s.ring);
  } catch {
    return; // throwing is an acceptable, loud failure
  }
  assert.ok(!Number.isFinite(out.residualMeters) || out.residualMeters > 1000, `empty image gave residual ${out.residualMeters}`);
});

test('alpha=0 or pure-black pixels count as no-data (a hidden data region cannot be used for the fit)', () => {
  const s = synthetic();
  const hidden = new Uint8ClampedArray(s.px);
  for (let i = 0; i < hidden.length; i += 4) hidden[i + 3] = 0; // all alpha 0, RGB still non-black
  assert.throws(() => georeference(hidden, s.w, s.h, s.ring));
  const black = new Uint8ClampedArray(s.px);
  for (let i = 0; i < black.length; i += 4) {
    black[i] = 0; black[i + 1] = 0; black[i + 2] = 0; // alpha 255 but black
  }
  assert.throws(() => georeference(black, s.w, s.h, s.ring));
});

// ---------------------------------------------------------------- cropBox
test('cropBox: a 20 km box around the centre has the expected pixel size', () => {
  const s = synthetic({ lat0: 0 });
  const geo = georeference(s.px, s.w, s.h, s.ring);
  const loc = { lon: s.truth(300, 250)[0], lat: s.truth(300, 250)[1] };
  const box = cropBox(geo, loc, 20, s.w, s.h);
  const expectPx = 20000 / PX_M;
  assert.ok(Math.abs(box.width - expectPx) < 8, `width ${box.width} vs ${expectPx.toFixed(1)}`);
  assert.ok(Math.abs(box.height - expectPx) < 8, `height ${box.height} vs ${expectPx.toFixed(1)}`);
  assert.ok(Math.abs(box.left + box.width / 2 - 300) < 6);
  assert.ok(Math.abs(box.top + box.height / 2 - 250) < 6);
});

test('cropBox clamps to the image for a location near the edge', () => {
  const s = synthetic();
  const geo = georeference(s.px, s.w, s.h, s.ring);
  const corner = { lon: s.truth(5, 5)[0], lat: s.truth(5, 5)[1] };
  const box = cropBox(geo, corner, 200, s.w, s.h);
  assert.ok(box.left >= 0 && box.top >= 0);
  assert.ok(box.left + box.width <= s.w && box.top + box.height <= s.h);
  assert.ok(box.width > 0 && box.height > 0);
});

test('cropBox for a location entirely outside the image fails loudly with a clear message', () => {
  // ISSUE-QA-22 (fixed during the audit): it used to return an empty box that sharp.extract() rejected cryptically.
  const s = synthetic();
  const geo = georeference(s.px, s.w, s.h, s.ring);
  const far = { lon: s.truth(0, 0)[0] + 5, lat: s.truth(0, 0)[1] };
  assert.throws(() => cropBox(geo, far, 10, s.w, s.h), /outside the image footprint/);
});

test('cropBox widens in columns at high latitude (cos(lat) correction)', () => {
  const eq = synthetic({ lat0: 0 }), hi = synthetic({ lat0: 60 });
  const geoEq = georeference(eq.px, eq.w, eq.h, eq.ring), geoHi = georeference(hi.px, hi.w, hi.h, hi.ring);
  const be = cropBox(geoEq, { lon: eq.truth(300, 250)[0], lat: eq.truth(300, 250)[1] }, 20, eq.w, eq.h);
  const bh = cropBox(geoHi, { lon: hi.truth(300, 250)[0], lat: hi.truth(300, 250)[1] }, 20, hi.w, hi.h);
  // at ~48S/60N-ish latitudes a given km spans more longitude degrees, hence more columns (equal deg/px)
  assert.ok(bh.width > be.width * 1.5, `${bh.width} vs ${be.width}`);
  assert.ok(Math.abs(bh.height - be.height) < 8);
});
