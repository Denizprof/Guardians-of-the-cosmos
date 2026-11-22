// Shared simulation state: the Simulation Lab, the globe and the assistant read and write the same scenarios,
// so a simulation the assistant runs appears on the globe and the assistant can explain one run in the Lab.
import type { SimCategory, SimResult } from './types';

export interface Scenario {
  id: string;
  name: string;
  category: SimCategory;
  params: Record<string, unknown>;
  result: SimResult;
}

interface State {
  scenarios: Scenario[];
  activeId: string | null;
  /** Bumped when the assistant runs a simulation, so the app can open the Lab. */
  openNonce: number;
}

let state: State = { scenarios: [], activeId: null, openNonce: 0 };
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
const MAX = 6;
let seq = 0;

export const simStore = {
  get: (): State => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  add(s: Omit<Scenario, 'id' | 'name'> & { name?: string }, open = false): Scenario {
    seq += 1;
    const sc: Scenario = { ...s, id: `s${seq}`, name: s.name ?? `Scenario ${String.fromCharCode(64 + ((seq - 1) % 26) + 1)}` };
    state = { scenarios: [...state.scenarios, sc].slice(-MAX), activeId: sc.id, openNonce: open ? state.openNonce + 1 : state.openNonce };
    emit();
    return sc;
  },
  setActive(id: string | null): void {
    state = { ...state, activeId: id };
    emit();
  },
  remove(id: string): void {
    const scenarios = state.scenarios.filter((s) => s.id !== id);
    state = { ...state, scenarios, activeId: state.activeId === id ? scenarios[scenarios.length - 1]?.id ?? null : state.activeId };
    emit();
  },
  clear(): void {
    state = { scenarios: [], activeId: null, openNonce: state.openNonce };
    emit();
  },
  active(): Scenario | undefined {
    return state.scenarios.find((s) => s.id === state.activeId);
  },
};
