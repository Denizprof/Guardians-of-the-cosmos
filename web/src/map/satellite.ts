import type { Map as MlMap } from 'maplibre-gl';
import { ORBIT_PERIOD_S, attitude, globeRadiusPx, orbitAt, projectSatellite, type Camera } from './satelliteOrbit';

/**
 * The assistant's satellite: the team's own 3D model circling the globe. Clicking it opens the assistant.
 *
 * It is a mascot, not data. Its orbit has NISAR's altitude and inclination, but the position is not any real
 * satellite's, it laps the Earth in a couple of minutes, and it is drawn far larger than life (a real one would
 * be much smaller than a pixel). The tooltip says so.
 *
 * Drawn on its own small WebGL canvas above the map, with the projection in satelliteOrbit.ts, so it does not
 * depend on MapLibre internals and costs nothing when hidden. The model (public/satellite) is fetched after the
 * map is idle and never blocks it; if it or WebGL 2 is unavailable, there is simply no satellite.
 */
export interface SatelliteOptions {
  onAsk: () => void;
  /** no animation: the satellite stays at one point of its orbit (lite mode, reduced motion) */
  still: () => boolean;
}

/** Beyond this zoom the globe fills the screen and the satellite would only get in the way. */
const MAX_ZOOM = 4.3;
const LABEL = 'Ask the assistant';
export const SATELLITE_TITLE = "Ask the assistant. This satellite is the assistant's mascot: its orbit is illustrative, not a real satellite's position.";

const VERT = `#version 300 es
in vec3 aPos;
in float aMat;
uniform mat3 uRot;
uniform vec2 uCentre;
uniform float uSize;
uniform vec2 uView;
uniform vec3 uPalette[16];
out vec3 vCol;
out vec3 vPos;
void main() {
  vec3 p = uRot * aPos * uSize;
  vPos = p;
  vCol = uPalette[int(aMat + 0.5)];
  vec2 px = uCentre + vec2(p.x, -p.y);
  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, -p.z / (uSize * 4.0), 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
in vec3 vCol;
in vec3 vPos;
out vec4 outColor;
void main() {
  // flat shading from the surface itself: the mesh carries no normals
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (n.z < 0.0) n = -n;
  vec3 sun = normalize(vec3(-0.45, 0.55, 0.7));
  float diffuse = max(dot(n, sun), 0.0);
  float shine = pow(max(dot(n, normalize(sun + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
  outColor = vec4(vCol * (0.32 + 0.78 * diffuse) + vec3(0.25) * shine, 1.0);
}`;

interface Mesh { vao: WebGLVertexArrayObject; count: number; indexType: number; palette: Float32Array }

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[satellite] shader failed to compile:', gl.getShaderInfoLog(sh));
      return null;
    }
    gl.attachShader(prog, sh);
  }
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.bindAttribLocation(prog, 1, 'aMat');
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

async function loadMesh(gl: WebGL2RenderingContext, signal: AbortSignal): Promise<Mesh> {
  const [metaRes, binRes] = await Promise.all([fetch('satellite/satellite.json', { signal }), fetch('satellite/satellite.bin', { signal })]);
  if (!metaRes.ok || !binRes.ok) throw new Error(`HTTP ${metaRes.ok ? binRes.status : metaRes.status}`);
  const meta = (await metaRes.json()) as { vertices: number; triangles: number; indexBytes: number; materials: { colour: string }[] };
  const buf = await binRes.arrayBuffer();
  const head = new DataView(buf);
  const nVerts = head.getUint32(0, true);
  const nIdx = head.getUint32(4, true);
  if (nVerts !== meta.vertices || nIdx !== meta.triangles * 3 || buf.byteLength !== 8 + nVerts * 8 + nIdx * meta.indexBytes) throw new Error('model file does not match its description');
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('no vertex array');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buf, 8, nVerts * 8), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.SHORT, true, 8, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, false, 8, 6);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(buf, 8 + nVerts * 8, nIdx * meta.indexBytes), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const palette = new Float32Array(16 * 3).fill(0.8);
  meta.materials.slice(0, 16).forEach((m, i) => palette.set(hex(m.colour), i * 3));
  return { vao, count: nIdx, indexType: meta.indexBytes === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, palette };
}

/** Add the satellite to `host` (the element that holds the map). Returns a function that removes it. */
export function attachSatellite(map: MlMap, host: HTMLElement, opts: SatelliteOptions): () => void {
  host.querySelectorAll(':scope > .sat-canvas, :scope > .sat-button').forEach((old) => old.remove()); // one per host (hot reload, remount)
  const canvas = document.createElement('canvas');
  canvas.className = 'sat-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sat-button';
  button.tabIndex = -1; // "Ask" in the top bar is the keyboard route; a moving target is not a good one
  button.setAttribute('aria-label', LABEL);
  button.title = SATELLITE_TITLE;
  button.hidden = true;
  button.addEventListener('click', () => opts.onAsk());
  host.append(canvas, button);

  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  const prog = gl ? compile(gl) : null;
  const abort = new AbortController();
  let mesh: Mesh | null = null;
  let raf = 0;
  let removed = false;
  let lastDraw = 0;
  const start = performance.now();

  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h };
  };
  const hide = () => { button.hidden = true; canvas.style.opacity = '0'; };

  const draw = () => {
    if (!gl || !prog || !mesh || removed) return;
    const { w, h } = size();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const zoom = map.getZoom();
    const fade = Math.max(0, Math.min(1, (MAX_ZOOM - zoom) / 0.5));
    if (fade === 0 || !w || !h) return hide();
    const centre = map.getCenter();
    const c = map.project(centre);
    const mapBox = map.getContainer().getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const cam: Camera = {
      lon: centre.lng, lat: centre.lat, zoom, pitch: map.getPitch(), bearing: map.getBearing(),
      fov: map.getVerticalFieldOfView(), height: map.getContainer().clientHeight,
      centre: { x: c.x + mapBox.left - hostBox.left, y: c.y + mapBox.top - hostBox.top },
    };
    const seconds = opts.still() ? ORBIT_PERIOD_S * 0.07 : (performance.now() - start) / 1000;
    const { pos, vel } = orbitAt(seconds);
    const p = projectSatellite(cam, pos);
    if (!p.visible || p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) return hide();
    const R = globeRadiusPx(zoom, centre.lat);
    const half = Math.max(30, Math.min(90, R * 0.2)) * Math.max(0.75, Math.min(1.5, p.scale)); // half the model's longest side, px
    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uRot'), false, attitude(pos, vel, p));
    gl.uniform2f(gl.getUniformLocation(prog, 'uCentre'), p.x, p.y);
    gl.uniform1f(gl.getUniformLocation(prog, 'uSize'), half);
    gl.uniform2f(gl.getUniformLocation(prog, 'uView'), w, h);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uPalette'), mesh.palette);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    gl.bindVertexArray(null);
    canvas.style.opacity = fade.toFixed(2);
    button.hidden = false;
    button.style.transform = `translate(${(p.x - 22).toFixed(1)}px, ${(p.y - 22).toFixed(1)}px)`;
  };

  // Animated: about 30 frames a second while the page is visible. Still: only when the map moves.
  const tick = (now: number) => {
    raf = 0;
    if (removed) return;
    if (!document.hidden && now - lastDraw > 30) { lastDraw = now; draw(); }
    if (!opts.still() && mesh) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && !removed) raf = requestAnimationFrame(tick); };
  const onMove = () => (opts.still() ? draw() : kick());
  map.on('move', onMove);
  map.on('resize', onMove);
  document.addEventListener('visibilitychange', kick);

  // after the globe has drawn itself: the mascot must never delay the map
  const begin = () => {
    if (!gl || !prog || removed) return;
    loadMesh(gl, abort.signal).then(
      (m) => { mesh = m; canvas.dataset.ready = 'true'; draw(); kick(); },
      (e: unknown) => { if (!(e instanceof DOMException && e.name === 'AbortError')) console.warn('[satellite] model not shown:', e instanceof Error ? e.message : e); },
    );
  };
  if (map.loaded()) begin(); else map.once('idle', begin);

  return () => {
    removed = true;
    abort.abort();
    if (raf) cancelAnimationFrame(raf);
    map.off('move', onMove);
    map.off('resize', onMove);
    document.removeEventListener('visibilitychange', kick);
    canvas.remove();
    button.remove();
  };
}
