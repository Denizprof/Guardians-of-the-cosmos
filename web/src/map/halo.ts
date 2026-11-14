import type { Map as MlMap } from 'maplibre-gl';

/**
 * Blue atmospheric glow around the limb. MapLibre's own atmosphere only shades the globe surface, so the
 * halo is a CSS ring placed behind the (transparent) canvas and tracked to the globe's on-screen silhouette.
 */
export function attachHalo(map: MlMap) {
  const HALO_SCALE = 1.35; // element half-size relative to the globe radius; matches the gradient stops in styles.css
  const cont = map.getContainer();
  // One halo per container. The map can be created more than once on the same element (React StrictMode
  // remount in development, hot reload, a remounted MapView); a halo left behind by an earlier map no longer
  // follows the camera and stays frozen at its old size: when the user zoomed far out, that orphan showed as
  // a big detached ring around a small globe.
  cont.querySelectorAll(':scope > .globe-halo').forEach((old) => old.remove());
  const halo = document.createElement('div');
  halo.className = 'globe-halo';
  cont.prepend(halo);
  map.once('remove', () => halo.remove());
  const rad = Math.PI / 180;
  const update = () => {
    const z = map.getZoom();
    // Fades out as the globe outgrows the screen, and while the camera is tilted: the ring is
    // exact for a straight-down view only, so it must never float off the globe in tilted views.
    const tilt = map.getPitch();
    const k = Math.max(0, Math.min(1, (5.5 - z) / 1.5)) * Math.max(0, 1 - tilt / 8);
    if (k === 0) {
      halo.style.opacity = '0';
      return;
    }
    const H = cont.clientHeight;
    const h = H / 2 / Math.tan((map.getVerticalFieldOfView() * rad) / 2); // camera to map centre, px
    // globe radius, px: same as MapLibre's getGlobeRadiusPixels (latitude clamped to the Mercator limit)
    const R = (512 * 2 ** z) / (2 * Math.PI * Math.cos(Math.min(Math.abs(map.getCenter().lat), 85.051129) * rad));
    const p = map.getPitch() * rad;
    const D = Math.sqrt(R * R + h * h + 2 * R * h * Math.cos(p)); // camera to globe centre
    const r = h * Math.tan(Math.asin(Math.min(0.999, R / D))); // silhouette radius on screen
    // Anchor on where the camera's centre point actually lands on screen (robust to however the
    // projection applies camera padding), then shift for pitch: the globe's centre lies behind it.
    const c = map.project(map.getCenter());
    const cx = c.x;
    const cy = c.y + (h * R * Math.sin(p)) / (h + R * Math.cos(p));
    const half = r * HALO_SCALE;
    halo.style.width = halo.style.height = `${(2 * half).toFixed(1)}px`;
    halo.style.transform = `translate(${(cx - half).toFixed(1)}px, ${(cy - half).toFixed(1)}px)`;
    halo.style.opacity = k.toFixed(3);
  };
  map.on('move', update);
  map.on('resize', update);
  update();
}
