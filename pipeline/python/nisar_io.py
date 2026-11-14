"""Remote, subset reads of NISAR L2 HDF5 products (GCOV, GUNW) from ASF DAAC.

Only the chunks covering the area of interest are fetched over HTTPS, using an
Earthdata Login bearer token from the EARTHDATA_TOKEN environment variable
(never hard-code or commit it). Pattern follows the ASF NISAR Cookbook.
"""
from __future__ import annotations

import io
import os
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass

import h5py
import numpy as np
from pyproj import Transformer

BLOCK = 4 * 1024 * 1024  # 4 MiB: matches the 4 MiB HDF5 page size ISCE3 writes by default


def _token() -> str | None:
    tok = os.environ.get("EARTHDATA_TOKEN")
    if tok or os.name != "nt":
        return tok
    # Windows: a user-scope variable set after this process started lives only in the registry.
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return winreg.QueryValueEx(k, "EARTHDATA_TOKEN")[0]
    except OSError:
        return None


class _DropAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the Earthdata token to the CDN host ASF redirects to."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers.pop("Authorization", None)
            new.unredirected_hdrs.pop("Authorization", None)
            if "Range" in req.headers:
                new.add_header("Range", req.headers["Range"])
        return new


class RemoteFile(io.RawIOBase):
    """Seekable read-only view of a remote file via HTTP range requests.

    Built for flaky networks: every block fetch is retried with backoff, blocks
    are cached (LRU), and the signed CloudFront URL that ASF redirects to is
    reused until it expires. h5py reads it like a local file.
    """

    def __init__(self, url: str, token: str, block=BLOCK, max_blocks=96):
        self.url, self.block, self.max_blocks = url, block, max_blocks
        self.headers = {"Authorization": f"Bearer {token}"}
        # direct connection (system proxy settings broke DNS on this network)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _DropAuthOnRedirect())
        self.direct: str | None = None  # signed redirect target
        self.cache: OrderedDict[int, bytes] = OrderedDict()
        self.ranges: dict[int, bytes] = {}  # exact prefetched chunk ranges keyed by offset
        self.pos = 0
        self.fetched = 0
        _, self.size = self._get(0, 0)

    def _get(self, start: int, end: int) -> tuple[bytes, int]:
        delay = 1.0
        for attempt in range(8):
            try:
                if self.direct:
                    req = urllib.request.Request(self.direct, headers={"Range": f"bytes={start}-{end}"})
                else:
                    req = urllib.request.Request(self.url, headers={**self.headers, "Range": f"bytes={start}-{end}"})
                with self.opener.open(req, timeout=90) as r:
                    if not self.direct and r.geturl() != self.url:
                        self.direct = r.geturl()
                    cr = r.headers.get("Content-Range")
                    if cr is None:
                        # 200 without Content-Range = the server ignored our Range header
                        raise OSError(f"Server ignored the HTTP Range request for {self.url} (no Content-Range); "
                                      "subset reads are impossible against this endpoint.")
                    data = r.read()
                    total = int(cr.split("/")[-1])
                    self.fetched += len(data)
                    return data, total
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and self.direct:
                    self.direct = None  # signed URL expired: go back through ASF
                    continue
                if e.code in (408, 425, 429):
                    # throttled / timed out: back off, honouring Retry-After when given in seconds
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra and ra.isdigit():
                        delay = max(delay, min(float(ra), 120.0))
                elif e.code < 500:
                    raise
            except (urllib.error.URLError, OSError, TimeoutError):
                pass
            time.sleep(delay)
            delay = min(delay * 2, 30)
        raise OSError(f"Giving up on bytes {start}-{end} of {self.url} after retries")

    def prefetch(self, ranges: list[tuple[int, int]], workers=12):
        """Fetch exact byte ranges (offset, size) concurrently into the range cache."""
        from concurrent.futures import ThreadPoolExecutor
        todo = [(o, s) for o, s in ranges if o not in self.ranges]
        if not todo:
            return
        if not self.direct:
            self._get(0, 0)  # resolve the signed CDN URL once
        def one(r):
            o, s = r
            return o, self._get(o, o + s - 1)[0]
        with ThreadPoolExecutor(workers) as ex:
            for o, data in ex.map(one, todo):
                self.ranges[o] = data

    def _block(self, i: int) -> bytes:
        if i in self.cache:
            self.cache.move_to_end(i)
            return self.cache[i]
        start = i * self.block
        data, _ = self._get(start, min(start + self.block, self.size) - 1)
        self.cache[i] = data
        if len(self.cache) > self.max_blocks:
            self.cache.popitem(last=False)
        return data

    # --- io.RawIOBase interface
    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=io.SEEK_SET):
        self.pos = {io.SEEK_SET: off, io.SEEK_CUR: self.pos + off, io.SEEK_END: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        hit = self.ranges.get(self.pos)  # exact chunk read prefetched earlier
        if hit is not None and len(hit) >= n:
            memoryview(b)[:n] = hit[:n]
            self.pos += n
            return n
        out, got = memoryview(b), 0
        while got < n:
            i, off = divmod(self.pos + got, self.block)
            chunk = self._block(i)[off: off + n - got]
            out[got: got + len(chunk)] = chunk
            got += len(chunk)
        self.pos += n
        return n


def open_remote(url: str) -> h5py.File:
    token = _token()
    if not token:
        raise SystemExit("Set EARTHDATA_TOKEN (Earthdata Login > Generate Token) before running.")
    rf = RemoteFile(url, token)
    f = h5py.File(rf, "r")
    f._remote = rf  # keep a handle for chunk prefetching
    return f


def read_window(f: h5py.File, ds: h5py.Dataset, rs: slice, cs: slice) -> np.ndarray:
    """Prefetch every stored chunk intersecting the window in parallel, then read it."""
    rf: RemoteFile | None = getattr(f, "_remote", None)
    if rf is not None and ds.chunks:
        ch_r, ch_c = ds.chunks
        ranges = []
        for r in range(rs.start - rs.start % ch_r, rs.stop, ch_r):
            for c in range(cs.start - cs.start % ch_c, cs.stop, ch_c):
                info = ds.id.get_chunk_info_by_coord((r, c))
                if info.byte_offset is not None and info.size:
                    ranges.append((info.byte_offset, info.size))
        t = time.time()
        rf.prefetch(ranges)
        mb = sum(s for _, s in ranges) / 1e6
        print(f"  {ds.name.split('/')[-1]}: {len(ranges)} chunks, {mb:.1f} MB in {time.time() - t:.0f}s", flush=True)
    return ds[rs, cs]


@dataclass
class Grid:
    """A geocoded UTM subset: arrays plus pixel-centre coordinate vectors and EPSG."""
    data: dict[str, np.ndarray]
    x: np.ndarray  # eastings (m)
    y: np.ndarray  # northings (m), decreasing down the rows
    epsg: int

    @property
    def transform(self):
        from rasterio.transform import from_origin
        dx = float(self.x[1] - self.x[0])
        dy = float(self.y[0] - self.y[1])
        return from_origin(self.x[0] - dx / 2, self.y[0] + dy / 2, dx, dy)


def _epsg(ds) -> int:
    return int(ds.attrs.get("epsg_code", ds[()]))


def _window(x: np.ndarray, y: np.ndarray, epsg: int, bbox_lonlat):
    """Row/col slices of the UTM grid covering a lon/lat bbox (W, S, E, N)."""
    to_utm = Transformer.from_crs(4326, epsg, always_xy=True)
    w, s, e, n = bbox_lonlat
    xs, ys = to_utm.transform([w, e, e, w], [s, s, n, n])
    c0, c1 = int(np.searchsorted(x, min(xs))), int(np.searchsorted(x, max(xs)))
    r0, r1 = int(np.searchsorted(-y, -max(ys))), int(np.searchsorted(-y, -min(ys)))
    if c1 <= c0 or r1 <= r0:
        raise ValueError("Area of interest does not intersect this product")
    return slice(r0, r1), slice(c0, c1)


def read_gcov(url: str, bbox, pols=("HHHH", "HVHV"), freq="A"):
    """gamma0 power (linear) for the requested polarizations inside bbox."""
    with open_remote(url) as f:
        g = f[f"/science/LSAR/GCOV/grids/frequency{freq}"]
        x, y = g["xCoordinates"][()], g["yCoordinates"][()]
        epsg = _epsg(g["projection"])
        rs, cs = _window(x, y, epsg, bbox)
        data = {p: read_window(f, g[p], rs, cs).astype("float32") for p in pols if p in g}
        if "mask" in g:
            data["mask"] = read_window(f, g["mask"], rs, cs)
        meta = _identification(f)
    return Grid(data, x[cs], y[rs], epsg), meta


def read_gunw(url: str, bbox, pol="HH", freq="A"):
    """Unwrapped phase (rad), coherence, connected components, ionosphere screen."""
    with open_remote(url) as f:
        base = f[f"/science/LSAR/GUNW/grids/frequency{freq}"]
        u = base["unwrappedInterferogram"]
        layer = u[pol]
        cg = u if "xCoordinates" in u else layer  # spec 1.6.0 lists both locations
        x, y = cg["xCoordinates"][()], cg["yCoordinates"][()]
        epsg = _epsg(cg["projection"] if "projection" in cg else u["projection"])
        rs, cs = _window(x, y, epsg, bbox)
        data = {
            "phase": read_window(f, layer["unwrappedPhase"], rs, cs).astype("float32"),
            "coherence": read_window(f, layer["coherenceMagnitude"], rs, cs).astype("float32"),
            "components": read_window(f, layer["connectedComponents"], rs, cs),
        }
        if "ionospherePhaseScreen" in layer:
            data["iono"] = read_window(f, layer["ionospherePhaseScreen"], rs, cs).astype("float32")
        meta = _identification(f)
        meta["center_frequency_hz"] = float(base["centerFrequency"][()])
    return Grid(data, x[cs], y[rs], epsg), meta


def _identification(f: h5py.File) -> dict:
    ident = f["/science/LSAR/identification"]
    out = {}
    for k in ("zeroDopplerStartTime", "zeroDopplerEndTime", "referenceZeroDopplerStartTime",
              "secondaryZeroDopplerStartTime", "trackNumber", "frameNumber", "orbitPassDirection",
              "productVersion", "processingDateTime"):
        if k in ident:
            v = ident[k][()]
            out[k] = v.decode() if isinstance(v, bytes) else (v.item() if hasattr(v, "item") else v)
    return out
