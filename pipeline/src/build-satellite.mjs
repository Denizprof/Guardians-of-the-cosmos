// Converts the team's satellite model (Wavefront OBJ from Autodesk Fusion) into a small binary mesh for the app.
//
//   node pipeline/src/build-satellite.mjs "<path to Uydu v2.obj>"
//
// Writes web/public/satellite/satellite.bin and satellite.json. The source OBJ is 35 MB with 315,000 triangles,
// far too heavy for a web page and mostly spent on rounded edges nobody can see at 60 pixels. The mesh is
// simplified by vertex clustering: vertices that fall in the same small grid cell (per material, so colours do
// not bleed) are merged and triangles that collapse are dropped. The shape is the team's own design; nothing
// is added or invented.
//
// satellite.bin layout (little endian):
//   uint32 vertexCount, uint32 indexCount
//   vertexCount x [ int16 x, int16 y, int16 z, uint16 materialIndex ]   position = value / 32767 * scale + centre
//   indexCount  x uint16 (or uint32 when vertexCount > 65535; see satellite.json "indexBytes")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const CELLS = Number(process.argv[3] ?? 300); // grid cells along the longest side
if (!src || !fs.existsSync(src)) {
  console.error('usage: node pipeline/src/build-satellite.mjs "<model.obj>" [cells]');
  process.exit(1);
}

// The OBJ names Fusion materials but ships no .mtl file, so colours are assigned here from the material names.
const COLOURS = {
  'ABS_(White)': '#e9ebee',
  'Aluminum_-_Anodized_Glossy_(Blue)': '#2f6fd6',
  'Aluminum_-_Anodized_Glossy_(Grey)': '#8b929c',
  'Aluminum_-_Anodized_Glossy_(Red)': '#cf4433',
  'Aluminum_-_Brushed_Radial': '#bcc2ca',
  'Glass_-_Light_Color_(Blue)': '#8cc4f2',
  'Iron_-_Polished': '#9da4ad',
  'Polymide_(Kapton)': '#e0a63c',
  'Steel_-_Satin': '#aab1b9',
  'Tough_2000_(with_Formlabs_SLA_3D_Printers)': '#3b3f46',
};
const FALLBACK = '#c8ccd2';

const positions = [];
const materials = [];
const tris = []; // [vertexIndex, vertexIndex, vertexIndex, materialIndex]
let material = 0;
const materialIndex = (name) => {
  let i = materials.indexOf(name);
  if (i < 0) { materials.push(name); i = materials.length - 1; }
  return i;
};
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/);
    positions.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('usemtl ')) {
    material = materialIndex(line.slice(7).trim());
  } else if (line.startsWith('f ')) {
    const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
    for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1], material]); // fan, for any polygon
  }
}
if (!materials.length) materials.push('default');

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const p of positions) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
const centre = min.map((m, i) => (m + max[i]) / 2);
const scale = Math.max(...max.map((m, i) => m - min[i])) / 2;
const cell = (2 * scale) / CELLS;

// cluster: one output vertex per (material, grid cell), placed at the mean of the vertices it replaces
const clusters = new Map();
const out = [];
const clusterOf = (vi, mat) => {
  const p = positions[vi];
  const key = `${mat}|${Math.floor((p[0] - min[0]) / cell)}|${Math.floor((p[1] - min[1]) / cell)}|${Math.floor((p[2] - min[2]) / cell)}`;
  let c = clusters.get(key);
  if (c === undefined) { c = out.length; clusters.set(key, c); out.push({ sum: [0, 0, 0], n: 0, mat, seen: new Set() }); }
  const o = out[c];
  if (!o.seen.has(vi)) { o.seen.add(vi); o.sum[0] += p[0]; o.sum[1] += p[1]; o.sum[2] += p[2]; o.n++; }
  return c;
};
const indices = [];
const seenTri = new Set();
for (const [a, b, c, mat] of tris) {
  const ia = clusterOf(a, mat), ib = clusterOf(b, mat), ic = clusterOf(c, mat);
  if (ia === ib || ib === ic || ia === ic) continue; // collapsed
  const key = [ia, ib, ic].sort((x, y) => x - y).join(',');
  if (seenTri.has(key)) continue; // duplicate after merging
  seenTri.add(key);
  indices.push(ia, ib, ic);
}

const indexBytes = out.length > 65535 ? 4 : 2;
const buf = Buffer.alloc(8 + out.length * 8 + indices.length * indexBytes);
buf.writeUInt32LE(out.length, 0);
buf.writeUInt32LE(indices.length, 4);
let o = 8;
for (const v of out) {
  for (let i = 0; i < 3; i++) { buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(((v.sum[i] / v.n - centre[i]) / scale) * 32767))), o); o += 2; }
  buf.writeUInt16LE(v.mat, o); o += 2;
}
for (const i of indices) { if (indexBytes === 4) buf.writeUInt32LE(i, o); else buf.writeUInt16LE(i, o); o += indexBytes; }

const dir = path.resolve(here, '../../web/public/satellite');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'satellite.bin'), buf);
const meta = {
  source: path.basename(src),
  note: 'Simplified from the team\'s own CAD model by vertex clustering (pipeline/src/build-satellite.mjs). Colours are assigned from the Fusion material names.',
  vertices: out.length,
  triangles: indices.length / 3,
  indexBytes,
  centre: centre.map((v) => +v.toFixed(4)),
  scale: +scale.toFixed(4),
  size: max.map((m, i) => +(m - min[i]).toFixed(3)),
  materials: materials.map((name) => ({ name, colour: COLOURS[name] ?? FALLBACK })),
};
fs.writeFileSync(path.join(dir, 'satellite.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(`${positions.length} vertices / ${tris.length} triangles -> ${out.length} vertices / ${indices.length / 3} triangles, ${(buf.length / 1024).toFixed(0)} kB (index ${indexBytes} bytes)`);
