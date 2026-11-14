"""nisar_io against a LOCAL fixture HTTP server serving synthetic HDF5 (see conftest.py).

SYNTHETIC FIXTURES: the HDF5 files below are generated here with h5py following the NISAR L2
GCOV/GUNW layout; they are not NISAR data. The server is a real HTTP server on 127.0.0.1, so
urllib, redirects, Range handling and retries are exercised for real (no mocking of urllib).
"""
from __future__ import annotations

import io
import urllib.error

import h5py
import numpy as np
import pytest

import nisar_io
from nisar_io import RemoteFile, _window, open_remote, read_gcov, read_gunw, read_window

EPSG = 32619  # UTM 19N, covers the synthetic area near lon -67.5


# --------------------------------------------------------------------------- fixtures
def _grid_axes(n_r=120, n_c=160, dx=1000.0):
    x = 400_000.0 + dx * np.arange(n_c) + dx / 2  # eastings, ascending
    y = 1_200_000.0 - dx * np.arange(n_r) - dx / 2  # northings, descending
    return x, y


def _ident(f, **extra):
    g = f.create_group("/science/LSAR/identification")
    g["trackNumber"] = np.int64(162)
    g["frameNumber"] = np.int64(7)
    g["orbitPassDirection"] = np.bytes_(b"Ascending")
    g["zeroDopplerStartTime"] = np.bytes_(b"2026-06-01T10:06:57.000000")
    g["processingDateTime"] = np.bytes_(b"2026-08-11T02:08:40")
    for k, v in extra.items():
        g[k] = v


def make_gcov(path, n_r=120, n_c=160, chunk=(40, 40)):
    x, y = _grid_axes(n_r, n_c)
    rr, cc = np.meshgrid(np.arange(n_r), np.arange(n_c), indexing="ij")
    with h5py.File(path, "w") as f:
        _ident(f)
        g = f.create_group("/science/LSAR/GCOV/grids/frequencyA")
        g["xCoordinates"] = x
        g["yCoordinates"] = y
        p = g.create_dataset("projection", data=np.uint32(EPSG))
        p.attrs["epsg_code"] = np.uint32(EPSG)
        g.create_dataset("HHHH", data=(rr * 1000.0 + cc).astype("float32"), chunks=chunk)  # value encodes position
        g.create_dataset("HVHV", data=(rr + cc / 1000.0).astype("float32"), chunks=chunk)
        # NISAR GCOV mask: 1..N = subswath of a valid sample, 0 = invalid, 255 = outside the swath (dataset description)
        g.create_dataset("mask", data=np.full((n_r, n_c), 1, np.uint8), chunks=chunk)
    return x, y


def make_gunw(path, n_r=60, n_c=80, with_iono=True):
    x, y = _grid_axes(n_r, n_c)
    with h5py.File(path, "w") as f:
        _ident(f)
        base = f.create_group("/science/LSAR/GUNW/grids/frequencyA")
        base["centerFrequency"] = np.float64(1.2575e9)
        u = base.create_group("unwrappedInterferogram")
        u["xCoordinates"] = x
        u["yCoordinates"] = y
        p = u.create_dataset("projection", data=np.uint32(EPSG))
        p.attrs["epsg_code"] = np.uint32(EPSG)
        hh = u.create_group("HH")
        hh.create_dataset("unwrappedPhase", data=np.full((n_r, n_c), -2 * np.pi, np.float32), chunks=(20, 20))
        hh.create_dataset("coherenceMagnitude", data=np.full((n_r, n_c), 0.9, np.float32), chunks=(20, 20))
        hh.create_dataset("connectedComponents", data=np.ones((n_r, n_c), np.uint16), chunks=(20, 20))
        if with_iono:
            hh.create_dataset("ionospherePhaseScreen", data=np.full((n_r, n_c), 0.5, np.float32), chunks=(20, 20))
    return x, y


def file_bytes(path) -> bytes:
    return path.read_bytes()


_REAL_TOKEN_ALLOWED = nisar_io.token_allowed


@pytest.fixture(autouse=True)
def allow_loopback_fixture_server(monkeypatch):
    """The token allowlist is HTTPS + Earthdata/ASF hosts only; the local fixture server is plain http on
    127.0.0.1, so tests explicitly allow exactly that loopback origin (production behaviour is tested below)."""
    monkeypatch.setattr(nisar_io, "token_allowed", lambda url: url.startswith("http://127.0.0.1:") or _REAL_TOKEN_ALLOWED(url))


@pytest.mark.parametrize("url,ok", [
    ("https://nisar.asf.earthdatacloud.nasa.gov/NISAR/x.h5", True),
    ("https://datapool.asf.alaska.edu/x.h5", True),
    ("https://urs.earthdata.nasa.gov/x", True),
    ("http://nisar.asf.earthdatacloud.nasa.gov/NISAR/x.h5", False),   # not HTTPS
    ("https://asf.alaska.edu.evil.example/x.h5", False),               # suffix trick
    ("https://evilasf.alaska.edu.example/x.h5", False),
    ("https://d1234.cloudfront.net/x.h5", False),                     # CDN never gets the token
    ("https://example.com/x.h5", False),
])
def test_token_host_allowlist(url, ok):
    assert _REAL_TOKEN_ALLOWED(url) is ok


def test_remote_file_refuses_to_send_token_to_unlisted_host(token, monkeypatch):
    monkeypatch.setattr(nisar_io, "token_allowed", _REAL_TOKEN_ALLOWED)
    with pytest.raises(ValueError, match="Refusing to send the Earthdata token"):
        RemoteFile("https://example.com/x.h5", token)


@pytest.fixture
def gcov_file(tmp_path):
    p = tmp_path / "g.h5"
    x, y = make_gcov(p)
    return p, x, y


# --------------------------------------------------------------------------- RemoteFile
def test_remote_file_reports_size_and_reads_exact_bytes(make_server, token, tmp_path):
    body = bytes(range(256)) * 400  # 102,400 bytes
    s = make_server(body)
    rf = RemoteFile(s.url, token, block=4096)
    assert rf.size == len(body)
    rf.seek(5000)
    assert rf.read(3000) == body[5000:8000]
    rf.seek(-100, io.SEEK_END)
    assert rf.read(1000) == body[-100:]  # clipped at EOF
    assert rf.read(10) == b""
    rf.seek(10)
    rf.seek(5, io.SEEK_CUR)
    assert rf.tell() == 15


def test_remote_file_uses_range_requests_and_bearer_token(make_server, token):
    s = make_server(b"x" * 20_000)
    rf = RemoteFile(s.url, token, block=4096)
    rf.seek(9000)
    rf.read(10)
    assert all("range" in h for _, h in s.log)
    assert all(h.get("authorization") == f"Bearer {token}" for _, h in s.log)
    assert s.log[0][1]["range"] == "bytes=0-0"  # size probe is one byte, not the whole file
    assert s.log[-1][1]["range"] == "bytes=8192-12287"  # block-aligned


def test_remote_file_block_cache_avoids_refetching(make_server, token):
    s = make_server(b"abcdefgh" * 4096)
    rf = RemoteFile(s.url, token, block=4096)
    rf.seek(0)
    rf.read(100)
    n = len(s.log)
    rf.seek(50)
    rf.read(100)  # same block
    assert len(s.log) == n


def test_remote_file_lru_evicts_oldest_block(make_server, token):
    s = make_server(bytes(range(256)) * 200)
    rf = RemoteFile(s.url, token, block=1024, max_blocks=2)
    for blk in (0, 1, 2):  # fetching block 2 evicts block 0
        rf.seek(blk * 1024)
        rf.read(1)
    assert list(rf.cache) == [1, 2]
    n = len(s.log)
    rf.seek(0)
    rf.read(1)
    assert len(s.log) == n + 1  # block 0 had to be fetched again


# ---- retries ------------------------------------------------------------------------
def test_retries_server_errors_with_exponential_backoff_then_succeeds(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.fail_first = 3  # first 3 requests (including the size probe) get HTTP 503
    rf = RemoteFile(s.url, token, block=1024)
    assert rf.size == 5000
    assert no_sleep == [1.0, 2.0, 4.0]
    rf.seek(100)
    assert rf.read(10) == b"z" * 10


def test_gives_up_after_8_attempts_with_a_clear_error_and_no_token_leak(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.fail_first = 10**6
    with pytest.raises(OSError, match="Giving up on bytes 0-0") as ei:
        RemoteFile(s.url, token)
    assert len(s.log) == 8
    assert token not in str(ei.value)
    assert no_sleep == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0, 30.0][: len(no_sleep)]  # capped at 30 s
    assert max(no_sleep) == 30.0


def test_retries_a_transient_failure_in_the_middle_of_a_read(make_server, token, no_sleep):
    body = bytes(range(256)) * 100
    s = make_server(body)
    rf = RemoteFile(s.url, token, block=1024)  # request 1 = probe
    s.fail_after = (len(s.log) + 1, 502)  # the next request fails once
    rf.seek(2048)
    assert rf.read(100) == body[2048:2148]
    assert no_sleep == [1.0]


def test_client_errors_are_not_retried(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.fail_first = 10**6
    s.fail_code = 404
    with pytest.raises(urllib.error.HTTPError) as ei:
        RemoteFile(s.url, token)
    assert ei.value.code == 404
    assert len(s.log) == 1 and no_sleep == []


def test_unauthorised_origin_is_not_retried(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.require_auth = True
    with pytest.raises(urllib.error.HTTPError) as ei:
        RemoteFile(s.url, "WRONG-TOKEN-NOT-REAL")
    assert ei.value.code == 401
    assert len(s.log) == 1


# ISSUE-QA-03 (both fixed during the audit; kept as regression tests).
def test_rate_limit_429_is_retried(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.fail_first = 2
    s.fail_code = 429
    assert RemoteFile(s.url, token).size == 5000


def test_server_without_range_support_gives_a_clear_error(make_server, token, no_sleep):
    s = make_server(b"z" * 5000)
    s.ignore_range = True
    with pytest.raises(nisar_io.RangeNotSupported, match="ignored the HTTP Range"):
        RemoteFile(s.url, token)
    assert len(s.log) == 1 and no_sleep == []  # a missing Range capability is permanent: no retry storm


# ---- redirects (the Earthdata token must never reach the CDN host) -------------------
def test_redirect_does_not_forward_authorization_but_keeps_range(make_server, token):
    cdn = make_server(bytes(range(256)) * 40)  # plays the signed CloudFront host (another port = another origin)
    origin = make_server(b"")
    origin.redirect_to = cdn.url + "?Signature=abc"
    rf = RemoteFile(origin.url, token, block=2048)
    assert rf.size == 256 * 40
    assert origin.log[0][1]["authorization"] == f"Bearer {token}"  # origin did get the token
    assert len(cdn.log) == 1
    cdn_headers = cdn.log[0][1]
    assert "authorization" not in cdn_headers
    assert cdn_headers["range"] == "bytes=0-0"  # Range survived the redirect
    assert token not in str(cdn.log)


def test_signed_url_is_reused_and_origin_is_not_hit_again(make_server, token):
    body = bytes(range(256)) * 80
    cdn = make_server(body)
    origin = make_server(b"")
    origin.redirect_to = cdn.url
    rf = RemoteFile(origin.url, token, block=1024)
    assert rf.direct == cdn.url
    n_origin = len(origin.log)
    for off in (0, 5000, 12000):
        rf.seek(off)
        assert rf.read(10) == body[off : off + 10]
    assert len(origin.log) == n_origin  # all later blocks went straight to the signed URL
    assert all("authorization" not in h for _, h in cdn.log)


def test_expired_signed_url_falls_back_to_the_origin(make_server, token, no_sleep):
    body = bytes(range(256)) * 80
    cdn = make_server(body)
    origin = make_server(b"")
    origin.redirect_to = cdn.url
    rf = RemoteFile(origin.url, token, block=1024)
    cdn.fail_first = len(cdn.log) + 1  # the next CDN request: 403 (signature expired)
    cdn.fail_code = 403
    n_origin = len(origin.log)
    rf.seek(3000)
    assert rf.read(10) == body[3000:3010]
    assert len(origin.log) == n_origin + 1  # went back through the origin to get a fresh signed URL
    assert origin.log[-1][1]["authorization"] == f"Bearer {token}"


# ---- subset reads: the whole point of RemoteFile ----------------------------------------
def test_reading_a_small_window_downloads_far_less_than_the_file(make_server, token, tmp_path):
    p = tmp_path / "big.h5"
    rng = np.random.default_rng(0)
    with h5py.File(p, "w") as f:
        f.create_dataset("a", data=rng.random((1024, 2048), dtype=np.float32), chunks=(128, 128))
    body = file_bytes(p)
    s = make_server(body)
    rf = RemoteFile(s.url, token, block=64 * 1024)
    with h5py.File(rf, "r") as f:
        got = read_window(f, f["a"], slice(0, 100), slice(0, 100)) if hasattr(f, "_remote") else f["a"][0:100, 0:100]
        with h5py.File(p, "r") as ref:
            np.testing.assert_array_equal(got, ref["a"][0:100, 0:100])
    assert len(body) > 8_000_000
    assert s.bytes_sent < 0.15 * len(body), f"fetched {s.bytes_sent} of {len(body)} bytes"


def test_prefetch_fetches_exact_chunk_ranges_concurrently(make_server, token, tmp_path):
    p = tmp_path / "c.h5"
    make_gcov(p)
    s = make_server(file_bytes(p))
    f = open_remote_from(s.url, token)
    ds = f["/science/LSAR/GCOV/grids/frequencyA/HHHH"]
    out = read_window(f, ds, slice(0, 80), slice(0, 80))  # 2x2 chunks of 40x40
    ref = h5py.File(p, "r")["/science/LSAR/GCOV/grids/frequencyA/HHHH"][0:80, 0:80]
    np.testing.assert_array_equal(out, ref)
    assert len(f._remote.ranges) == 4
    assert f._remote.fetched < len(file_bytes(p))
    f.close()


def open_remote_from(url, token):
    rf = RemoteFile(url, token, block=64 * 1024)
    f = h5py.File(rf, "r")
    f._remote = rf
    return f


# --------------------------------------------------------------------------- _window
def test_window_returns_slices_covering_the_bbox(gcov_file):
    _, x, y = gcov_file
    from pyproj import Transformer

    # lon/lat bbox that is a known sub-rectangle of the UTM grid
    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    x0, x1 = x[40], x[100]
    y0, y1 = y[60], y[20]  # y descending: y[20] is north of y[60]
    west, south = to_ll.transform(x0, y0)
    east, north = to_ll.transform(x1, y1)
    rs, cs = _window(x, y, EPSG, (west, south, east, north))
    assert 36 <= cs.start <= 44 and 96 <= cs.stop <= 104
    assert 16 <= rs.start <= 24 and 56 <= rs.stop <= 64
    # the window must contain the requested rectangle (within one pixel)
    assert x[cs.start] - 1000 <= x0 and x[cs.stop - 1] + 1000 >= x1
    assert y[rs.start] + 1000 >= y1 and y[rs.stop - 1] - 1000 <= y0


def test_window_raises_when_the_aoi_misses_the_product(gcov_file):
    _, x, y = gcov_file
    with pytest.raises(ValueError, match="does not intersect"):
        _window(x, y, EPSG, (10.0, 10.0, 10.5, 10.5))  # far from -67.5 lon
    with pytest.raises(ValueError):
        _window(x, y, EPSG, (-67.0, 40.0, -66.9, 40.1))  # same longitude, wrong latitude


def test_window_clips_a_bbox_that_overlaps_the_edge(gcov_file):
    _, x, y = gcov_file
    from pyproj import Transformer

    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    west, south = to_ll.transform(x[0] - 50_000, y[-1] - 50_000)
    east, north = to_ll.transform(x[10], y[10])
    rs, cs = _window(x, y, EPSG, (west, south, east, north))
    assert cs.start == 0 and rs.stop == len(y)
    assert 0 <= rs.start and cs.stop <= len(x)


# --------------------------------------------------------------------------- read_gcov / read_gunw
def test_read_gcov_end_to_end_over_http(make_server, token, tmp_path, monkeypatch):
    p = tmp_path / "g.h5"
    x, y = make_gcov(p)
    s = make_server(file_bytes(p))
    monkeypatch.setenv("EARTHDATA_TOKEN", token)
    from pyproj import Transformer

    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    west, south = to_ll.transform(x[30], y[70])
    east, north = to_ll.transform(x[90], y[30])
    grid, meta = read_gcov(s.url, (west, south, east, north))
    assert grid.epsg == EPSG
    assert set(grid.data) == {"HHHH", "HVHV", "mask"}
    assert grid.data["HHHH"].dtype == np.float32
    assert grid.data["HHHH"].shape == (len(grid.y), len(grid.x))
    # the value encodes position (row*1000 + col): check it against the coordinate vectors
    r0 = int(round((1_200_000.0 - 500.0 - grid.y[0]) / 1000.0))
    c0 = int(round((grid.x[0] - 400_500.0) / 1000.0))
    assert grid.data["HHHH"][0, 0] == r0 * 1000 + c0
    assert grid.data["HHHH"][-1, -1] == (r0 + len(grid.y) - 1) * 1000 + (c0 + len(grid.x) - 1)
    assert 25 <= c0 <= 35 and 25 <= r0 <= 35
    assert meta["trackNumber"] == 162 and meta["orbitPassDirection"] == "Ascending"
    assert meta["processingDateTime"] == "2026-08-11T02:08:40"


def test_read_gcov_missing_polarisation_is_a_clear_error(make_server, token, tmp_path, monkeypatch):
    """A requested polarisation that the product lacks used to be skipped silently and only failed later
    with a bare KeyError deep in processing; now it fails at the read with the file and the pols it has."""
    p = tmp_path / "g.h5"
    x, y = make_gcov(p)
    with h5py.File(p, "a") as f:
        del f["/science/LSAR/GCOV/grids/frequencyA/HVHV"]
    s = make_server(file_bytes(p))
    monkeypatch.setenv("EARTHDATA_TOKEN", token)
    from pyproj import Transformer

    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, sth = to_ll.transform(x[10], y[50])
    e, n = to_ll.transform(x[50], y[10])
    with pytest.raises(KeyError, match=r"HVHV.*not in product.*HHHH"):
        read_gcov(s.url, (w, sth, e, n))
    grid, _ = read_gcov(s.url, (w, sth, e, n), pols=("HHHH",))  # asking only for what exists still works
    assert "HHHH" in grid.data


@pytest.mark.parametrize("with_iono", [True, False])
def test_read_gunw_end_to_end(make_server, token, tmp_path, monkeypatch, with_iono):
    p = tmp_path / "u.h5"
    x, y = make_gunw(p, with_iono=with_iono)
    s = make_server(file_bytes(p))
    monkeypatch.setenv("EARTHDATA_TOKEN", token)
    from pyproj import Transformer

    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    w, sth = to_ll.transform(x[10], y[40])
    e, n = to_ll.transform(x[50], y[10])
    grid, meta = read_gunw(s.url, (w, sth, e, n))
    assert set(grid.data) == ({"phase", "coherence", "components", "iono"} if with_iono else {"phase", "coherence", "components"})
    assert np.allclose(grid.data["phase"], -2 * np.pi)
    assert np.allclose(grid.data["coherence"], 0.9)
    assert meta["center_frequency_hz"] == 1.2575e9


def test_open_remote_requires_a_token(monkeypatch):
    monkeypatch.setattr(nisar_io, "_token", lambda: None)
    with pytest.raises(SystemExit, match="EARTHDATA_TOKEN"):
        open_remote("http://127.0.0.1:9/never")


def test_token_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("EARTHDATA_TOKEN", "TEST-TOKEN-NOT-REAL")
    assert nisar_io._token() == "TEST-TOKEN-NOT-REAL"


def test_identification_decodes_bytes_and_numpy_scalars(tmp_path):
    p = tmp_path / "i.h5"
    with h5py.File(p, "w") as f:
        _ident(f)
        out = nisar_io._identification(f)
    assert out["trackNumber"] == 162 and isinstance(out["trackNumber"], int)
    assert out["orbitPassDirection"] == "Ascending"
    assert "secondaryZeroDopplerStartTime" not in out


# --------------------------------------------------------------------------- Grid
def test_grid_transform_is_pixel_corner_based(gcov_file):
    _, x, y = gcov_file
    g = nisar_io.Grid({}, x[:4], y[:3], EPSG)
    t = g.transform
    assert (t.a, t.e) == (1000.0, -1000.0)
    assert t * (0, 0) == (x[0] - 500.0, y[0] + 500.0)  # corner of the first pixel, not its centre
