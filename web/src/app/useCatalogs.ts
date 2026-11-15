import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATALOGS, loadCatalog } from '../lib';
import type { CatalogFile, ContextEvent } from '../types';

/** A catalog cut to its strongest cells: how many are kept, of how many, and the weakest kept size value. */
export interface CatalogLimit { kept: number; total: number; min: number | null }

/** The cut a catalog file declares (cells_kept < cells_total), or null when it holds everything. */
export function catalogLimit(c: CatalogFile): CatalogLimit | null {
  const { cells_kept: kept, cells_total: total } = c;
  if (typeof kept !== 'number' || typeof total !== 'number' || !(kept < total)) return null;
  let min = Infinity;
  for (const e of c.events) if (typeof e.size?.value === 'number' && e.size.value < min) min = e.size.value;
  return { kept, total, min: Number.isFinite(min) ? min : null };
}

/** Event catalogs (USGS, EONET, ...): which are switched on, their loaded events, errors and snapshot dates. */
export function useCatalogs() {
  const [activeCatalogs, setActiveCatalogs] = useState<Set<string>>(() => new Set(CATALOGS.filter((c) => c.defaultOn).map((c) => c.id)));
  const [catalogEvents, setCatalogEvents] = useState<Record<string, ContextEvent[]>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  /** When each catalog snapshot was built (shown so a "last 24 h" layer is never mistaken for live data). */
  const [catalogRetrieved, setCatalogRetrieved] = useState<Record<string, string>>({});
  /** Catalogs that hold only their strongest cells (shown so a missing marker is not read as "no fire"). */
  const [catalogLimits, setCatalogLimits] = useState<Record<string, CatalogLimit>>({});

  // load catalogs on demand when switched on
  useEffect(() => {
    for (const id of activeCatalogs) {
      if (catalogEvents[id] || catalogErrors[id]) continue;
      loadCatalog(id)
        .then((c) => {
          setCatalogEvents((m) => ({ ...m, [id]: c.events }));
          if (typeof c.retrieved === 'string') setCatalogRetrieved((m) => ({ ...m, [id]: c.retrieved }));
          const limit = catalogLimit(c);
          if (limit) setCatalogLimits((m) => ({ ...m, [id]: limit }));
        })
        .catch((e) => setCatalogErrors((m) => ({ ...m, [id]: String(e.message || e) })));
    }
  }, [activeCatalogs, catalogEvents, catalogErrors]);

  const catalogCounts = useMemo(() => Object.fromEntries(Object.entries(catalogEvents).map(([k, v]) => [k, v.length])), [catalogEvents]);

  const onToggleCatalog = useCallback((id: string) => {
    // Toggling a failed catalog is the retry: clear its error so the load effect tries again
    // (loadCatalog drops failed promises from its cache).
    setCatalogErrors((m) => {
      if (!(id in m)) return m;
      const { [id]: _drop, ...rest } = m;
      return rest;
    });
    setActiveCatalogs((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  return { activeCatalogs, catalogEvents, catalogErrors, catalogRetrieved, catalogLimits, catalogCounts, onToggleCatalog };
}
