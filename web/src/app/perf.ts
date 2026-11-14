// Lite mode: on weak or software-rendered graphics the globe drops its costliest effects (3D terrain, sky and
// atmosphere shading, the glow halo, high pixel ratio) so panning and zooming stay smooth.
// Chosen by: ?lite=1 / ?lite=0 in the URL (remembered), else a saved choice, else a device check.
const KEY = 'gsar-lite';

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

/** True when WebGL runs in software (no real GPU): SwiftShader, llvmpipe, "Basic Render Driver". */
export function softwareRenderer(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

function detect(): boolean {
  const q = new URLSearchParams(location.search).get('lite');
  if (q === '1' || q === '0') {
    try { localStorage.setItem(KEY, q); } catch { /* storage blocked */ }
    return q === '1';
  }
  const saved = stored();
  if (saved !== null) return saved;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return softwareRenderer() || (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
}

let cached: boolean | null = null;
export function isLite(): boolean {
  return (cached ??= detect());
}
/** Device pixel ratio the maps render at. */
export function mapPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, isLite() ? 1 : 1.5);
}
