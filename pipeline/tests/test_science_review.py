"""Regression tests added after the multi-agent code review (test-gap and silent-failure findings).

SYNTHETIC inputs only: small arrays with known answers, never NISAR data.
"""
from __future__ import annotations

import numpy as np
import pytest
from pyproj import Transformer

import nisar_io
import process
from nisar_io import Grid


# ------------------------------------------------------------------ GCOV validity mask
def test_validity_mask_blanks_invalid_and_fill_samples_only():
    hh = np.ones((2, 2), np.float32)
    hv = np.full((2, 2), 0.5, np.float32)
    mask = np.array([[1, 0], [255, 2]], np.uint8)  # 1..N subswath = valid, 0 = invalid, 255 = outside swath
    g, frac = nisar_io.apply_validity_mask(Grid({"HHHH": hh, "HVHV": hv, "mask": mask}, np.arange(2.0), np.arange(2.0), 32619))
    assert np.isnan(g.data["HHHH"]).tolist() == [[False, True], [True, False]]
    assert np.isnan(g.data["HVHV"]).tolist() == [[False, True], [True, False]]
    assert frac == 0.5
    assert g.data["mask"].tolist() == [[1, 0], [255, 2]]  # the mask itself is untouched


def test_validity_mask_is_a_no_op_without_a_mask():
    hh = np.ones((2, 2), np.float32)
    g, frac = nisar_io.apply_validity_mask(Grid({"HHHH": hh}, np.arange(2.0), np.arange(2.0), 32619))
    assert frac == 0.0 and np.isfinite(g.data["HHHH"]).all()


def test_provenance_records_the_mask_step_for_gcov_only():
    gran = "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001"
    with_mask = process.provenance("NISAR_L2_GCOV_BETA_V1", gran, {"masked_fraction": 0.0002}, ["step"])
    assert with_mask["processing"][0] == "step"
    assert "validity mask" in with_mask["processing"][-1] and "0.02 %" in with_mask["processing"][-1]
    without = process.provenance("NISAR_L2_GCOV_BETA_V1", gran, {}, ["step"])
    assert without["processing"] == ["step"]


# ------------------------------------------------------------------ threshold fallback must be reported
def test_histogram_valley_info_flags_the_fallback():
    rng = np.random.default_rng(0)
    bimodal = np.concatenate([rng.normal(-20, 1, 5000), rng.normal(-7, 1, 5000)])
    thr, used = process.histogram_valley_info(bimodal)
    assert not used and -16 < thr < -10
    unimodal = rng.normal(-8, 1, 10000)
    thr, used = process.histogram_valley_info(unimodal)
    assert used and thr == -15.0
    assert process.histogram_valley_info(np.array([np.nan]))[1] is True
    assert process.histogram_valley(unimodal) == -15.0  # float API unchanged


# ------------------------------------------------------------------ same_grid guard
def _grid(nx=10, ny=8, dx=100.0, x0=500_000.0, y0=4_000_000.0, epsg=32613):
    x = x0 + dx * np.arange(nx) + dx / 2
    y = y0 - dx * np.arange(ny) - dx / 2
    return Grid({}, x, y, epsg)


@pytest.mark.parametrize("other", [
    _grid(epsg=32614),           # different UTM zone
    _grid(nx=11),                # different shape
    _grid(x0=500_100.0),         # shifted by one pixel
])
def test_same_grid_refuses_misregistered_scenes(other):
    with pytest.raises(RuntimeError, match="grids differ"):
        process.same_grid(_grid(), other, "test")


def test_same_grid_accepts_identical_grids():
    process.same_grid(_grid(), _grid(), "test")


# ------------------------------------------------------------------ hv_series (vegetation-loss workflow)
GRAN_BEFORE = "NISAR_L2_PR_GCOV_024_019_A_021_4005_DHDH_A_20260627T121117_20260627T121152_P05023_N_F_J_001"
GRAN_AFTER = "NISAR_L2_PR_GCOV_028_019_A_021_4005_DHDH_A_20260814T121114_20260814T121149_P05023_N_F_J_001"


def _stub_outputs(monkeypatch):
    monkeypatch.setattr(process, "to_mercator", lambda g, a, resampling=None: (a.astype(np.float32).copy(), [[0, 1], [1, 1], [1, 0], [0, 0]]))
    monkeypatch.setattr(process, "save_layer", lambda ev, name, rgba, max_px=3072, categorical=False: f"data/events/{ev}/{name}.webp")


def test_hv_series_removes_the_scene_offset_and_measures_the_loss_patch(monkeypatch):
    """Before: HV -15 dB everywhere. After: +1 dB everywhere (moisture/calibration offset) except a 20x20
    patch that dropped to -21 dB (6 dB below before, 7 dB below the scene median change)."""
    n, dx, epsg = 60, 100.0, 32613
    x = 500_000.0 + dx * np.arange(n) + dx / 2
    y = 4_200_000.0 - dx * np.arange(n) - dx / 2
    lin = lambda d: np.full((n, n), 10 ** (d / 10), np.float32)
    before_hv, after_hv, hh = lin(-15), lin(-14), lin(-10)
    after_hv[20:40, 10:30] = 10 ** (-21 / 10)

    # validation box = exactly the right half of the patch (cols 20..29, rows 20..39), in lon/lat
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    w, s = to_ll.transform(x[20] - 1, y[39] - 1)
    e, nn = to_ll.transform(x[29] + 1, y[20] + 1)
    cfg = {"bbox": (0, 0, 1, 1), "what": "test loss", "validate_bbox": (w, s, e, nn), "scenes": [
        ("before", "NISAR_L2_GCOV_PROVISIONAL_V1", GRAN_BEFORE),
        ("after", "NISAR_L2_GCOV_PROVISIONAL_V1", GRAN_AFTER),
    ]}
    monkeypatch.setitem(process.HV_EVENTS, "test-hv", cfg)
    monkeypatch.setattr(process, "cached_gcov", lambda coll, gran, bbox: (
        Grid({"HHHH": hh.copy(), "HVHV": (before_hv if gran == GRAN_BEFORE else after_hv).copy()}, x, y, epsg),
        {"processingDateTime": "2026-08-20T00:00:00"}))
    _stub_outputs(monkeypatch)

    change = next(l for l in process.hv_series("test-hv") if l["id"] == "hv_change")
    st = change["legend"]["stats"]
    px_km2 = dx * dx / 1e6
    assert st["hv_loss_km2"] == pytest.approx(round(400 * px_km2, 1))  # 3x3 median keeps a 20x20 block intact
    assert st["median_change_db"] == pytest.approx(1.0, abs=1e-3)       # the offset was measured...
    assert st["aoi_km2"] == round(n * n * px_km2, 0)
    assert st["validation_box_km2"] == pytest.approx(round(200 * px_km2, 1))
    assert st["hv_loss_in_validation_box_km2"] == pytest.approx(round(200 * px_km2, 1))
    assert change["role"] == "change" and change["kind"] == "change"


def test_hv_series_does_not_count_a_uniform_calibration_offset_as_loss(monkeypatch):
    """Guards the offset step: a uniform -4 dB scene-wide change must NOT count as canopy loss."""
    n = 30
    x = 500_000.0 + 100.0 * np.arange(n) + 50
    y = 4_200_000.0 - 100.0 * np.arange(n) - 50
    lin = lambda d: np.full((n, n), 10 ** (d / 10), np.float32)
    cfg = {"bbox": (0, 0, 1, 1), "what": "t", "scenes": [
        ("before", "NISAR_L2_GCOV_PROVISIONAL_V1", GRAN_BEFORE),
        ("after", "NISAR_L2_GCOV_PROVISIONAL_V1", GRAN_AFTER),
    ]}
    monkeypatch.setitem(process.HV_EVENTS, "test-hv2", cfg)
    monkeypatch.setattr(process, "cached_gcov", lambda c, g, b: (
        Grid({"HHHH": lin(-10), "HVHV": lin(-15 if g == GRAN_BEFORE else -19)}, x, y, 32613), {}))
    _stub_outputs(monkeypatch)
    st = next(l for l in process.hv_series("test-hv2") if l["id"] == "hv_change")["legend"]["stats"]
    assert st["median_change_db"] == pytest.approx(-4.0, abs=1e-3)
    assert st["hv_loss_km2"] == 0.0


# ------------------------------------------------------------------ to_mercator places pixels correctly
def test_to_mercator_places_a_hot_pixel_at_its_true_position():
    """Asymmetric input: one hot pixel off-centre. A N/S flip, transpose or corner-order mistake moves it."""
    n, dx, epsg = 40, 500.0, 32633
    x = 400_000.0 + dx * np.arange(n) + dx / 2
    y = 5_000_000.0 - dx * np.arange(n) - dx / 2
    arr = np.zeros((n, n), np.float32)
    r0, c0 = 7, 29  # near the top-right
    arr[r0, c0] = 100.0
    merc, corners = process.to_mercator(Grid({}, x, y, epsg), arr, process.Resampling.nearest)
    (lon_tl, lat_tl), (lon_tr, _), (lon_br, lat_br), _ = corners  # TL, TR, BR, BL (MapLibre image order)
    assert lon_tl < lon_tr and lat_tl > lat_br  # north up, west left
    rr, cc = np.unravel_index(np.nanargmax(merc), merc.shape)
    h, w = merc.shape
    to_m = Transformer.from_crs(4326, 3857, always_xy=True)
    (mx0, my0), (mx1, my1) = to_m.transform(lon_tl, lat_tl), to_m.transform(lon_br, lat_br)
    mx = mx0 + (cc + 0.5) / w * (mx1 - mx0)
    my = my0 + (rr + 0.5) / h * (my1 - my0)
    lon, lat = Transformer.from_crs(3857, 4326, always_xy=True).transform(mx, my)
    ex, ey = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    assert abs(ex - x[c0]) < 1.5 * dx and abs(ey - y[r0]) < 1.5 * dx, (ex - x[c0], ey - y[r0])
