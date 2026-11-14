/**
 * When should a failing tile source tell the user "data failed to load"?
 *
 * A source that has delivered tiles and then fails on a few (sporadic HTTP 500s, tiles outside its coverage)
 * is working: log only. A source that keeps failing without ever delivering a tile is broken: notify once.
 *
 * The record is kept per KEY, and the key must change whenever the content of a source changes (MapView uses
 * "<sourceId>|<tile URL>"): a satellite layer re-added for another date keeps its source id, and a date whose
 * tiles all fail must not inherit "has delivered" from the date that worked.
 */
export function createTileErrorPolicy(threshold = 3) {
  const delivered = new Set<string>();
  const failures = new Map<string, number>();
  return {
    delivered(key: string) {
      delivered.add(key);
    },
    hasDelivered: (key: string) => delivered.has(key),
    /** Count one failure. 'notify' is returned exactly once per key, when the threshold is reached. */
    failed(key: string): { action: 'log' | 'notify'; count: number } {
      const count = (failures.get(key) ?? 0) + 1;
      failures.set(key, count);
      return { action: !delivered.has(key) && count === threshold ? 'notify' : 'log', count };
    },
  };
}
