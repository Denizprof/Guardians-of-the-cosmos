"""process.py: the pure functions plus the science code paths, driven by SYNTHETIC grids.

Where the real read_gunw/cached_gcov would download NISAR products, these tests patch only that
single I/O seam with a synthetic Grid (clearly labelled SYNTHETIC) and run the REAL processing
code on it. Granule names are the real ones from web/public/data/events.json.
"""
from __future__ import annotations

import hashlib
import json
import pickle
from pathlib import Path

import numpy as np
import pytest

import process
from nisar_io import Grid

REPO = Path(__file__).resolve().parents[2]
EVENTS_JSON = REPO / "web" / "public" / "data" / "events.json"
events = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))["events"]
ALL_LAYERS = [(e["id"], l) for e in events for l in e["layers"]]
EPSG = 32619
LAMBDA_CM = process.C / 1.2575e9 * 100  # centre frequency used in the synthetic GUNW meta


# ------------------------------------------------------------------ name_parts
@pytest.mark.parametrize("ev_id,layer", ALL_LAYERS, ids=[f"{e}/{l['id']}" for e, l in ALL_LAYERS])
def test_name_parts_matches_the_shipped_provenance(ev_id, layer):
    p = layer["provenance"]
    n = process.name_parts(p["granule"])
    assert n["track"] == p["track"]
    assert n["frame"] == p["frame"]
    assert n["direction"] == p["direction"]
    assert p["granule"].split("_")[-5] == p["crid"]  # provenance() derives the CRID this way
    if layer["product"] == "GUNW" and layer["kind"] == "browse":
        assert n["reference"][:16] == layer["acquisition"]["reference"][:16]
        assert n["secondary"][:16] == layer["acquisition"]["secondary"][:16]
    elif "start" in layer["acquisition"]:
        assert n["start"][:16] == layer["acquisition"]["start"][:16]


def test_name_parts_gcov_has_no_pair_keys_and_gunw_has_them():
    g = "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"
    n = process.name_parts(g)
    assert n == {"track": 114, "direction": "ASCENDING", "frame": 165, "start": "2026-01-17T03:42:32Z"}
    u = "NISAR_L2_PR_GUNW_022_162_A_007_023_4000_SH_20260613T100656_20260613T100731_20260625T100655_20260625T100730_P05023_N_F_J_001"
    m = process.name_parts(u)
    assert (m["reference"], m["secondary"]) == ("2026-06-13T10:06:56Z", "2026-06-25T10:06:55Z")
    assert m["direction"] == "ASCENDING" and m["track"] == 162 and m["frame"] == 7


def test_name_parts_descending():
    g = "NISAR_L2_PR_GCOV_023_060_D_061_4005_DHDH_A_20260618T084927_20260618T085005_P05023_N_F_J_001"
    assert process.name_parts(g)["direction"] == "DESCENDING"


def test_name_parts_rejects_garbage_loudly():
    with pytest.raises((ValueError, IndexError)):
        process.name_parts("not_a_nisar_name")


# ------------------------------------------------------------------ provenance
@pytest.mark.parametrize("ev_id,layer", [(e, l) for e, l in ALL_LAYERS if l["kind"] != "browse"], ids=lambda x: x if isinstance(x, str) else x["id"])
def test_provenance_reproduces_the_shipped_derived_layers(ev_id, layer):
    p = layer["provenance"]
    got = process.provenance(p["collection"], p["granule"], {"processingDateTime": p["processing_date"]}, p["processing"])
    for k in ("mission", "sensor", "granule", "collection", "tier", "crid", "track", "frame", "direction", "product_url", "distributor", "credit", "processing"):
        assert got[k] == p[k], k


def test_provenance_tier_mapping():
    g = "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"
    tiers = {c: process.provenance(c, g, {}, [])["tier"] for c in ["NISAR_L2_GCOV_BETA_V1", "NISAR_L2_GCOV_PROVISIONAL_V1", "NISAR_L2_GCOV_V1"]}
    assert tiers == {"NISAR_L2_GCOV_BETA_V1": "BETA", "NISAR_L2_GCOV_PROVISIONAL_V1": "PROVISIONAL", "NISAR_L2_GCOV_V1": "VALIDATED"}


def test_provenance_tier_knows_urgent_response():
    g = "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"
    assert process.provenance("NISAR_UR_L2_GCOV_V1", g, {}, [])["tier"] == "URGENT RESPONSE"


def test_provenance_reports_missing_processing_date_as_none():
    g = "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"
    assert process.provenance("NISAR_L2_GCOV_V1", g, {}, [])["processing_date"] is None


# ------------------------------------------------------------------ histogram_valley
def bimodal(seed=1, n_w=20_000, n_l=60_000, w_mu=-20.0, l_mu=-8.0, sd=2.0):
    r = np.random.default_rng(seed)
    return np.concatenate([r.normal(w_mu, sd, n_w), r.normal(l_mu, sd, n_l)])


def test_histogram_valley_finds_the_gap_between_water_and_land_modes():
    v = bimodal()
    thr = process.histogram_valley(v)
    assert -17.0 < thr < -11.0, thr
    # it must actually separate the two populations well
    water = v[:20_000] < thr
    land = v[20_000:] >= thr
    assert water.mean() > 0.9 and land.mean() > 0.9


@pytest.mark.parametrize("w_mu,l_mu", [(-22, -8), (-19, -6), (-21, -10)])
def test_histogram_valley_tracks_the_mode_positions(w_mu, l_mu):
    thr = process.histogram_valley(bimodal(w_mu=w_mu, l_mu=l_mu))
    assert w_mu < thr < l_mu
    assert abs(thr - (w_mu + l_mu) / 2) < 4.0


def test_histogram_valley_ignores_nan_and_inf():
    v = np.concatenate([bimodal(), [np.nan] * 1000])
    assert process.histogram_valley(v) == pytest.approx(process.histogram_valley(bimodal()), abs=0.5)




def test_histogram_valley_uses_fallback_for_unimodal_land_scene():
    land_only = np.random.default_rng(3).normal(-8.0, 2.0, 50_000)
    assert process.histogram_valley(land_only, fallback=-15.0) == -15.0


def test_histogram_valley_all_nan_uses_fallback():
    assert process.histogram_valley(np.full(1000, np.nan), fallback=-15.0) == -15.0


def test_histogram_valley_on_the_real_mozambique_scene_matches_the_shipped_threshold():
    """Recompute from the locally cached REAL 17 Jan GCOV subset (pipeline/.cache, untracked); skipped if absent."""
    cfg = process.EVENTS["mozambique-floods-2026"]
    coll, gran = cfg["scenes"]["after"]
    key = hashlib.sha1(f"{gran}{cfg['bbox']}".encode()).hexdigest()[:16]
    path = process.CACHE / f"gcov_{key}.pkl"
    if not path.exists():
        pytest.skip("real GCOV cache not present")
    grid, _ = pickle.loads(path.read_bytes())
    hh = process.db(process.boxcar(grid.data["HHHH"]))
    thr = process.histogram_valley(hh)
    shipped = next(l for e in events if e["id"] == "mozambique-floods-2026" for l in e["layers"] if l["id"] == "water_new")["legend"]["threshold_db"]
    assert -22 < thr < -12
    assert round(thr, 2) == pytest.approx(shipped, abs=0.01)


# ------------------------------------------------------------------ db / boxcar
def test_db_converts_power_to_decibels():
    assert process.db(np.array([1.0, 0.1, 10.0, 0.001])) == pytest.approx([0, -10, 10, -30])


def test_db_nonpositive_is_nan_without_warnings(recwarn):
    out = process.db(np.array([0.0, -1.0, np.nan, 1.0]))
    assert np.isnan(out[:3]).all() and out[3] == 0
    assert not [w for w in recwarn if issubclass(w.category, RuntimeWarning)]


def test_boxcar_keeps_constants_and_averages_in_linear_power():
    assert process.boxcar(np.full((20, 20), 2.5), 5) == pytest.approx(2.5)
    a = np.zeros((9, 9))
    a[4, 4] = 25.0
    out = process.boxcar(a, 5)
    assert out[4, 4] == pytest.approx(1.0)  # 25 spread over a 5x5 window (linear, not dB)
    assert out.sum() == pytest.approx(25.0, rel=0.05)


def test_boxcar_ignores_nan_neighbours_and_keeps_nan_holes_mostly_empty():
    a = np.full((15, 15), 4.0)
    a[7, 7] = np.nan
    out = process.boxcar(a, 5)
    assert out[7, 7] == pytest.approx(4.0)  # filled from the 24 valid neighbours
    b = np.full((15, 15), np.nan)
    b[7, 7] = 4.0
    assert np.isnan(process.boxcar(b, 5)[7, 7])  # a lone valid pixel in a NaN sea: <50% valid -> NaN


# ------------------------------------------------------------------ colorize
def test_colorize_maps_range_ends_to_the_table_ends():
    v = np.array([[-50.0, 0.0, 50.0]])
    rgba = process.colorize(v, -50, 50, process.DIVERGING)
    assert tuple(rgba[0, 0, :3]) == tuple(process.DIVERGING[0]) == (33, 102, 172)
    assert tuple(rgba[0, 2, :3]) == tuple(process.DIVERGING[255]) == (178, 24, 43)
    assert tuple(rgba[0, 1, :3]) in {tuple(process.DIVERGING[127]), tuple(process.DIVERGING[128])}
    assert rgba.dtype == np.uint8 and rgba.shape == (1, 3, 4)
    assert (rgba[..., 3] == 255).all()


def test_colorize_clips_out_of_range_values_but_keeps_them_opaque():
    rgba = process.colorize(np.array([-1e6, 1e6]), -10, 10, process.GRAY)
    assert tuple(rgba[0, :3]) == (0, 0, 0) and tuple(rgba[1, :3]) == (255, 255, 255)
    assert rgba[:, 3].tolist() == [255, 255]


def test_colorize_nan_and_inf_are_fully_transparent():
    rgba = process.colorize(np.array([np.nan, np.inf, -np.inf, 0.0]), -1, 1, process.GRAY)
    assert rgba[:, 3].tolist() == [0, 0, 0, 255]


def test_colorize_alpha_mask_further_restricts_opacity():
    v = np.array([0.0, 0.0, np.nan])
    mask = np.array([True, False, True])
    assert process.colorize(v, -1, 1, process.GRAY, alpha_mask=mask)[:, 3].tolist() == [255, 0, 0]


def test_colorize_gray_is_monotonic():
    v = np.linspace(-25, 0, 50)
    r = process.colorize(v, -25, 0, process.GRAY)[:, 0].astype(int)
    assert (np.diff(r) >= 0).all() and r[0] == 0 and r[-1] == 255


def test_lut_interpolates_between_stops():
    t = process.lut([(0, (0, 0, 0)), (1, (255, 255, 255))], n=3)
    assert t.tolist() == [[0, 0, 0], [127, 127, 127], [255, 255, 255]]


# ------------------------------------------------------------------ to_mercator
def synth_grid(n_r=60, n_c=80, dx=1000.0, x0=480_000.0, y0=1_150_000.0, fill=None):
    x = x0 + dx * np.arange(n_c)
    y = y0 - dx * np.arange(n_r)
    data = {} if fill is None else {"v": np.full((n_r, n_c), fill, np.float32)}
    return Grid(data, x, y, EPSG)


def test_to_mercator_corners_are_lon_lat_of_the_grid_footprint():
    from pyproj import Transformer

    g = synth_grid()
    dst, corners = process.to_mercator(g, np.ones((60, 80), np.float32))
    ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    west, south = ll.transform(g.x[0] - 500, g.y[-1] - 500)
    east, north = ll.transform(g.x[-1] + 500, g.y[0] + 500)
    tl, tr, br, bl = corners
    assert tl[0] == pytest.approx(west, abs=0.02) and tl[1] == pytest.approx(north, abs=0.02)
    assert br[0] == pytest.approx(east, abs=0.02) and br[1] == pytest.approx(south, abs=0.02)
    assert tr[0] > tl[0] and tl[1] > bl[1]  # TL, TR, BR, BL order, north-up
    assert dst.shape[0] > 10 and dst.shape[1] > 10


def test_to_mercator_preserves_values_and_nans():
    g = synth_grid()
    a = np.full((60, 80), 7.5, np.float32)
    a[:, :10] = np.nan
    dst, _ = process.to_mercator(g, a)
    finite = dst[np.isfinite(dst)]
    assert finite.size > 0.7 * dst.size * (70 / 80) * 0.8
    assert np.nanmin(finite) == pytest.approx(7.5, abs=1e-4) and np.nanmax(finite) == pytest.approx(7.5, abs=1e-4)
    assert np.isnan(dst[:, 0]).all() or np.isnan(dst[:, : dst.shape[1] // 10]).any()


def test_to_mercator_nearest_keeps_class_codes_intact():
    from rasterio.warp import Resampling

    g = synth_grid()
    codes = np.full((60, 80), np.nan, np.float32)
    codes[10:30, 10:40] = 2.0
    codes[35:50, 40:70] = 1.0
    dst, _ = process.to_mercator(g, codes, Resampling.nearest)
    assert set(np.unique(dst[np.isfinite(dst)])) == {1.0, 2.0}  # no blended 1.5 values


# ------------------------------------------------------------------ save_layer
def test_save_layer_writes_webp_with_alpha_and_returns_the_relative_url(tmp_path, monkeypatch):
    from PIL import Image

    monkeypatch.setattr(process, "OUT", tmp_path)
    rgba = np.zeros((40, 60, 4), np.uint8)
    rgba[10:20, 10:20] = (200, 50, 50, 255)
    url = process.save_layer("evt", "layer_a", rgba)
    assert url == "data/events/evt/layer_a.webp"
    im = Image.open(tmp_path / "events" / "evt" / "layer_a.webp")
    assert im.mode == "RGBA" and im.size == (60, 40)
    arr = np.asarray(im)
    assert arr[0, 0, 3] == 0 and arr[15, 15, 3] == 255  # transparency survives
    assert abs(int(arr[15, 15, 0]) - 200) < 12


def test_save_layer_downsizes_large_images_keeping_aspect(tmp_path, monkeypatch):
    from PIL import Image

    monkeypatch.setattr(process, "OUT", tmp_path)
    process.save_layer("evt", "big", np.full((400, 800, 4), 255, np.uint8), max_px=200)
    assert Image.open(tmp_path / "events" / "evt" / "big.webp").size == (200, 100)


# ------------------------------------------------------------------ Venezuela: LOS maths through the real code path
def gunw_cfg():
    cfg = dict(process.EVENTS["venezuela-2026"])
    return cfg


def synthetic_gunw(phase_north, phase_south, iono=0.0, coh=0.9, n_r=120, n_c=160):
    """SYNTHETIC GUNW-like Grid: north half (rows < 80) and south half (rows >= 80, contains the far-field reference box)."""
    x = 400_000.0 + 1000.0 * np.arange(n_c) + 500
    y = 1_200_000.0 - 1000.0 * np.arange(n_r) - 500
    ph = np.empty((n_r, n_c), np.float32)
    ph[:80], ph[80:] = phase_north, phase_south
    data = {"phase": ph + iono, "coherence": np.full((n_r, n_c), coh, np.float32), "components": np.ones((n_r, n_c), np.uint16), "iono": np.full((n_r, n_c), iono, np.float32)}
    return Grid(data, x, y, EPSG), {"center_frequency_hz": 1.2575e9, "processingDateTime": "2026-08-11T02:08:40"}


@pytest.fixture
def capture(monkeypatch, tmp_path):
    """Capture what venezuela() hands to to_mercator / save_layer, keeping everything else real."""
    seen = {"los": [], "saved": []}

    def fake_merc(grid, arr, resampling=None):
        seen["los"].append(arr.copy())
        return arr.copy(), [[-69.0, 11.0], [-67.0, 11.0], [-67.0, 10.0], [-69.0, 10.0]]

    def fake_save(event_id, name, rgba, max_px=3072):
        seen["saved"].append((name, rgba))
        return f"data/events/{event_id}/{name}.webp"

    monkeypatch.setattr(process, "to_mercator", fake_merc)
    monkeypatch.setattr(process, "save_layer", fake_save)
    return seen


def test_los_sign_and_magnitude(monkeypatch, capture):
    """phase = -2*pi in the north, 0 in the far-field south: north moved TOWARD the satellite by lambda/2."""
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: synthetic_gunw(-2 * np.pi, 0.0))
    layers = process.venezuela(gunw_cfg())
    los = capture["los"][0]
    expected = LAMBDA_CM / 2  # ~11.9 cm for L-band
    assert np.nanmedian(los[:80]) == pytest.approx(expected, rel=1e-4)
    assert np.nanmedian(los[80:]) == pytest.approx(0.0, abs=1e-4)
    assert 11 < expected < 13
    assert layers[0]["legend"]["stats"]["wavelength_cm"] == round(LAMBDA_CM, 2)
    assert layers[0]["legend"]["units"] == "cm toward satellite (LOS)"


def test_positive_phase_means_motion_away_from_the_satellite(monkeypatch, capture):
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: synthetic_gunw(+np.pi, 0.0))
    process.venezuela(gunw_cfg())
    assert np.nanmedian(capture["los"][0][:80]) == pytest.approx(-LAMBDA_CM / 4, rel=1e-4)  # negative = away


def test_los_is_referenced_to_the_far_field_median(monkeypatch, capture):
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: synthetic_gunw(-2 * np.pi, -1.0))
    process.venezuela(gunw_cfg())
    los = capture["los"][0]
    assert np.nanmedian(los[80:]) == pytest.approx(0.0, abs=1e-4)
    assert np.nanmedian(los[:80]) == pytest.approx(LAMBDA_CM / 2 - 1.0 * LAMBDA_CM / (4 * np.pi), rel=1e-4)


def test_ionosphere_screen_is_subtracted_before_conversion(monkeypatch, capture):
    # uniform iono phase of 0.5 rad on top of the same signal: after subtraction + referencing it must vanish
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: synthetic_gunw(-2 * np.pi, 0.0, iono=0.5))
    process.venezuela(gunw_cfg())
    assert np.nanmedian(capture["los"][0][:80]) == pytest.approx(LAMBDA_CM / 2, rel=1e-4)


def test_low_coherence_and_invalid_components_are_masked(monkeypatch, capture):
    def grid_with_bad_pixels(url, bbox):
        g, meta = synthetic_gunw(-2 * np.pi, 0.0)
        g.data["coherence"][5, 5] = 0.29
        g.data["coherence"][5, 6] = 0.30  # exactly at threshold: kept (>= 0.3)
        g.data["components"][6, 5] = 0
        g.data["components"][6, 6] = 65535
        g.data["phase"][7, 7] = np.nan
        return g, meta

    monkeypatch.setattr(process, "read_gunw", grid_with_bad_pixels)
    process.venezuela(gunw_cfg())
    los = capture["los"][0]
    assert np.isnan(los[5, 5]) and np.isfinite(los[5, 6])
    assert np.isnan(los[6, 5]) and np.isnan(los[6, 6]) and np.isnan(los[7, 7])
    assert np.isfinite(los[8, 8])


def test_before_and_after_share_one_colour_scale_and_colours_are_transparent_where_masked(monkeypatch, capture):
    calls = iter([synthetic_gunw(-0.3, 0.0), synthetic_gunw(-12.0, 0.0)])  # small, then large signal
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: next(calls))
    layers = process.venezuela(gunw_cfg())
    b, a = layers
    assert (b["role"], a["role"]) == ("before", "after")
    assert b["legend"]["vmin"] == a["legend"]["vmin"] == -a["legend"]["vmax"]
    lim = a["legend"]["vmax"]
    assert lim >= 5 and lim % 5 == 0
    assert lim >= abs(-12.0 * LAMBDA_CM / (4 * np.pi))  # large enough to contain the strongest signal
    # the shared stretch makes the weak "before" pair visually near-neutral
    name, rgba = capture["saved"][0]
    assert name == "los_before"
    assert (rgba[..., 3] == 255).all()
    assert abs(int(rgba[10, 10, 0]) - 247) < 30  # near the white midpoint of the diverging ramp


def test_venezuela_layer_metadata_matches_the_real_granules(monkeypatch, capture):
    monkeypatch.setattr(process, "read_gunw", lambda url, bbox: synthetic_gunw(-1.0, 0.0))
    layers = process.venezuela(gunw_cfg())
    shipped = next(e for e in events if e["id"] == "venezuela-2026")
    for l in layers:
        ref = next(x for x in shipped["layers"] if x["id"] == l["id"])
        assert l["acquisition"] == ref["acquisition"]
        assert l["provenance"]["granule"] == ref["provenance"]["granule"]
        assert l["provenance"]["tier"] == ref["provenance"]["tier"] == "PROVISIONAL"
        assert l["kind"] == "los" and l["product"] == "GUNW"
        assert any("NOT corrected" in s for s in l["provenance"]["processing"])  # honest about what is not corrected


# ------------------------------------------------------------------ Mozambique: water classification through the real code path
def synthetic_gcov_pair(n=100, dx=1000.0):
    """SYNTHETIC before/after HH, HV (linear power). Layout (1 pixel = 1 km^2):
        A  rows 10:30  cols 10:30   land -> water            => NEW water  (400 km^2)
        B  rows 10:30  cols 50:70   water on both dates      => permanent  (400 km^2)
        C  rows 50:70  cols 10:30   land -> darker land      => NOT water (darkened 5 dB but still land)
        everything else: land that BRIGHTENS by 3 dB (scene-wide shift, as in the real data)
    """
    x = 400_000.0 + dx * np.arange(n) + dx / 2
    y = 1_100_000.0 - dx * np.arange(n) - dx / 2
    before = np.full((n, n), -8.0)
    after = before + 3.0
    after[10:30, 10:30] = -22.0
    before[10:30, 50:70] = -22.0
    after[10:30, 50:70] = -22.0
    before[50:70, 10:30] = -4.0
    after[50:70, 10:30] = -9.0
    # noise-free except a little deterministic texture so histogram_valley has smooth modes
    # a smooth +-4 dB ramp across the scene plus heavy noise gives both modes realistic width
    rng = np.random.default_rng(5)
    ramp = np.linspace(-4, 4, n)[None, :]
    before = before + ramp + rng.normal(0, 2.5, before.shape)
    after = after + ramp + rng.normal(0, 2.5, after.shape)
    lin = lambda d: (10 ** (d / 10)).astype(np.float32)
    mk = lambda hh: (Grid({"HHHH": lin(hh), "HVHV": lin(hh - 7)}, x, y, EPSG), {"processingDateTime": "2026-02-12T04:07:44"})
    return mk(before), mk(after)


def test_mozambique_water_classes_and_areas(monkeypatch, tmp_path):
    scenes = synthetic_gcov_pair()
    order = {"before": scenes[0], "after": scenes[1]}
    cfg = process.EVENTS["mozambique-floods-2026"]
    by_gran = {cfg["scenes"][r][1]: order[r] for r in ("before", "after")}
    monkeypatch.setattr(process, "cached_gcov", lambda coll, gran, bbox: by_gran[gran])
    saved = {}
    monkeypatch.setattr(process, "to_mercator", lambda g, a, resampling=None: (a.astype(np.float32).copy(), [[0, 1], [1, 1], [1, 0], [0, 0]]))
    monkeypatch.setattr(process, "save_layer", lambda ev, name, rgba, max_px=3072: saved.setdefault(name, rgba) is not None and f"data/events/{ev}/{name}.webp")
    layers = {l["id"]: l for l in process.mozambique(cfg)}
    assert list(layers) == ["hh_db_before", "hh_db_after", "hh_change", "water_new"]

    w = layers["water_new"]
    stats = w["legend"]["stats"]
    assert -20 < w["legend"]["threshold_db"] < -10
    # Truth is 400 km^2 per class. The 5x5 boxcar blurs patch edges into land, so the classified area is
    # biased LOW (16x16 interior = 256 km^2 here): never above truth, and not below ~55 % of it.
    # (The bias is a property of the algorithm: see docs/qa/issues.md ISSUE-QA-16.)
    assert 0.55 * 400 <= stats["new_water_km2"] <= 400 * 1.05
    assert 0.55 * 400 <= stats["water_both_dates_km2"] <= 400 * 1.05
    assert stats["scene_median_change_db"] == pytest.approx(3.0, abs=0.3)
    assert stats["aoi_km2"] == 100 * 100
    # rendered classes sit where the construction put them
    rgba = saved["water_new"]
    assert tuple(rgba[20, 20]) == (40, 160, 255, 255)  # new water
    assert tuple(rgba[20, 60]) == (120, 170, 220, 170)  # water on both dates
    assert rgba[60, 20, 3] == 0  # darkened land is NOT flagged
    assert rgba[80, 80, 3] == 0  # ordinary land
    # the heuristic is documented as such
    assert any("Heuristic" in s for s in w["provenance"]["processing"])


def test_mozambique_scene_wide_brightening_alone_does_not_create_water(monkeypatch):
    """The change criterion exists to stop a +3 dB calibration shift from flooding the map."""
    scenes = synthetic_gcov_pair()
    # remove all water from 'after'
    g_after, meta = scenes[1]
    g_after.data["HHHH"][:] = (10 ** (-5.0 / 10))
    cfg = process.EVENTS["mozambique-floods-2026"]
    by_gran = {cfg["scenes"]["before"][1]: scenes[0], cfg["scenes"]["after"][1]: (g_after, meta)}
    monkeypatch.setattr(process, "cached_gcov", lambda coll, gran, bbox: by_gran[gran])
    monkeypatch.setattr(process, "to_mercator", lambda g, a, resampling=None: (a.astype(np.float32).copy(), [[0, 1], [1, 1], [1, 0], [0, 0]]))
    monkeypatch.setattr(process, "save_layer", lambda ev, name, rgba, max_px=3072: f"data/events/{ev}/{name}.webp")
    layers = {l["id"]: l for l in process.mozambique(cfg)}
    assert layers["water_new"]["legend"]["stats"]["new_water_km2"] == 0.0


# ------------------------------------------------------------------ Krasheninnikov: fixed stretch across dates
def test_krasheninnikov_composite_uses_one_fixed_stretch_for_all_dates(monkeypatch):
    n = 30
    x = 400_000.0 + 1000.0 * np.arange(n) + 500
    y = 6_000_000.0 - 1000.0 * np.arange(n) - 500
    seen = []

    def fake_cached(coll, gran, bbox):
        # same HH on every date (-12.5 dB, mid-range), HV -19.5 dB; one NaN pixel
        hh = np.full((n, n), 10 ** (-12.5 / 10), np.float32)
        hv = np.full((n, n), 10 ** (-19.5 / 10), np.float32)
        hh[0:8, 0:8] = np.nan  # a NaN block (a lone NaN would be filled by the 3x3 boxcar)
        seen.append((coll, gran))
        return Grid({"HHHH": hh, "HVHV": hv}, x, y, 32658), {"processingDateTime": "2026-10-30T00:00:00"}

    saved = {}
    monkeypatch.setattr(process, "cached_gcov", fake_cached)
    monkeypatch.setattr(process, "to_mercator", lambda g, a, resampling=None: (a.astype(np.float32).copy(), [[0, 1], [1, 1], [1, 0], [0, 0]]))
    monkeypatch.setattr(process, "save_layer", lambda ev, name, rgba, max_px=3072: saved.setdefault(name, rgba) is not None and f"data/events/{ev}/{name}.webp")
    layers = process.krasheninnikov(process.EVENTS["krasheninnikov-2026"])
    assert len(layers) == len(process.KRAS_DATES) + 1
    roles = [l["role"] for l in layers[:-1]]
    assert roles[0] == "before" and roles[-1] == "after" and set(roles[1:-1]) == {"timeline"}
    assert layers[-1]["id"] == "hh_change_first_last" and layers[-1]["legend"]["stats"]["median_change_db"] == 0.0
    ids = [l["id"] for l in layers[:-1]]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)  # dated, unique, chronological
    # identical input on every date must give identical pixels (the stretch is fixed, not per-image)
    imgs = [saved[i] for i in ids]
    assert all((im == imgs[0]).all() for im in imgs)
    r, g, b, a = imgs[0][15, 15]
    assert r == b and 100 < r < 170 and 100 < g < 170  # mid-range -> mid-grey-ish after gamma 0.8
    assert imgs[0][2, 2, 3] == 0 and a == 255  # NaN block is transparent
    # last date uses the VALIDATED collection (P05036 CRID), earlier ones PROVISIONAL
    tiers = [l["provenance"]["tier"] for l in layers[:-1]]
    assert tiers[:-1] == ["PROVISIONAL"] * (len(tiers) - 1) and tiers[-1] == "VALIDATED"
    assert layers[0]["acquisition"]["start"] == "2026-06-18T08:49:27Z"


def test_krasheninnikov_composite_legend_describes_both_channels_and_is_handled_by_the_web_legend():
    """ISSUE-QA-15 (fixed during the audit): the composite has no single ramp, so the web LegendBar draws the
    channel mapping itself. The data must therefore state the fixed channel ranges in its `units` text."""
    shipped = next(e for e in events if e["id"] == "krasheninnikov-2026")
    comp = [l for l in shipped["layers"] if l["kind"] != "browse" and l["legend"].get("colormap") == "composite"]
    assert len(comp) == len(process.KRAS_DATES)
    for l in comp:
        u = l["legend"]["units"]
        assert "HH" in u and "HV" in u and "-25..0" in u.replace("−", "-") and "-32..-7" in u.replace("−", "-")
