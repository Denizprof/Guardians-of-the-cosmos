/** Static starfield behind the (transparent) globe canvases. */
export function drawStars(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  let seed = 20261114; // deterministic so the sky does not reshuffle on resize
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round((w * h) / 1500);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const m = rnd() ** 4; // few bright, many faint
    const tint = rnd();
    g.globalAlpha = 0.25 + 0.75 * m;
    g.fillStyle = tint < 0.12 ? '#ffd9b8' : tint < 0.3 ? '#bcd4ff' : '#ffffff';
    g.beginPath();
    g.arc(x, y, 0.35 + 1.0 * m, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}
