"""Stage 2: quantitative NISAR layers for the curated events.

  venezuela-2026          GUNW -> line-of-sight displacement (cm) + coherence
  mozambique-floods-2026  GCOV -> HH backscatter (dB), log-ratio change, water masks
  krasheninnikov-2026     GCOV -> full-resolution HH backscatter time series

Outputs web-ready RGBA WebP overlays in EPSG:3857 plus provenance, merged into
web/public/data/events.json next to the stage-1 browse layers.

Usage (from pipeline/):  python python/process.py [event-id]
Requires EARTHDATA_TOKEN in the environment.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.warp import Resampling, calculate_default_transform, reproject
from scipy.ndimage import uniform_filter
from skimage.filters import threshold_otsu

from nisar_io import Grid, read_gcov, read_gunw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "data"
ASF = "https://nisar.asf.earthdatacloud.nasa.gov/NISAR"
C = 299_792_458.0

# --------------------------------------------------------------------- config
EVENTS = {
    "venezuela-2026": {
        "bbox": (-69.2, 9.75, -66.6, 10.85),  # W, S, E, N; onshore around both epicentres
        "ref_box": (-69.1, 9.8, -68.7, 10.0),  # far-field reference area for zero motion
        "pairs": {
            "before": ("NISAR_L2_GUNW_PROVISIONAL_V1", "NISAR_L2_PR_GUNW_021_162_A_007_022_4000_SH_20260601T100657_20260601T100731_20260613T100656_20260613T100731_P05023_N_F_J_001"),
            "after": ("NISAR_L2_GUNW_PROVISIONAL_V1", "NISAR_L2_PR_GUNW_022_162_A_007_023_4000_SH_20260613T100656_20260613T100731_20260625T100655_20260625T100730_P05023_N_F_J_001"),
        },
    },
    "mozambique-floods-2026": {
        "bbox": (32.75, -24.85, 33.35, -24.35),  # Limpopo floodplain around Chokwe (~60 x 55 km)
        "scenes": {
            "before": ("NISAR_L2_GCOV_BETA_V1", "NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_20260105T034232_20260105T034253_X05010_N_P_J_001"),
            "after": ("NISAR_L2_GCOV_BETA_V1", "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"),
        },
    },
    "krasheninnikov-2026": {
        "bbox": (160.10, 54.50, 160.45, 54.69),  # ~22 x 20 km around the summit
    },
}

# ------------------------------------------------------------------- colours
def lut(stops: list[tuple[float, tuple[int, int, int]]], n=256) -> np.ndarray:
    xs = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], dtype=float)
    t = np.linspace(0, 1, n)
    return np.stack([np.interp(t, xs, cols[:, i]) for i in range(3)], axis=1).astype(np.uint8)

DIVERGING = lut([(0, (33, 102, 172)), (0.25, (103, 169, 207)), (0.5, (247, 247, 247)), (0.75, (239, 138, 98)), (1, (178, 24, 43))])
GRAY = lut([(0, (0, 0, 0)), (1, (255, 255, 255))])
COH = lut([(0, (20, 20, 30)), (1, (240, 240, 210))])


def colorize(v: np.ndarray, vmin: float, vmax: float, table: np.ndarray, alpha_mask=None) -> np.ndarray:
    t = np.clip((v - vmin) / (vmax - vmin), 0, 1)
    idx = np.nan_to_num(t * 255).astype(np.uint8)
    rgba = np.zeros(v.shape + (4,), np.uint8)
    rgba[..., :3] = table[idx]
    ok = np.isfinite(v) if alpha_mask is None else alpha_mask & np.isfinite(v)
    rgba[..., 3] = np.where(ok, 255, 0)
    return rgba


# ------------------------------------------------------------- reprojection
def to_mercator(grid: Grid, arr: np.ndarray, resampling=Resampling.bilinear):
    src_crs = CRS.from_epsg(grid.epsg)
    dst_crs = CRS.from_epsg(3857)
    h, w = arr.shape
    left, top = grid.transform * (0, 0)
    right, bottom = grid.transform * (w, h)
    tr, dw, dh = calculate_default_transform(src_crs, dst_crs, w, h, left, bottom, right, top)
    dst = np.full((dh, dw), np.nan, np.float32)
    reproject(arr.astype(np.float32), dst, src_transform=grid.transform, src_crs=src_crs,
              dst_transform=tr, dst_crs=dst_crs, resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
    to_ll = Transformer.from_crs(3857, 4326, always_xy=True)
    corners = [tr * (0, 0), tr * (dw, 0), tr * (dw, dh), tr * (0, dh)]
    lonlat = [list(map(lambda v: round(v, 6), to_ll.transform(x, y))) for x, y in corners]
    return dst, lonlat


def save_layer(event_id: str, name: str, rgba: np.ndarray, max_px=3072) -> str:
    img = Image.fromarray(rgba, "RGBA")
    if max(img.size) > max_px:
        s = max_px / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.Resampling.LANCZOS)
    d = OUT / "events" / event_id
    d.mkdir(parents=True, exist_ok=True)
    img.save(d / f"{name}.webp", "WEBP", quality=90, alpha_quality=100, method=6)
    return f"data/events/{event_id}/{name}.webp"


def name_parts(granule: str) -> dict:
    """Track/direction/frame/timestamps from the NISAR file name (JPL D-102255)."""
    p = granule.split("_")
    stamps = [s for s in p if len(s) == 15 and s[8] == "T"]
    iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[9:11]}:{s[11:13]}:{s[13:15]}Z"
    out = {"track": int(p[5]), "direction": "ASCENDING" if p[6] == "A" else "DESCENDING", "frame": int(p[7]),
           "start": iso(stamps[0])}
    if p[3] == "GUNW" and len(stamps) >= 4:
        out["reference"], out["secondary"] = iso(stamps[0]), iso(stamps[2])
    return out


def provenance(collection: str, granule: str, meta: dict, steps: list[str]) -> dict:
    tier = "BETA" if "_BETA_" in collection else "PROVISIONAL" if "_PROVISIONAL_" in collection else "VALIDATED"
    n = name_parts(granule)
    return {
        "mission": "NISAR", "sensor": "L-SAR (L-band, 24 cm)", "granule": granule, "collection": collection,
        "tier": tier, "crid": granule.split("_")[-5],
        "track": n["track"], "frame": n["frame"], "direction": n["direction"],
        "polarizations": None, "processing_date": meta.get("processingDateTime"),
        "browse_source": "", "product_url": f"{ASF}/{collection}/{granule}/{granule}.h5",
        "distributor": "ASF DAAC",
        "credit": "NISAR L-band data: NASA/JPL-Caltech & ISRO, distributed by ASF DAAC. Derived layer computed by the Global SAR team.",
        "processing": steps,
    }


# ------------------------------------------------------------------- events
def venezuela(cfg) -> list[dict]:
    layers = []
    for role, (coll, gran) in cfg["pairs"].items():
        grid, meta = read_gunw(f"{ASF}/{coll}/{gran}/{gran}.h5", cfg["bbox"])
        d = grid.data
        lam = C / meta["center_frequency_hz"]
        phase = d["phase"] - d["iono"] if "iono" in d else d["phase"]
        valid = np.isfinite(phase) & (d["coherence"] >= 0.3) & (d["components"] > 0) & (d["components"] != 65535)
        # LOS displacement toward the satellite, cm. Sign per ISCE3 convention
        # (ref * conj(sec), positive phase = range increase); verified against the
        # UCSD/JPL published map before display.
        los = np.where(valid, -phase * lam / (4 * np.pi) * 100.0, np.nan)
        # zero motion = median of a far-field reference box
        to_utm = Transformer.from_crs(4326, grid.epsg, always_xy=True)
        (x0, x1), (y0, y1) = zip(*[to_utm.transform(lon, lat) for lon, lat in [cfg["ref_box"][:2], cfg["ref_box"][2:]]])
        rx = (grid.x >= min(x0, x1)) & (grid.x <= max(x0, x1))
        ry = (grid.y >= min(y0, y1)) & (grid.y <= max(y0, y1))
        ref = np.nanmedian(los[np.ix_(ry, rx)])
        los -= ref
        merc, corners = to_mercator(grid, los)
        name = f"los_{role}"
        stats = {
            "p1_cm": round(float(np.nanpercentile(merc, 1)), 1),
            "p99_cm": round(float(np.nanpercentile(merc, 99)), 1),
            "std_cm": round(float(np.nanstd(merc)), 1),
            "valid_fraction": round(float(np.isfinite(merc).mean()), 3),
            "wavelength_cm": round(lam * 100, 2),
        }
        steps = [
            "Read unwrappedPhase, coherenceMagnitude, connectedComponents and ionospherePhaseScreen (frequency A, HH) for the area of interest via HTTPS range requests.",
            "Subtracted the product's ionospheric phase screen (included in GUNW but not applied by NASA).",
            "Masked pixels with coherence < 0.3 or outside valid unwrapping components.",
            f"Converted phase to line-of-sight displacement: d = -phi * lambda / (4 pi), lambda = {lam*100:.2f} cm from centerFrequency.",
            f"Referenced to zero at the median of a far-field box {cfg['ref_box']} (W,S,E,N).",
            "Reprojected bilinearly to Web Mercator (EPSG:3857).",
            "Tropospheric delay, solid-earth tides and residual ionosphere NOT corrected.",
        ]
        layers.append({
            "id": name, "role": role, "kind": "los", "product": "GUNW",
            "_merc": merc,
            "coordinates": corners,
            "acquisition": {"reference": name_parts(gran)["reference"], "secondary": name_parts(gran)["secondary"]},
            "legend": {"units": "cm toward satellite (LOS)", "colormap": "diverging", "stats": stats},
            "provenance": provenance(coll, gran, meta, steps),
        })
    # One shared colour scale so before and after are directly comparable in the swipe.
    lim = max(float(np.nanpercentile(np.abs(l["_merc"]), 99)) for l in layers)
    lim = max(5.0, np.ceil(lim / 5) * 5)
    for l in layers:
        l["url"] = save_layer("venezuela-2026", l["id"], colorize(l.pop("_merc"), -lim, lim, DIVERGING))
        l["legend"].update(vmin=-lim, vmax=lim)
        print(f"  {l['id']}: {l['legend']['stats']}", flush=True)
    return layers


def db(p: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(p > 0, p, np.nan))


def boxcar(p: np.ndarray, k=5) -> np.ndarray:
    """Speckle reduction: k x k mean of linear power, ignoring NaNs."""
    m = np.isfinite(p)
    num = uniform_filter(np.where(m, p, 0), k)
    den = uniform_filter(m.astype(float), k)
    return np.where(den > 0.5, num / np.maximum(den, 1e-9), np.nan)


CACHE = ROOT / "pipeline" / ".cache"


def cached_gcov(coll: str, gran: str, bbox):
    """read_gcov with a local .npz cache so re-thresholding needs no re-download."""
    import hashlib, pickle
    key = hashlib.sha1(f"{gran}{bbox}".encode()).hexdigest()[:16]
    path = CACHE / f"gcov_{key}.pkl"
    if path.exists():
        return pickle.loads(path.read_bytes())
    out = read_gcov(f"{ASF}/{coll}/{gran}/{gran}.h5", bbox)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(out))
    return out


def histogram_valley(v_db: np.ndarray, fallback=-15.0) -> float:
    """Threshold at the lowest point of the smoothed histogram BETWEEN the water peak
    (searched in -26..-13 dB) and the land peak (-12..-2 dB)."""
    v = v_db[np.isfinite(v_db)]
    h, e = np.histogram(v, bins=np.arange(-35, 5.01, 0.5))
    hs = np.convolve(h, np.ones(5) / 5, mode="same")
    c = (e[:-1] + e[1:]) / 2
    w = np.where((c >= -26) & (c <= -13))[0]
    l = np.where((c >= -12) & (c <= -2))[0]
    if not len(w) or not len(l):
        return fallback
    iw, il = w[np.argmax(hs[w])], l[np.argmax(hs[l])]
    if il - iw < 3:
        return fallback
    between = np.arange(iw, il + 1)
    return float(c[between[np.argmin(hs[between])]])


def mozambique(cfg) -> list[dict]:
    grids, metas, hh, hv = {}, {}, {}, {}
    for role, (coll, gran) in cfg["scenes"].items():
        g, meta = cached_gcov(coll, gran, cfg["bbox"])
        grids[role], metas[role] = g, meta
        hh[role], hv[role] = db(boxcar(g.data["HHHH"])), db(boxcar(g.data["HVHV"]))
    layers = []
    base_steps = ["Read gamma0 HHHH and HVHV (frequency A) for the area of interest via HTTPS range requests.",
                  "5x5 boxcar speckle filter on linear power; converted to dB = 10*log10(gamma0)."]
    for role in ("before", "after"):
        merc, corners = to_mercator(grids[role], hh[role])
        coll, gran = cfg["scenes"][role]
        layers.append({
            "id": f"hh_db_{role}", "role": role, "kind": "backscatter", "product": "GCOV",
            "url": save_layer("mozambique-floods-2026", f"hh_db_{role}", colorize(merc, -25, 0, GRAY)),
            "coordinates": corners, "acquisition": {"start": name_parts(cfg["scenes"][role][1])["start"]},
            "legend": {"units": "HH gamma0 (dB)", "vmin": -25, "vmax": 0, "colormap": "gray"},
            "provenance": provenance(coll, gran, metas[role], base_steps + ["Fixed display stretch -25 to 0 dB for both dates (comparable)."]),
        })
    # same geometry (track 114 frame 165): grids align pixel for pixel
    change = hh["after"] - hh["before"]
    thr = histogram_valley(hh["after"])
    # New water needs BOTH: water-like on 17 Jan and a significant darkening (> 3 dB).
    # A plain threshold alone would be fooled by the scene-wide +3 dB brightening (wet soil / BETA calibration).
    water_a = hh["after"] < thr
    new_water = water_a & (change < -3.0)
    perm_water = water_a & (hh["before"] < thr)
    px_km2 = abs(float(grids["after"].x[1] - grids["after"].x[0]) * float(grids["after"].y[0] - grids["after"].y[1])) / 1e6
    area = {"new_water_km2": round(float(new_water.sum()) * px_km2, 1),
            "water_both_dates_km2": round(float(perm_water.sum()) * px_km2, 1),
            "scene_median_change_db": round(float(np.nanmedian(change)), 2),
            "aoi_km2": round(float(np.isfinite(change).sum()) * px_km2, 0)}
    print(f"  threshold {thr:.2f} dB, {area}", flush=True)
    merc_c, corners = to_mercator(grids["after"], change)
    coll, gran = cfg["scenes"]["after"]
    layers.append({
        "id": "hh_change", "role": "change", "kind": "change", "product": "GCOV",
        "url": save_layer("mozambique-floods-2026", "hh_change", colorize(merc_c, -8, 8, DIVERGING)),
        "coordinates": corners, "acquisition": {"reference": name_parts(cfg["scenes"]["before"][1])["start"], "secondary": name_parts(cfg["scenes"]["after"][1])["start"]},
        "legend": {"units": "HH change (dB), after - before", "vmin": -8, "vmax": 8, "colormap": "diverging"},
        "provenance": provenance(coll, gran, metas["after"], base_steps + ["Log-ratio change: 10*log10(after/before) on HH."]),
    })
    code = np.where(new_water, 2.0, np.where(perm_water, 1.0, np.nan))
    merc_w, corners = to_mercator(grids["after"], code, Resampling.nearest)
    rgba = np.zeros(merc_w.shape + (4,), np.uint8)
    rgba[merc_w == 1] = (120, 170, 220, 170)   # water on both dates
    rgba[merc_w == 2] = (40, 160, 255, 255)    # new water on 17 Jan
    layers.append({
        "id": "water_new", "role": "change", "kind": "water", "product": "GCOV",
        "url": save_layer("mozambique-floods-2026", "water_new", rgba),
        "coordinates": corners, "acquisition": {"reference": name_parts(cfg["scenes"]["before"][1])["start"], "secondary": name_parts(cfg["scenes"]["after"][1])["start"]},
        "legend": {"units": "water mask", "threshold_db": round(thr, 2), "classes": {"1": "water on both dates", "2": "new water on 17 Jan"}, "stats": area},
        "provenance": provenance(coll, gran, metas["after"], base_steps + [
            f"Water-like = HH < {thr:.1f} dB: the valley between the water and land peaks of the 17 Jan HH histogram (smoothed, 0.5 dB bins).",
            "New water = water-like on 17 Jan AND HH darkened by more than 3 dB since 5 Jan. Water on both dates = water-like on both.",
            f"Scene-wide median HH change was {area['scene_median_change_db']:+.1f} dB (land brightening, likely wetter soil and/or BETA calibration), which is why a change criterion is required.",
            "Heuristic classification, not validated in the field: wind-roughened water, radar shadow, smooth tarmac and very dry sand can be misclassified."]),
    })
    return layers


def run(event_id: str):
    cfg = EVENTS[event_id]
    fn = {"venezuela-2026": venezuela, "mozambique-floods-2026": mozambique}.get(event_id)
    if not fn:
        print(f"{event_id}: stage 2 not implemented yet")
        return
    new_layers = fn(cfg)
    path = OUT / "events.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for ev in manifest["events"]:
        if ev["id"] == event_id:
            keep = [l for l in ev["layers"] if l["kind"] == "browse"]
            ev["layers"] = keep + new_layers
    manifest["generated"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"{event_id}: wrote {len(new_layers)} derived layers")


if __name__ == "__main__":
    for eid in (sys.argv[1:] or EVENTS.keys()):
        run(eid)
