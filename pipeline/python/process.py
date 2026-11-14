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
def apply_affine(t, col: float, row: float) -> tuple[float, float]:
    """Pixel (col, row) -> map (x, y) without the deprecated `Affine * tuple` form."""
    return t.a * col + t.b * row + t.c, t.d * col + t.e * row + t.f


def to_mercator(grid: Grid, arr: np.ndarray, resampling=Resampling.bilinear):
    src_crs = CRS.from_epsg(grid.epsg)
    dst_crs = CRS.from_epsg(3857)
    h, w = arr.shape
    left, top = apply_affine(grid.transform, 0, 0)
    right, bottom = apply_affine(grid.transform, w, h)
    tr, dw, dh = calculate_default_transform(src_crs, dst_crs, w, h, left, bottom, right, top)
    dst = np.full((dh, dw), np.nan, np.float32)
    reproject(arr.astype(np.float32), dst, src_transform=grid.transform, src_crs=src_crs,
              dst_transform=tr, dst_crs=dst_crs, resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
    to_ll = Transformer.from_crs(3857, 4326, always_xy=True)
    corners = [apply_affine(tr, c, r) for c, r in ((0, 0), (dw, 0), (dw, dh), (0, dh))]
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


def tier_of(collection: str) -> str:
    """Same rules as pipeline/src/asf.mjs tierOf and web/src/services.ts tierOf."""
    if collection.startswith("NISAR_UR"):
        return "URGENT RESPONSE"
    if "_BETA_" in collection:
        return "BETA"
    if "_PROVISIONAL_" in collection:
        return "PROVISIONAL"
    return "VALIDATED"


def utc_iso(ts):
    """NISAR HDF5 timestamps are UTC but carry no offset; make that explicit for browsers."""
    if not ts:
        return ts
    ts = str(ts).split(".")[0]
    return ts if ts.endswith("Z") or "+" in ts[10:] else ts + "Z"


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
    tier = tier_of(collection)
    n = name_parts(granule)
    return {
        "mission": "NISAR", "sensor": "L-SAR (L-band, 24 cm)", "granule": granule, "collection": collection,
        "tier": tier, "crid": granule.split("_")[-5],
        "track": n["track"], "frame": n["frame"], "direction": n["direction"],
        "polarizations": None, "processing_date": utc_iso(meta.get("processingDateTime")),
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


def histogram_valley(v_db: np.ndarray, fallback=-15.0, min_peak_frac=0.005, max_valley_ratio=0.8) -> float:
    """Threshold at the centre of the lowest run of the smoothed histogram BETWEEN the water peak
    (searched in -26..-13 dB) and the land peak (-12..-2 dB).

    Falls back to `fallback` unless the histogram is genuinely bimodal: both peaks must hold at
    least `min_peak_frac` of the samples and the valley must be <= `max_valley_ratio` x the smaller peak.
    """
    v = v_db[np.isfinite(v_db)]
    if v.size == 0:
        return fallback
    h, e = np.histogram(v, bins=np.arange(-35, 5.01, 0.5))
    hs = np.convolve(h, np.ones(5) / 5, mode="same")
    c = (e[:-1] + e[1:]) / 2
    w = np.where((c >= -26) & (c <= -13))[0]
    l = np.where((c >= -12) & (c <= -2))[0]
    iw, il = w[np.argmax(hs[w])], l[np.argmax(hs[l])]
    if il - iw < 3 or min(hs[iw], hs[il]) < min_peak_frac * v.size:
        return fallback
    between = np.arange(iw, il + 1)
    vmin = hs[between].min()
    if vmin > max_valley_ratio * min(hs[iw], hs[il]):
        return fallback
    run = between[hs[between] == vmin]
    return float(c[run].mean())  # centre of the minimal run, not its first bin


def median_db(p: np.ndarray, k=3) -> np.ndarray:
    """Edge-preserving speckle reduction for classification: k x k median of dB (NaN-safe)."""
    from scipy.ndimage import median_filter
    d = db(p)
    filled = np.where(np.isfinite(d), d, -40.0)
    out = median_filter(filled, size=k)
    return np.where(np.isfinite(d), out, np.nan)


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
    # Classification uses a 3x3 MEDIAN of dB (edge-preserving). The 5x5 boxcar used for display
    # blurs water edges and biased flooded area low by ~2 px per boundary (QA-16); it is kept
    # only as a lower bound so the published area is a range, not a falsely precise number.
    cls = {r: median_db(grids[r].data["HHHH"]) for r in ("before", "after")}
    thr = histogram_valley(cls["after"])

    def classify(b, a):
        # New water needs BOTH: water-like on 17 Jan and a significant darkening (> 3 dB).
        # A plain threshold alone would be fooled by the scene-wide +3 dB brightening (wet soil / BETA calibration).
        wa = a < thr
        return wa & ((a - b) < -3.0), wa & (b < thr)

    new_water, perm_water = classify(cls["before"], cls["after"])
    new_lo, perm_lo = classify(hh["before"], hh["after"])
    px_km2 = abs(float(grids["after"].x[1] - grids["after"].x[0]) * float(grids["after"].y[0] - grids["after"].y[1])) / 1e6
    area = {"new_water_km2": round(float(new_water.sum()) * px_km2, 1),
            "new_water_km2_lower_bound": round(float(new_lo.sum()) * px_km2, 1),
            "water_both_dates_km2": round(float(perm_water.sum()) * px_km2, 1),
            "water_both_dates_km2_lower_bound": round(float(perm_lo.sum()) * px_km2, 1),
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
            "Classification on a 3x3 median of HH dB (edge-preserving); the 5x5 boxcar version is reported as a lower bound because averaging erodes water edges.",
            f"Water-like = HH < {thr:.2f} dB: the centre of the valley between the water and land peaks of the 17 Jan HH histogram (smoothed, 0.5 dB bins; bimodality checked).",
            "New water = water-like on 17 Jan AND HH darkened by more than 3 dB since 5 Jan. Water on both dates = water-like on both.",
            f"Scene-wide median HH change was {area['scene_median_change_db']:+.1f} dB (land brightening, likely wetter soil and/or BETA calibration), which is why a change criterion is required.",
            "Heuristic classification, not validated in the field: wind-roughened water, radar shadow, smooth tarmac and very dry sand can be misclassified."]),
    })
    return layers


KRAS_DATES = [  # track 060 descending, frame 061: identical geometry on every date
    ("20260618T084927_20260618T085005_P05023_N_F_J_001", "023"), ("20260630T084926_20260630T085005_P05023_N_F_J_001", "024"),
    ("20260712T084929_20260712T085004_P05023_N_F_J_001", "025"), ("20260724T084925_20260724T085003_P05023_N_F_J_001", "026"),
    ("20260817T084924_20260817T085002_P05023_N_F_J_001", "028"), ("20260829T084924_20260829T085002_P05023_N_F_J_001", "029"),
    ("20260910T084923_20260910T085002_P05023_N_F_J_001", "030"), ("20260922T084923_20260922T085002_P05023_N_F_J_001", "031"),
    ("20261004T084924_20261004T085002_P05023_N_F_J_001", "032"), ("20261016T084924_20261016T085002_P05023_N_F_J_001", "033"),
    ("20261028T084924_20261028T085002_P05036_N_F_J_001", "034"),
]


def krasheninnikov(cfg) -> list[dict]:
    """Full-resolution HH/HV composite per date with ONE fixed calibrated stretch,
    so colours are comparable between dates (unlike NASA's per-image browse stretch)."""
    layers = []
    HH_RANGE, HV_RANGE = (-25.0, 0.0), (-32.0, -7.0)
    first_hh = None
    for i, (tail, cycle) in enumerate(KRAS_DATES):
        coll = "NISAR_L2_GCOV_V1" if "_P05036_" in tail else "NISAR_L2_GCOV_PROVISIONAL_V1"
        gran = f"NISAR_L2_PR_GCOV_{cycle}_060_D_061_4005_DHDH_A_{tail}"
        g, meta = cached_gcov(coll, gran, cfg["bbox"])
        hh, hv = db(boxcar(g.data["HHHH"], 3)), db(boxcar(g.data["HVHV"], 3))
        if first_hh is None:
            first_hh, first_grid, first_gran, first_meta = hh, g, gran, meta
        mh, corners = to_mercator(g, hh)
        mv, _ = to_mercator(g, hv)
        # NaN (no data) -> 0 before the uint8 cast; those pixels are made transparent via alpha below.
        norm = lambda v, r: np.nan_to_num(np.clip((v - r[0]) / (r[1] - r[0]), 0, 1), nan=0.0)
        rgba = np.zeros(mh.shape + (4,), np.uint8)
        r = (norm(mh, HH_RANGE) ** 0.8 * 255).astype(np.uint8)
        gch = (norm(mv, HV_RANGE) ** 0.8 * 255).astype(np.uint8)
        rgba[..., 0], rgba[..., 1], rgba[..., 2] = r, gch, r
        rgba[..., 3] = np.where(np.isfinite(mh) & np.isfinite(mv), 255, 0)
        n = name_parts(gran)
        role = "before" if i == 0 else "after" if i == len(KRAS_DATES) - 1 else "timeline"
        name = f"rgb_{n['start'][:10].replace('-', '')}"
        layers.append({
            "id": name, "role": role, "kind": "backscatter", "product": "GCOV",
            "url": save_layer("krasheninnikov-2026", name, rgba),
            "coordinates": corners, "acquisition": {"start": n["start"]},
            "legend": {"units": f"R,B = HH {HH_RANGE[0]:.0f}..{HH_RANGE[1]:.0f} dB; G = HV {HV_RANGE[0]:.0f}..{HV_RANGE[1]:.0f} dB (fixed for all dates)", "colormap": "composite"},
            "provenance": provenance(coll, gran, meta, [
                "Read gamma0 HHHH and HVHV (frequency A) for a ~22 x 20 km box around the summit via HTTPS range requests.",
                "3x3 boxcar on linear power; converted to dB.",
                f"Composite R = B = HH, G = HV, with one fixed stretch for every date (HH {HH_RANGE}, HV {HV_RANGE} dB, gamma 0.8), so colours are comparable through time.",
                "Reprojected bilinearly to Web Mercator (EPSG:3857).",
            ]),
        })
        print(f"  {name}: HH median {np.nanmedian(hh):.1f} dB, HV median {np.nanmedian(hv):.1f} dB", flush=True)
    # Change from first to last date (same geometry): seasonal effects included, see caveats.
    change = hh - first_hh
    mc, corners = to_mercator(g, change)
    layers.append({
        "id": "hh_change_first_last", "role": "change", "kind": "change", "product": "GCOV",
        "url": save_layer("krasheninnikov-2026", "hh_change_first_last", colorize(mc, -8, 8, DIVERGING)),
        "coordinates": corners,
        "acquisition": {"reference": name_parts(first_gran)["start"], "secondary": name_parts(gran)["start"]},
        "legend": {"units": "HH change (dB), 28 Oct - 18 Jun", "vmin": -8, "vmax": 8, "colormap": "diverging",
                   "stats": {"median_change_db": round(float(np.nanmedian(change)), 2)}},
        "provenance": provenance(coll, gran, meta, [
            "Log-ratio change 10*log10(HH_28Oct / HH_18Jun) on 3x3-filtered gamma0.",
            "Includes seasonal snow and freeze effects; not a lava map by itself."]),
    })
    print(f"  change median {np.nanmedian(change):+.2f} dB", flush=True)
    return layers


def run(event_id: str):
    cfg = EVENTS[event_id]
    fn = {"venezuela-2026": venezuela, "mozambique-floods-2026": mozambique, "krasheninnikov-2026": krasheninnikov}.get(event_id)
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
