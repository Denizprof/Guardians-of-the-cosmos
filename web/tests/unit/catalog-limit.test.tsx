// A catalog that keeps only its strongest cells (FIRMS fires, to fit a size budget) must say so in the Filters panel.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Filters from '../../src/components/Filters';
import { catalogLimit } from '../../src/app/useCatalogs';
import type { CatalogFile, ContextEvent } from '../../src/types';

const ev = (value?: number): ContextEvent => ({ ...(value === undefined ? {} : { size: { value, unit: 'MW FRP (max)' } }) }) as ContextEvent;
const file = (over: Partial<CatalogFile>): CatalogFile => ({ source: 'firms-fires', provider: '', url: '', license: '', retrieved: '2026-11-14T08:13:59.281Z', count: 0, events: [], ...over });

describe('catalogLimit', () => {
  it('reports kept and total cells and the weakest kept value when the file was cut', () => {
    expect(catalogLimit(file({ cells_total: 7355, cells_kept: 2232, events: [ev(252.3), ev(16), ev(40)] }))).toEqual({ kept: 2232, total: 7355, min: 16 });
  });
  it('is null when nothing was dropped or the file carries no cell counts', () => {
    expect(catalogLimit(file({ cells_total: 10, cells_kept: 10, events: [ev(5)] }))).toBeNull();
    expect(catalogLimit(file({ events: [ev(5)] }))).toBeNull();
  });
  it('has no minimum when the events carry no size', () => {
    expect(catalogLimit(file({ cells_total: 9, cells_kept: 3, events: [ev()] }))).toEqual({ kept: 3, total: 9, min: null });
  });
  it('reads the shipped FIRMS file', () => {
    const shipped = JSON.parse(readFileSync(resolve(__dirname, '../../public/data/catalogs/firms-fires.json'), 'utf8')) as CatalogFile;
    const lim = catalogLimit(shipped);
    if (shipped.cells_kept! < shipped.cells_total!) {
      expect(lim).toEqual({ kept: shipped.cells_kept, total: shipped.cells_total, min: Math.min(...shipped.events.map((e) => e.size!.value)) });
    } else expect(lim).toBeNull();
  });
});

describe('Filters: FIRMS meta line', () => {
  const show = (catalogLimits?: Record<string, { kept: number; total: number; min: number | null }>) =>
    render(
      <Filters
        events={[]} context={[]} visible={new Set()} showContext={false} onSetVisible={() => undefined} onShowContext={() => undefined}
        activeCatalogs={new Set(['firms-fires'])} catalogCounts={{ 'firms-fires': 2232 }} catalogErrors={{}}
        catalogRetrieved={{ 'firms-fires': new Date().toISOString() }} catalogLimits={catalogLimits}
        onToggleCatalog={() => undefined} years={[1900, 2026]} onYears={() => undefined} onClose={() => undefined}
      />,
    );

  it('says how many cells are shown and which fires are missing', () => {
    show({ 'firms-fires': { kept: 2232, total: 7355, min: 16 } });
    const line = screen.getByText('Showing the strongest 2,232 of 7,355 half-degree cells (peak fire power at least 16 MW); weaker fires are not shown.');
    expect(line.closest('p')?.className).toContain('catalog-meta');
  });
  it('leaves out the power threshold when it is unknown', () => {
    show({ 'firms-fires': { kept: 3, total: 9, min: null } });
    expect(screen.getByText('Showing the strongest 3 of 9 half-degree cells; weaker fires are not shown.')).toBeTruthy();
  });
  it('says nothing when the catalog is complete', () => {
    show({});
    expect(screen.queryByText(/Showing the strongest/)).toBeNull();
    expect(screen.getByText(/Snapshot from/)).toBeTruthy();
  });
});
