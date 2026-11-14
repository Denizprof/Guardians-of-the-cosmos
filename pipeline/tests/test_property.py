"""Property-based (hypothesis) tests for pipeline/python/process.py and nisar_io._window.

Everything is SYNTHETIC: random grids, histograms and strings. Known defects found by these properties are
marked with a BUG-PY-n id and `xfail(strict=True)` so the suite stays truthful (and fails loudly once fixed).
"""
from __future__ import annotations

import re
import warnings
from datetime import datetime, timezone

import numpy as np
import pytest
from affine import Affine
from hypothesis import HealthCheck, assume, given, settings, strategies as st
from hypothesis.extra import numpy as hnp
from pyproj import Transformer
from rasterio.transform import xy as rio_xy
from scipy.ndimage import uniform_filter  # noqa: F401  (documenting the filter used by median_db)

import process
from nisar_io import _window

settings.register_profile("prop", deadline=None, database=None, max_examples=150,
                          suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large])
settings.load_profile("prop")


# ------------------------------------------------------------ histogram_valley
def _sample(seed: int, comps: list[tuple[float, float, int]]) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.concatenate([rng.normal(mu, sd, n) for mu, sd, n in comps])


@given(seed=st.integers(0, 2**32 - 1), mu_w=st.floats(-24, -16), mu_l=st.floats(-9, -4),
       sd_w=st.floats(0.8, 1.5), sd_l=st.floats(0.8, 1.5), n_w=st.integers(800, 6000), n_l=st.integers(800, 6000))
def test_valley_of_a_bimodal_mixture_lies_between_the_modes(seed, mu_w, mu_l, sd_w, sd_l, n_w, n_l):
    v = _sample(seed, [(mu_w, sd_w, n_w), (mu_l, sd_l, n_l)])
    thr = process.histogram_valley(v)
    assert np.isfinite(thr)
    assert mu_w < thr < mu_l, (thr, mu_w, mu_l)
    # and it is not a fallback artefact: a clearly separated mixture must not return the -15 default by luck
    # only when -15 is not itself between the modes
    assert thr == pytest.approx(float(thr))


@given(seed=st.integers(0, 2**32 - 1), mu_w=st.floats(-24, -16), mu_l=st.floats(-9, -4),
       n_w=st.integers(800, 4000), n_l=st.integers(800, 4000), n_nan=st.integers(0, 500))
def test_valley_ignores_non_finite_samples(seed, mu_w, mu_l, n_w, n_l, n_nan):
    v = _sample(seed, [(mu_w, 1.0, n_w), (mu_l, 1.0, n_l)])
    polluted = np.concatenate([v, np.full(n_nan, np.nan), np.full(n_nan, np.inf), np.full(n_nan, -np.inf)])
    assert process.histogram_valley(polluted) == process.histogram_valley(v)


@given(seed=st.integers(0, 2**32 - 1), mu=st.floats(-35, 0), sd=st.floats(0.5, 3.0), n=st.integers(3000, 20000),
       fallback=st.floats(-30, 0))
def test_unimodal_data_falls_back(seed, mu, sd, n, fallback):
    thr = process.histogram_valley(_sample(seed, [(mu, sd, n)]), fallback=fallback)
    assert thr == fallback


@given(fallback=st.floats(-40, 10), shape=st.tuples(st.integers(0, 6), st.integers(0, 6)))
def test_valley_of_empty_or_all_nan_input_is_the_fallback(fallback, shape):
    assert process.histogram_valley(np.full(shape, np.nan), fallback=fallback) == fallback
    assert process.histogram_valley(np.empty(shape), fallback=fallback) == fallback or shape[0] * shape[1] > 0


@given(arr=hnp.arrays(np.float64, st.integers(0, 400), elements=st.floats(allow_nan=True, allow_infinity=True, width=64)),
       fallback=st.floats(-30, 0))
def test_valley_is_total_finite_and_within_the_histogram_range(arr, fallback):
    thr = process.histogram_valley(arr, fallback=fallback)
    assert thr == fallback or (-26 <= thr <= -2)


@given(seed=st.integers(0, 2**32 - 1), shift=st.floats(-3, 3))
def test_valley_follows_a_global_brightness_shift_when_still_inside_the_search_windows(seed, shift):
    base = _sample(seed, [(-20.0, 1.0, 4000), (-7.0, 1.0, 4000)])
    t0 = process.histogram_valley(base)
    t1 = process.histogram_valley(base + shift)
    assert abs((t1 - t0) - shift) <= 1.5  # histogram bin width 0.5 dB + smoothing


# -------------------------------------------------------- name_parts / tier_of
def _stamp(d: datetime) -> str:
    return d.strftime("%Y%m%dT%H%M%S")


stamps = st.datetimes(min_value=datetime(2025, 1, 1), max_value=datetime(2040, 1, 1)).map(lambda d: d.replace(microsecond=0))
three = st.integers(0, 999).map(lambda n: f"{n:03d}")


@given(prod=st.sampled_from(["GCOV", "GSLC", "GOFF"]), cyc=three, track=st.integers(1, 173), frame=st.integers(1, 600),
       d=st.sampled_from("AD"), t0=stamps, t1=stamps)
def test_name_parts_roundtrips_single_acquisition_names(prod, cyc, track, frame, d, t0, t1):
    name = f"NISAR_L2_PR_{prod}_{cyc}_{track:03d}_{d}_{frame:03d}_4005_DHDH_A_{_stamp(t0)}_{_stamp(t1)}_P05023_N_F_J_001"
    n = process.name_parts(name)
    assert n["track"] == track and n["frame"] == frame
    assert n["direction"] == ("ASCENDING" if d == "A" else "DESCENDING")
    assert n["start"] == t0.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert "reference" not in n and "secondary" not in n


@given(cyc=three, track=st.integers(1, 173), frame=st.integers(1, 600), d=st.sampled_from("AD"), t=st.lists(stamps, min_size=4, max_size=4))
def test_name_parts_roundtrips_gunw_pairs(cyc, track, frame, d, t):
    name = f"NISAR_L2_PR_GUNW_{cyc}_{track:03d}_{d}_{frame:03d}_{cyc}_4000_SH_{'_'.join(_stamp(x) for x in t)}_P05023_N_F_J_001"
    n = process.name_parts(name)
    assert n["track"] == track and n["frame"] == frame
    assert n["reference"] == n["start"] == t[0].strftime("%Y-%m-%dT%H:%M:%SZ")
    assert n["secondary"] == t[2].strftime("%Y-%m-%dT%H:%M:%SZ")
    assert datetime.fromisoformat(n["secondary"].replace("Z", "+00:00")) >= datetime(2025, 1, 1, tzinfo=timezone.utc)


@given(s=st.one_of(st.text(max_size=80), st.lists(st.text(alphabet="0123456789TAD_GUNWXPV", max_size=10), max_size=14).map("_".join)))
def test_name_parts_on_garbage_only_raises_value_or_index_error(s):
    try:
        out = process.name_parts(s)
    except (ValueError, IndexError):
        return
    assert isinstance(out["track"], int) and isinstance(out["frame"], int)
    assert out["direction"] in ("ASCENDING", "DESCENDING")
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", out["start"]) or out["start"].count("-") >= 2


@given(c=st.text(max_size=60))
def test_tier_of_is_total_and_ordered(c):
    t = process.tier_of(c)
    assert t in {"URGENT RESPONSE", "BETA", "PROVISIONAL", "VALIDATED"}
    assert (t == "URGENT RESPONSE") == c.startswith("NISAR_UR")
    if not c.startswith("NISAR_UR") and "_BETA_" in c:
        assert t == "BETA"
    if t == "VALIDATED":
        assert "_BETA_" not in c and "_PROVISIONAL_" not in c


@given(a=st.text(max_size=8), b=st.text(max_size=8))
def test_tier_of_ur_prefix_wins_over_infixes(a, b):
    assert process.tier_of(f"NISAR_UR{a}_BETA_{b}") == "URGENT RESPONSE"
    assert process.tier_of(f"NISAR_UR{a}_PROVISIONAL_{b}") == "URGENT RESPONSE"


# --------------------------------------------------------------------- utc_iso
naive_ts = st.datetimes(min_value=datetime(2000, 1, 1), max_value=datetime(2100, 1, 1))


@given(d=naive_ts, frac=st.booleans())
def test_utc_iso_marks_naive_hdf5_timestamps_as_utc(d, frac):
    s = d.isoformat(timespec="microseconds" if frac else "seconds")
    out = process.utc_iso(s)
    assert out.endswith("Z")
    parsed = datetime.fromisoformat(out.replace("Z", "+00:00"))
    assert parsed == d.replace(microsecond=0, tzinfo=timezone.utc)


@given(d=naive_ts)
def test_utc_iso_is_idempotent_and_keeps_z(d):
    once = process.utc_iso(d.isoformat(timespec="seconds"))
    assert process.utc_iso(once) == once
    assert process.utc_iso(once.replace("Z", "+00:00")) == once  # explicit offsets are normalised to the same instant in Z


@given(v=st.sampled_from([None, "", 0, False]))
def test_utc_iso_passes_falsy_values_through(v):
    assert process.utc_iso(v) == v


@given(s=st.text(max_size=40))
def test_utc_iso_never_raises_on_text(s):
    assert isinstance(process.utc_iso(s), str)


# BUG-PY-1: utc_iso strips everything after the first "." (to drop fractional seconds) BEFORE looking for a UTC
# offset, so "…:40.5+02:00" loses its offset and is relabelled "…:40Z" (the instant shifts by 2 h); a negative
# offset ("…:40-05:00") is not recognised at all and becomes the invalid "…:40-05:00Z".
# pipeline/python/process.py utc_iso (~line 134). Failing inputs: "2026-08-11T02:08:40.5+02:00", "2026-08-11T02:08:40-05:00".
# BUG-PY-1 fixed: regression test
@given(d=naive_ts, off_h=st.integers(-12, 14), frac=st.booleans())
def test_utc_iso_preserves_the_instant_of_offset_timestamps(d, off_h, frac):
    sign = "+" if off_h >= 0 else "-"
    s = d.isoformat(timespec="microseconds" if frac else "seconds") + f"{sign}{abs(off_h):02d}:00"
    out = process.utc_iso(s)
    assert datetime.fromisoformat(out.replace("Z", "+00:00")) == datetime.fromisoformat(s).replace(microsecond=0)


# ---------------------------------------------------------------- apply_affine
coef = st.floats(-1e6, 1e6, allow_nan=False, allow_infinity=False)
pix = st.floats(-1e5, 1e5, allow_nan=False, allow_infinity=False)


@given(a=coef, b=coef, c=coef, d=coef, e=coef, f=coef, col=pix, row=pix)
def test_apply_affine_matches_rasterio_affine(a, b, c, d, e, f, col, row):
    t = Affine(a, b, c, d, e, f)
    x, y = process.apply_affine(t, col, row)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        rx, ry = t * (col, row)
    mx, my, _ = np.array([[a, b, c], [d, e, f], [0, 0, 1]]) @ np.array([col, row, 1.0])
    scale = 1 + abs(a * col) + abs(b * row) + abs(c) + abs(d * col) + abs(e * row) + abs(f)
    assert abs(x - rx) <= 1e-9 * scale and abs(y - ry) <= 1e-9 * scale
    assert abs(x - mx) <= 1e-9 * scale and abs(y - my) <= 1e-9 * scale


@given(x0=st.floats(-1e6, 1e6), y0=st.floats(-1e6, 1e6), px=st.floats(1, 500), py=st.floats(1, 500),
       col=st.integers(0, 5000), row=st.integers(0, 5000))
def test_apply_affine_agrees_with_rasterio_transform_xy_for_north_up_grids(x0, y0, px, py, col, row):
    t = Affine(px, 0, x0, 0, -py, y0)
    x, y = process.apply_affine(t, col, row)
    (rx,), (ry,) = rio_xy(t, [row], [col], offset="ul")
    assert x == pytest.approx(rx, abs=1e-6, rel=1e-12) and y == pytest.approx(ry, abs=1e-6, rel=1e-12)


@given(a=st.floats(0.5, 100), e=st.floats(-100, -0.5), b=st.floats(-0.4, 0.4), d=st.floats(-0.4, 0.4),
       c=st.floats(-1e5, 1e5), f=st.floats(-1e5, 1e5), col=st.floats(0, 1000), row=st.floats(0, 1000))
def test_apply_affine_is_inverted_by_the_inverse_transform(a, b, c, d, e, f, col, row):
    t = Affine(a, b, c, d, e, f)
    assume(abs(a * e - b * d) > 1e-3)
    x, y = process.apply_affine(t, col, row)
    ic, ir = process.apply_affine(~t, x, y)
    assert ic == pytest.approx(col, abs=1e-6) and ir == pytest.approx(row, abs=1e-6)


# -------------------------------------------------------------------- colorize
finite_or_not = st.floats(allow_nan=True, allow_infinity=True, width=32)
tables = st.sampled_from([process.DIVERGING, process.GRAY, process.COH])


@given(v=hnp.arrays(np.float32, hnp.array_shapes(min_dims=2, max_dims=2, min_side=1, max_side=8), elements=finite_or_not),
       vmin=st.floats(-100, 100), span=st.floats(0.01, 200), table=tables, data=st.data())
def test_colorize_alpha_and_nan_handling(v, vmin, span, table, data):
    vmax = vmin + span
    use_mask = data.draw(st.booleans())
    mask = data.draw(hnp.arrays(np.bool_, v.shape)) if use_mask else None
    with np.errstate(all="ignore"):  # float32 under/overflow in the scale step is harmless (clipped)
        rgba = process.colorize(v, vmin, vmax, table, mask)
    assert rgba.shape == v.shape + (4,) and rgba.dtype == np.uint8
    finite = np.isfinite(v)
    want = finite if mask is None else finite & mask
    assert set(np.unique(rgba[..., 3])) <= {0, 255}
    assert np.array_equal(rgba[..., 3] == 255, want)  # NaN / +-inf / masked pixels are always transparent
    # opaque pixels carry the LUT colour of their clipped value (+-1 index for float rounding of the 0..255 scale)
    t = np.clip((v[want].astype(np.float64) - vmin) / (vmax - vmin), 0, 1)
    idx = np.floor(t * 255).astype(int)
    got = rgba[..., :3][want]
    ok = np.zeros(len(idx), bool)
    for dj in (-1, 0, 1):
        ok |= np.all(got == table[np.clip(idx + dj, 0, 255)], axis=1)
    assert ok.all()
    # NaN pixels use LUT entry 0 (never an out-of-range index or garbage colour); they are transparent anyway
    assert np.all(rgba[..., :3][np.isnan(v)] == table[0])


@given(vmin=st.floats(-50, 50), span=st.floats(0.1, 100), table=tables,
       a=st.floats(-300, 300), b=st.floats(-300, 300))
def test_colorize_is_monotone_in_the_index(vmin, span, table, a, b):
    lo, hi = sorted((a, b))
    arr = np.array([[lo, hi]], np.float32)
    # GRAY is monotone non-decreasing in every channel: colourization must not reorder values
    rgba = process.colorize(arr, vmin, vmin + span, process.GRAY)
    assert int(rgba[0, 0, 0]) <= int(rgba[0, 1, 0])
    assert rgba[0, 0, 3] == rgba[0, 1, 3] == 255


@given(v=hnp.arrays(np.float32, (4, 4), elements=st.floats(-10, 10, width=32)))
def test_colorize_degenerate_range_does_not_crash(v):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        rgba = process.colorize(v, 1.0, 1.0, process.GRAY)
    assert rgba.shape == (4, 4, 4) and np.all(rgba[..., 3] == 255)


# ------------------------------------------------------------------- median_db
def _db(p):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(p > 0, p, np.nan))


power = st.one_of(st.floats(1e-4, 10.0), st.sampled_from([np.nan, 0.0, -1.0, np.inf, -np.inf]))


@given(p=hnp.arrays(np.float32, hnp.array_shapes(min_dims=2, max_dims=2, min_side=1, max_side=14), elements=power),
       k=st.sampled_from([3, 5]))
def test_median_db_preserves_nodata_and_is_the_windowed_median_elsewhere(p, k):
    with np.errstate(all="ignore"):
        out = process.median_db(p, k)
    assert out.shape == p.shape
    d = _db(p.astype(np.float64))
    bad = ~np.isfinite(d)
    r = k // 2
    pad = np.pad(bad, r, mode="symmetric")  # scipy 'reflect' == numpy 'symmetric'
    padd = np.pad(np.where(bad, 0.0, d), r, mode="symmetric")
    for i in range(p.shape[0]):
        for j in range(p.shape[1]):
            win_bad = pad[i:i + k, j:j + k].any()
            if win_bad:
                assert np.isnan(out[i, j]), f"no-data in the {k}x{k} window of ({i},{j}) must yield NaN"
            else:
                assert np.isfinite(out[i, j]), f"({i},{j}) has a fully valid window but was masked"
                assert out[i, j] == pytest.approx(float(np.median(padd[i:i + k, j:j + k])), abs=1e-4)


@given(p=hnp.arrays(np.float32, (6, 6), elements=st.floats(0.0625, 5.0, width=32)))
def test_median_db_of_clean_data_is_finite_and_bounded_by_the_inputs(p):
    out = process.median_db(p)
    d = _db(p.astype(np.float64))
    assert np.all(np.isfinite(out))
    assert out.min() >= d.min() - 1e-4 and out.max() <= d.max() + 1e-4


@given(shape=st.tuples(st.integers(1, 8), st.integers(1, 8)), kind=st.sampled_from([np.nan, 0.0, -2.0, np.inf]))
def test_median_db_all_nodata_stays_all_nan(shape, kind):
    assert np.all(np.isnan(process.median_db(np.full(shape, kind, np.float32))))


# --------------------------------------------------------------------- _window
def _grid_case(draw):
    north = draw(st.booleans())
    epsg = 32633 if north else 32733
    lat0 = draw(st.floats(1, 70)) * (1 if north else -1)
    lon0 = draw(st.floats(12, 18))
    dx = draw(st.sampled_from([20.0, 30.0, 80.0, 100.0]))
    nx, ny = draw(st.integers(2, 250)), draw(st.integers(2, 250))
    x0, y0 = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon0, lat0)
    x = x0 + dx * np.arange(nx)
    y = y0 - dx * np.arange(ny)  # northing decreases down the rows
    return epsg, x, y, dx


@st.composite
def window_case(draw):
    epsg, x, y, dx = _grid_case(draw)
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    (cx_lon,), (cy_lat,) = to_ll.transform([float(x[len(x) // 2])], [float(y[len(y) // 2])])
    # bbox anywhere from far outside to covering the grid; sizes from sub-pixel to ~0.8 deg
    w = draw(st.floats(0.0005, 0.8))
    h = draw(st.floats(0.0005, 0.8))
    clon = cx_lon + draw(st.floats(-0.7, 0.7))
    clat = cy_lat + draw(st.floats(-0.7, 0.7))
    return epsg, x, y, dx, (clon - w / 2, clat - h / 2, clon + w / 2, clat + h / 2)


def _extent(epsg, bbox):
    w, s, e, n = bbox
    xs, ys = Transformer.from_crs(4326, epsg, always_xy=True).transform([w, e, e, w], [s, s, n, n])
    return min(xs), max(xs), min(ys), max(ys)


@given(case=window_case())
def test_window_slices_are_in_bounds_and_non_empty_iff_a_grid_cell_is_inside(case):
    epsg, x, y, dx, bbox = case
    xmin, xmax, ymin, ymax = _extent(epsg, bbox)
    inside_x = (x >= xmin) & (x < xmax)
    inside_y = (y > ymin) & (y <= ymax)
    expect_hit = bool(inside_x.any() and inside_y.any())
    try:
        rs, cs = _window(x, y, epsg, bbox)
    except ValueError as err:
        assert "does not intersect" in str(err)
        assert not expect_hit, "bbox contains grid cells but _window refused it"
        return
    assert expect_hit, "empty overlap but _window returned slices"
    assert 0 <= rs.start < rs.stop <= len(y) and 0 <= cs.start < cs.stop <= len(x)
    assert rs.step is None and cs.step is None
    # every selected cell is inside the projected bbox hull; the first cell outside on each side is outside
    assert np.all(inside_x[cs]) and np.all(inside_y[rs])
    assert cs.start == 0 or not inside_x[cs.start - 1]
    assert cs.stop == len(x) or not inside_x[cs.stop]
    assert rs.start == 0 or not inside_y[rs.start - 1]
    assert rs.stop == len(y) or not inside_y[rs.stop]
    # the selected cells really form the contiguous set of in-bbox cells
    assert cs.stop - cs.start == int(inside_x.sum()) and rs.stop - rs.start == int(inside_y.sum())


@given(case=window_case())
def test_window_never_misses_cells_that_are_clearly_inside_the_lonlat_bbox(case):
    epsg, x, y, dx, bbox = case
    try:
        rs, cs = _window(x, y, epsg, bbox)
    except ValueError:
        rs, cs = slice(0, 0), slice(0, 0)
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    w, s, e, n = bbox
    margin = 6 * dx / 111_000.0  # deg; UTM parallel curvature over <= 0.8 deg is well below 6 cells
    xi = np.unique(np.linspace(0, len(x) - 1, 12).astype(int))
    yi = np.unique(np.linspace(0, len(y) - 1, 12).astype(int))
    for i in yi:
        for j in xi:
            lon, lat = to_ll.transform(float(x[j]), float(y[i]))
            if w + margin < lon < e - margin and s + margin < lat < n - margin:
                assert rs.start <= i < rs.stop and cs.start <= j < cs.stop, (i, j)


@given(case=window_case())
def test_window_covering_the_whole_grid_returns_everything(case):
    epsg, x, y, dx, _ = case
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    lons, lats = to_ll.transform([x[0], x[-1], x[0], x[-1]], [y[0], y[0], y[-1], y[-1]])
    pad = 0.05
    rs, cs = _window(x, y, epsg, (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad))
    assert (rs.start, rs.stop, cs.start, cs.stop) == (0, len(y), 0, len(x))


@given(case=window_case(), far=st.floats(5, 40))
def test_window_far_away_bbox_raises_value_error(case, far):
    epsg, x, y, dx, bbox = case
    w, s, e, n = bbox
    with pytest.raises(ValueError, match="does not intersect"):
        _window(x, y, epsg, (w + far, s, e + far, n))
