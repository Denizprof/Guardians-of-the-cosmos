"""Stage 2: quantitative NISAR layers for the curated events.

  venezuela-2026          GUNW -> line-of-sight displacement (cm) + coherence
  mozambique-floods-2026  GCOV -> HH backscatter (dB), log-ratio change, water masks
  krasheninnikov-2026     GCOV -> full-resolution HH/HV composite per date + first-to-last HH change
  uniao-do-sul-deforestation-2026, aspen-acres-fire-2026
                          GCOV -> HH/HV composite per date + HV log-ratio canopy-loss layer

Outputs web-ready RGBA WebP overlays in EPSG:3857 plus provenance, merged into
web/public/data/events.json next to the stage-1 browse layers.

Usage (from pipeline/):  python python/process.py [event-id]
Requires EARTHDATA_TOKEN in the environment.
"""
from __future__ import annotations

import json
import re
import os
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

from nisar_io import Grid, apply_validity_mask, read_gcov, read_gunw

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


def save_layer(event_id: str, name: str, rgba: np.ndarray, max_px=2048, categorical=False) -> str:
    """2048 px long edge is ~2x the on-screen size of a framed event; continuous layers use
    lossy WebP q80, categorical masks NEAREST resampling + lossless (no blended class colours)."""
    img = Image.fromarray(rgba, "RGBA")
    if max(img.size) > max_px:
        s = max_px / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)),
                         Image.Resampling.NEAREST if categorical else Image.Resampling.LANCZOS)
    d = OUT / "events" / event_id
    d.mkdir(parents=True, exist_ok=True)
    if categorical:
        img.save(d / f"{name}.webp", "WEBP", lossless=True, method=6)
    else:
        img.save(d / f"{name}.webp", "WEBP", quality=80, alpha_quality=90, method=6)
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
    ts = str(ts).strip()
    m = re.match(r"^(.*?T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$", ts)
    if not m:
        return ts if ts.endswith("Z") else ts + "Z"
    base, _frac, off = m.groups()
    if not off or off == "Z":
        return base + "Z"
    # explicit offset: convert to UTC so the instant is preserved (fractional seconds dropped)
    try:
        dt = datetime.fromisoformat(base + off[:3] + ":" + off[-2:])
    except ValueError:
        return base + off
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        "processing": steps + ([f"GCOV validity mask applied: samples flagged 0 (not from fully-focused radar samples) or 255 "
                                 f"(outside the swath) set to no-data ({100 * meta['masked_fraction']:.2f} % of pixels)."]
                                if "masked_fraction" in meta else
                                ["This product carries no GCOV validity mask, so none was applied."] if meta.get("no_validity_mask") else []),
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
        # Each connected component has its own arbitrary 2*pi ambiguity: keep only the component
        # that contains the reference box, so every displayed pixel shares the same reference.
        comp_box = d["components"][np.ix_(ry, rx)]
        comp_box = comp_box[(comp_box > 0) & (comp_box != 65535)]
        if comp_box.size < 500:
            raise RuntimeError(f"{role}: reference box has only {comp_box.size} valid pixels; choose another ref_box")
        ref_comp = int(np.bincount(comp_box.astype(np.int64)).argmax())
        los = np.where(d["components"] == ref_comp, los, np.nan)
        ref_vals = los[np.ix_(ry, rx)]
        if np.isfinite(ref_vals).sum() < 500:
            raise RuntimeError(f"{role}: too few coherent pixels in the reference box")
        los -= np.nanmedian(ref_vals)
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
            f"Referenced to zero at the median of a far-field box {cfg['ref_box']} (W,S,E,N); only the unwrapping component containing that box is shown (other components have an unknown multiple-of-12-cm offset).",
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


GCOV_CACHE_VERSION = 1  # bump when read_gcov's output changes, so stale cache entries are not reused


def cached_gcov(coll: str, gran: str, bbox):
    """read_gcov with a local pickle cache (gcov_<hash>.pkl in pipeline/.cache, raw read) so re-thresholding needs no re-download.
    The GCOV validity mask is applied on every load (see nisar_io.apply_validity_mask)."""
    import hashlib, pickle
    key = hashlib.sha1(f"{gran}{bbox}".encode()).hexdigest()[:16]
    path = CACHE / f"gcov_{key}.pkl"
    out = None
    if path.exists():
        try:
            cached = pickle.loads(path.read_bytes())
            # entries written before versioning are a bare (grid, meta) tuple: same read_gcov output as v1
            out = cached["out"] if isinstance(cached, dict) and cached.get("v") == GCOV_CACHE_VERSION else (cached if isinstance(cached, tuple) else None)
        except Exception as e:  # truncated / incompatible pickle: refetch instead of failing every run
            print(f"  cache entry {path.name} unreadable ({e.__class__.__name__}); refetching", flush=True)
    if out is None:
        out = read_gcov(f"{ASF}/{coll}/{gran}/{gran}.h5", bbox)
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(pickle.dumps({"v": GCOV_CACHE_VERSION, "out": out}))
        os.replace(tmp, path)  # atomic: an interrupted write never leaves a truncated cache entry
    grid, meta = out
    grid, frac = apply_validity_mask(grid)
    hh = grid.data.get("HHHH")
    if hh is not None and np.isfinite(hh).mean() < 0.2:
        # an (almost) empty window would publish a transparent overlay that reads as "no change"
        raise RuntimeError(f"{gran}: only {100 * np.isfinite(hh).mean():.1f} % valid HH pixels in {bbox}; check the bbox / swath")
    if frac is not None:  # only claim the mask step when the product actually carries a mask
        meta = {**meta, "masked_fraction": round(frac, 6)}
    else:
        meta = {**meta, "no_validity_mask": True}
    return grid, meta


def histogram_valley(v_db: np.ndarray, fallback=-15.0, min_peak_frac=0.005, max_valley_ratio=0.8) -> float:
    """Threshold only; see histogram_valley_info for whether the fallback was used."""
    return histogram_valley_info(v_db, fallback, min_peak_frac, max_valley_ratio)[0]


def histogram_valley_info(v_db: np.ndarray, fallback=-15.0, min_peak_frac=0.005, max_valley_ratio=0.8) -> tuple[float, bool]:
    """Threshold at the centre of the lowest run of the smoothed histogram BETWEEN the water peak
    (searched in -26..-13 dB) and the land peak (-12..-2 dB).

    Falls back to `fallback` unless the histogram is genuinely bimodal: both peaks must hold at
    least `min_peak_frac` of the samples and the valley must be <= `max_valley_ratio` x the smaller peak.
    """
    v = v_db[np.isfinite(v_db)]
    if v.size == 0:
        return fallback, True
    h, e = np.histogram(v, bins=np.arange(-35, 5.01, 0.5))
    hs = np.convolve(h, np.ones(5) / 5, mode="same")
    c = (e[:-1] + e[1:]) / 2
    w = np.where((c >= -26) & (c <= -13))[0]
    l = np.where((c >= -12) & (c <= -2))[0]
    iw, il = w[np.argmax(hs[w])], l[np.argmax(hs[l])]
    if il - iw < 3 or min(hs[iw], hs[il]) < min_peak_frac * v.size:
        return fallback, True
    between = np.arange(iw, il + 1)
    vmin = hs[between].min()
    if vmin > max_valley_ratio * min(hs[iw], hs[il]):
        return fallback, True
    run = between[hs[between] == vmin]
    return float(c[run].mean()), False  # centre of the minimal run, not its first bin


def median_db(p: np.ndarray, k=3) -> np.ndarray:
    """Edge-preserving speckle reduction for classification: k x k median of dB (NaN-safe)."""
    from scipy.ndimage import median_filter
    d = db(p)
    bad = ~np.isfinite(d)
    out = median_filter(np.where(bad, 0.0, d), size=k)
    # any no-data in the k x k window would bias the median: mark those pixels no-data too
    near_bad = uniform_filter(bad.astype(np.float32), size=k) > 0
    return np.where(near_bad, np.nan, out)


def same_grid(g1, g2, what: str):
    """Change maps subtract scenes pixel by pixel: refuse unless the grids are identical."""
    if g1.epsg != g2.epsg or g1.x.shape != g2.x.shape or g1.y.shape != g2.y.shape \
            or not np.allclose(g1.x, g2.x) or not np.allclose(g1.y, g2.y):
        raise RuntimeError(f"{what}: before/after grids differ; reproject to a common grid first")


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
    same_grid(grids["before"], grids["after"], "mozambique")
    cls = {r: median_db(grids[r].data["HHHH"]) for r in ("before", "after")}
    thr, fb_a = histogram_valley_info(cls["after"])
    # Each date gets its own threshold when its histogram is bimodal (the scene brightened ~3 dB between dates, so one
    # threshold applied to both would inflate "water on both dates").
    thr_b, fb_b = histogram_valley_info(cls["before"], fallback=thr)
    for label, used, t in (("17 Jan", fb_a, thr), ("5 Jan", fb_b, thr_b)):
        if used:
            print(f"  WARNING: {label} HH histogram is not bimodal; using fallback threshold {t:.2f} dB", flush=True)

    def thr_text(label, t, used, fb_desc):
        return (f"{label}: HH < {t:.2f} dB, a FALLBACK ({fb_desc}) because the {label} histogram is not clearly bimodal."
                if used else
                f"{label}: HH < {t:.2f} dB, the centre of the valley between the water and land peaks of the {label} HH histogram (smoothed, 0.5 dB bins; bimodality checked).")
    med_change = float(np.nanmedian(cls["after"] - cls["before"]))

    def classify(b, a):
        # New water: water-like on 17 Jan AND darkened > 3 dB RELATIVE to the scene-wide change
        # (removes the wet-soil / BETA-calibration offset). Classes are disjoint by construction.
        # ...and NOT water-like before: stable water stays dark while land brightens, so a relative
        # darkening alone would relabel permanent lakes and channels as "new water".
        wa, wb = a < thr, b < thr_b
        new = wa & ~wb & ((a - b) - med_change < -3.0)
        return new, wa & wb

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
        "url": save_layer("mozambique-floods-2026", "water_new", rgba, categorical=True),
        "coordinates": corners, "acquisition": {"reference": name_parts(cfg["scenes"]["before"][1])["start"], "secondary": name_parts(cfg["scenes"]["after"][1])["start"]},
        "legend": {"units": "water mask", "threshold_db": round(thr, 2), "threshold_db_before": round(thr_b, 2),
                   "threshold_fallback": bool(fb_a or fb_b),
                   "classes": {"1": "water on both dates", "2": "new water on 17 Jan"}, "stats": area},
        "provenance": provenance(coll, gran, metas["after"], base_steps + [
            "Classification on a 3x3 median of HH dB (edge-preserving); the 5x5 boxcar version is reported as a lower bound because averaging erodes water edges.",
            "Water-like thresholds: " + thr_text("17 Jan", thr, fb_a, "fixed -15 dB") + " " + thr_text("5 Jan", thr_b, fb_b, "the 17 Jan threshold"),
            "New water = water-like on 17 Jan AND NOT water-like on 5 Jan AND HH darkened by more than 3 dB relative to the scene-wide median change. Water on both dates = water-like on both.",
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
    same_grid(first_grid, g, "krasheninnikov")  # refuse to subtract misregistered scenes, like the other events
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


HV_EVENTS = {
    # event id -> bbox (W,S,E,N) and the ordered scenes; before/after picked by role
    "uniao-do-sul-deforestation-2026": {
        "bbox": (-54.12, -11.44, -53.95, -11.28),
        "what": "forest clearing",
        # INPE DETER polygon deter_amz.41873_curr bounding box (6.2 km2 clear-cut), for validation
        "validate_bbox": (-54.0553, -11.3797, -54.0175, -11.3429),
        "scenes": [
            ("timeline", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_031_002_A_172_2005_DHDH_A_20260918T091907_20260918T091941_P05023_F_F_J_001"),
            ("before", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_032_002_A_172_2005_DHDH_A_20260930T091907_20260930T091941_P05023_N_F_J_001"),
            ("timeline", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_033_002_A_172_2005_DHDH_A_20261012T091907_20261012T091941_P05023_N_F_J_001"),
            ("after", "NISAR_L2_GCOV_V1", "NISAR_L2_PR_GCOV_034_002_A_172_2005_DHDH_A_20261024T091907_20261024T091942_P05036_N_F_J_001"),
        ],
    },
    "aspen-acres-fire-2026": {
        "bbox": (-105.30, 37.85, -104.85, 38.20),
        "what": "burned vegetation",
        "scenes": [
            ("timeline", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_023_019_A_021_4005_DHDH_A_20260615T121118_20260615T121152_P05023_N_F_J_001"),
            ("before", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_024_019_A_021_4005_DHDH_A_20260627T121117_20260627T121152_P05023_N_F_J_001"),
            ("timeline", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_025_019_A_021_4005_DHDH_A_20260709T121116_20260709T121151_P05023_N_F_J_001"),
            ("after", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_PR_GCOV_028_019_A_021_4005_DHDH_A_20260814T121114_20260814T121149_P05023_N_F_J_001"),
        ],
    },
}


def hv_series(event_id: str) -> list[dict]:
    """Vegetation-loss workflow: per-date calibrated HH/HV composite (fixed stretch, comparable
    between dates) + HV log-ratio change before -> after + area of strong HV loss (< -3 dB)."""
    cfg = HV_EVENTS[event_id]
    HH_RANGE, HV_RANGE = (-25.0, 0.0), (-32.0, -7.0)
    layers, data = [], {}
    norm = lambda v, r: np.nan_to_num(np.clip((v - r[0]) / (r[1] - r[0]), 0, 1), nan=0.0)
    for role, coll, gran in cfg["scenes"]:
        g, meta = cached_gcov(coll, gran, cfg["bbox"])
        hh, hv = db(boxcar(g.data["HHHH"], 3)), db(boxcar(g.data["HVHV"], 3))
        data[role if role != "timeline" else gran] = (g, meta, coll, gran, hv)
        mh, corners = to_mercator(g, hh)
        mv, _ = to_mercator(g, hv)
        rgba = np.zeros(mh.shape + (4,), np.uint8)
        r = (norm(mh, HH_RANGE) ** 0.8 * 255).astype(np.uint8)
        rgba[..., 0], rgba[..., 1], rgba[..., 2] = r, (norm(mv, HV_RANGE) ** 0.8 * 255).astype(np.uint8), r
        rgba[..., 3] = np.where(np.isfinite(mh) & np.isfinite(mv), 255, 0)
        n = name_parts(gran)
        name = f"rgb_{n['start'][:10].replace('-', '')}"
        layers.append({
            "id": name, "role": role, "kind": "backscatter", "product": "GCOV",
            "url": save_layer(event_id, name, rgba), "coordinates": corners, "acquisition": {"start": n["start"]},
            "legend": {"units": f"R,B = HH {HH_RANGE[0]:.0f}..{HH_RANGE[1]:.0f} dB; G = HV {HV_RANGE[0]:.0f}..{HV_RANGE[1]:.0f} dB (fixed for all dates)", "colormap": "composite"},
            "provenance": provenance(coll, gran, meta, [
                "Read gamma0 HHHH and HVHV (frequency A) for the area of interest via HTTPS range requests.",
                "3x3 boxcar on linear power; converted to dB.",
                f"Composite R = B = HH, G = HV with one fixed stretch for every date (HH {HH_RANGE}, HV {HV_RANGE} dB), so colours are comparable through time.",
                "Reprojected bilinearly to Web Mercator (EPSG:3857).",
            ]),
        })
    gb, mb, _, granb, _ = data["before"]
    ga, ma, colla, grana, _ = data["after"]
    same_grid(gb, ga, event_id)
    hv_b, hv_a = median_db(gb.data["HVHV"]), median_db(ga.data["HVHV"])
    change = hv_a - hv_b  # same track/frame -> identical grids (checked above)
    # Remove the scene-wide offset (moisture, or calibration difference between processing
    # versions) before thresholding: strong loss = > 3 dB darker than the scene's typical change.
    offset = float(np.nanmedian(change))
    loss = (change - offset) < -3.0
    px_km2 = abs(float(ga.x[1] - ga.x[0]) * float(ga.y[0] - ga.y[1])) / 1e6
    stats = {"hv_loss_km2": round(float(loss.sum()) * px_km2, 1),
             "aoi_km2": round(float(np.isfinite(change).sum()) * px_km2, 0),
             "median_change_db": round(float(np.nanmedian(change)), 2)}
    if "validate_bbox" in cfg:  # loss inside an independent reference polygon's bounding box
        to_utm = Transformer.from_crs(4326, ga.epsg, always_xy=True)
        w, s, e, n = cfg["validate_bbox"]
        (x0, y0), (x1, y1) = to_utm.transform(w, s), to_utm.transform(e, n)
        sel = np.ix_((ga.y >= min(y0, y1)) & (ga.y <= max(y0, y1)), (ga.x >= min(x0, x1)) & (ga.x <= max(x0, x1)))
        box_valid = np.isfinite(change[sel])
        stats["validation_box_km2"] = round(float(box_valid.sum()) * px_km2, 1)
        stats["hv_loss_in_validation_box_km2"] = round(float(loss[sel].sum()) * px_km2, 1)
    print(f"  {event_id}: {stats}", flush=True)
    mc, corners = to_mercator(ga, change)
    layers.append({
        "id": "hv_change", "role": "change", "kind": "change", "product": "GCOV",
        "url": save_layer(event_id, "hv_change", colorize(mc, -8, 8, DIVERGING)),
        "coordinates": corners,
        "acquisition": {"reference": name_parts(granb)["start"], "secondary": name_parts(grana)["start"]},
        "legend": {"units": "HV change (dB), after - before", "vmin": -8, "vmax": 8, "colormap": "diverging", "stats": stats},
        "provenance": provenance(colla, grana, ma, [
            "HV log-ratio 10*log10(HV_after / HV_before) on a 3x3 median of dB (edge-preserving); pixels next to no-data excluded.",
            f"Scene-wide median HV change {stats['median_change_db']:+.2f} dB removed before thresholding (moisture and/or calibration offset between dates).",
            f"Strong HV loss (> 3 dB below the scene median change), consistent with {cfg['what']}: {stats['hv_loss_km2']} km2 of {stats['aoi_km2']:.0f} km2 analysed.",
            "Heuristic; soil/vegetation moisture changes between dates also move HV. Before and after may differ in CRID (processing version).",
        ]),
    })
    return layers


def run(event_id: str):
    if event_id in HV_EVENTS:
        new_layers = hv_series(event_id)
    else:
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
    if not any(ev["id"] == event_id for ev in manifest["events"]):
        raise RuntimeError(f"{event_id} not in events.json: run stage 1 (fetch-browse.mjs) first")
    manifest["generated"] = datetime.now(timezone.utc).isoformat()

    def clean(o):  # NaN/inf are not valid JSON: publish them as null
        if isinstance(o, float) and not np.isfinite(o):
            return None
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        return o

    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean(manifest), indent=2, allow_nan=False), encoding="utf-8")
    os.replace(tmp, path)  # atomic: a crash never leaves a truncated manifest
    print(f"{event_id}: wrote {len(new_layers)} derived layers")


if __name__ == "__main__":
    for eid in (sys.argv[1:] or [*EVENTS.keys(), *HV_EVENTS.keys()]):
        run(eid)
