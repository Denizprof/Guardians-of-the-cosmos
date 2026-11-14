// Georeference a browse image whose exact geotransform is not published (the
// KML sidecars need a login). We find the four corners of the valid-data
// quadrilateral in the image and fit an affine pixel -> (lon, lat) transform to
// the four corners of the ASF granule footprint polygon. The RMS misfit at the
// corners is reported so the app can show the georeferencing uncertainty.

const M_PER_DEG = 111320;

function isData(px, i) {
  return px[i + 3] > 0 && !(px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0);
}

/** Corner candidates of the valid-data region, in two flavours (axis and diagonal extremes). */
function imageCorners(px, w, h) {
  const rowMin = new Int32Array(h).fill(-1), rowMax = new Int32Array(h).fill(-1), rowCnt = new Int32Array(h);
  const colMin = new Int32Array(w).fill(-1), colMax = new Int32Array(w).fill(-1), colCnt = new Int32Array(w);
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  let pS0, pS1, pD0, pD1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!isData(px, i)) continue;
      // ignore isolated speckle: require a data neighbour to the right or below
      const right = x + 1 < w && isData(px, i + 4);
      const below = y + 1 < h && isData(px, i + w * 4);
      if (!right && !below) continue;
      if (rowMin[y] < 0) rowMin[y] = x;
      rowMax[y] = x;
      rowCnt[y]++;
      if (colMin[x] < 0) colMin[x] = y;
      colMax[x] = y;
      colCnt[x]++;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; pS0 = [x, y]; }
      if (s > sMax) { sMax = s; pS1 = [x, y]; }
      if (d < dMin) { dMin = d; pD0 = [x, y]; }
      if (d > dMax) { dMax = d; pD1 = [x, y]; }
    }
  }
  const firstRow = rowCnt.findIndex((c) => c >= 3);
  if (firstRow < 0 || !pS0) throw new Error('georeference: image has no valid data pixels (all transparent/black)');
  const lastRow = h - 1 - [...rowCnt].reverse().findIndex((c) => c >= 3);
  const firstCol = colCnt.findIndex((c) => c >= 3);
  const lastCol = w - 1 - [...colCnt].reverse().findIndex((c) => c >= 3);
  const axis = {
    top: [(rowMin[firstRow] + rowMax[firstRow]) / 2, firstRow],
    bottom: [(rowMin[lastRow] + rowMax[lastRow]) / 2, lastRow],
    left: [firstCol, (colMin[firstCol] + colMax[firstCol]) / 2],
    right: [lastCol, (colMin[lastCol] + colMax[lastCol]) / 2],
  };
  const diag = { tl: pS0, br: pS1, bl: pD0, tr: pD1 };
  return { axis, diag };
}

/** Footprint polygon corners matched to the same two flavours. */
function footprintCorners(ring) {
  const pts = ring.slice(0, -1);
  const by = (f) => pts.reduce((a, b) => (f(b) > f(a) ? b : a));
  const midLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((midLat * Math.PI) / 180); // make lon/lat roughly isotropic
  return {
    axis: {
      top: by((p) => p[1]),
      bottom: by((p) => -p[1]),
      left: by((p) => -p[0]),
      right: by((p) => p[0]),
    },
    // image y grows southward, so "x + y" ~ lon*k - lat
    diag: {
      tl: by((p) => -(p[0] * k - p[1])),
      br: by((p) => p[0] * k - p[1]),
      bl: by((p) => -(p[0] * k + p[1])),
      tr: by((p) => p[0] * k + p[1]),
    },
  };
}

function solve3(A, b) {
  // Gaussian elimination for a 3x3 system
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

function fitAffine(pairs) {
  // least squares: [lon, lat] = [x y 1] * coeffs
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AtLon = [0, 0, 0], AtLat = [0, 0, 0];
  for (const { px: [x, y], ll: [lon, lat] } of pairs) {
    const r = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) AtA[i][j] += r[i] * r[j];
      AtLon[i] += r[i] * lon;
      AtLat[i] += r[i] * lat;
    }
  }
  const a = solve3(AtA, AtLon), d = solve3(AtA, AtLat);
  const toLonLat = (x, y) => [a[0] * x + a[1] * y + a[2], d[0] * x + d[1] * y + d[2]];
  const det = a[0] * d[1] - a[1] * d[0];
  const toPixel = (lon, lat) => {
    const u = lon - a[2], v = lat - d[2];
    return [(d[1] * u - a[1] * v) / det, (-d[0] * u + a[0] * v) / det];
  };
  let ss = 0;
  for (const { px: [x, y], ll: [lon, lat] } of pairs) {
    const [plon, plat] = toLonLat(x, y);
    const dx = (plon - lon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    const dy = (plat - lat) * M_PER_DEG;
    ss += dx * dx + dy * dy;
  }
  return { toLonLat, toPixel, residualMeters: Math.sqrt(ss / pairs.length) };
}

export function georeference(px, w, h, ring) {
  const img = imageCorners(px, w, h);
  const fp = footprintCorners(ring);
  const fits = ['axis', 'diag'].map((flavour) =>
    fitAffine(Object.keys(img[flavour]).map((k) => ({ px: img[flavour][k], ll: fp[flavour][k] })))
  );
  return fits.reduce((a, b) => (b.residualMeters < a.residualMeters ? b : a));
}

/** Pixel box of size km x km centred on a location, clamped to the image. */
export function cropBox(geo, loc, km, w, h) {
  const dLat = km / 2 / 111.32;
  const dLon = dLat / Math.cos((loc.lat * Math.PI) / 180);
  const pts = [
    geo.toPixel(loc.lon - dLon, loc.lat + dLat),
    geo.toPixel(loc.lon + dLon, loc.lat + dLat),
    geo.toPixel(loc.lon + dLon, loc.lat - dLat),
    geo.toPixel(loc.lon - dLon, loc.lat - dLat),
  ];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(w, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(h, Math.ceil(Math.max(...ys)));
  if (right - left <= 0 || bottom - top <= 0) {
    throw new Error(`cropBox: location ${loc.lon},${loc.lat} lies outside the image footprint`);
  }
  return { left, top, width: right - left, height: bottom - top };
}
