// The Simulation Lab guide: its content must cover every setting of every engine in both registers, the animation
// timelines must be well formed, and the dialog must behave (levels, topics, examples, play/pause, Escape).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SimHelp from '../../../src/components/sim/SimHelp';
import { TOPICS, rangeOf, topicById, topicForCategory } from '../../../src/sim/helpContent';
import { SCENES, stepAt } from '../../../src/sim/helpScenes';
import { ENGINES, runSimulation } from '../../../src/sim/registry';
import type { SimCategory } from '../../../src/sim/types';

beforeEach(() => localStorage.clear());

const ENGINE_TOPICS: SimCategory[] = ['impact', 'earthquake', 'flood', 'tsunami', 'volcano', 'wildfire'];

describe('guide content', () => {
  it.each(ENGINE_TOPICS)('%s: every setting of the engine is explained, with its range', (category) => {
    const topic = TOPICS.find((t) => t.category === category)!;
    const engine = ENGINES[category]!;
    const keys = new Set((topic.settings ?? []).map((s) => s.key).filter(Boolean));
    for (const p of engine.params) {
      expect(keys.has(p.key), `${category}.${p.key} has a help entry`).toBe(true);
      expect(rangeOf(category, p.key)).toContain(`starts at ${p.default.toLocaleString('en-US')}`);
    }
    for (const c of engine.choices) expect(keys.has(c.key), `${category}.${c.key} has a help entry`).toBe(true);
  });

  it('every entry has text in both registers', () => {
    for (const t of TOPICS) {
      const all = [...(t.see ?? []), ...(t.settings ?? []), ...(t.numbers ?? []), ...(t.real ?? [])].map((e) => e.text);
      for (const x of [t.intro, ...all, ...(t.limits ? [t.limits] : [])]) {
        expect(x.simple.trim().length, `${t.id} simple`).toBeGreaterThan(8);
        expect(x.scientific.trim().length, `${t.id} scientific`).toBeGreaterThan(8);
      }
    }
    expect(TOPICS.filter((t) => t.intro.simple === t.intro.scientific)).toHaveLength(0);
  });

  it('topic ids are unique, every event has a topic, and lookups fall back safely', () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const c of ENGINE_TOPICS) expect(topicForCategory(c)).toBe(c);
    expect(topicById('nope').id).toBe('start');
    expect(topicForCategory(undefined)).toBe('start');
  });

  it('every ready-made example is accepted by its engine (nothing out of range)', () => {
    for (const t of TOPICS) {
      if (!t.example) continue;
      const engine = ENGINES[t.example.category]!;
      const defaults = Object.fromEntries([...engine.params.map((p) => [p.key, p.default]), ...engine.choices.map((c) => [c.key, c.default])]);
      expect(engine.validate({ ...defaults, ...t.example.params }).ok, `${t.id} example`).toBe(true);
    }
    expect(runSimulation('impact', { lat: 41, lon: 29, diameter: 500, velocity: 20 }).ok).toBe(true);
  });
});

describe('animation timelines', () => {
  it.each(Object.entries(SCENES))('%s: steps ascend inside the loop and the still frame is the finished picture', (_id, s) => {
    expect(s.steps[0].t).toBe(0);
    for (let i = 1; i < s.steps.length; i++) expect(s.steps[i].t).toBeGreaterThan(s.steps[i - 1].t);
    expect(s.steps[s.steps.length - 1].t).toBeLessThan(s.duration);
    expect(s.still).toBeGreaterThanOrEqual(s.steps[s.steps.length - 1].t);
    expect(s.still).toBeLessThanOrEqual(s.duration);
    expect(s.alt.length).toBeGreaterThan(40);
  });
  it('the scene of every topic exists', () => {
    for (const t of TOPICS) if (t.scene) expect(SCENES[t.scene]).toBeDefined();
  });
  it('stepAt returns the step on screen', () => {
    const s = SCENES.impact;
    expect(stepAt(s, 0)).toBe(0);
    expect(stepAt(s, 3)).toBe(1);
    expect(stepAt(s, 5)).toBe(2);
    expect(stepAt(s, 11.9)).toBe(s.steps.length - 1);
  });
});

describe('the guide dialog', () => {
  const setup = (topic = 'impact') => {
    const onTopic = vi.fn();
    const onClose = vi.fn();
    const onTry = vi.fn();
    const user = userEvent.setup();
    render(<SimHelp topic={topic} onTopic={onTopic} onClose={onClose} onTry={onTry} />);
    return { onTopic, onClose, onTry, user };
  };

  it('is a labelled modal dialog with the topic, an animation and its settings', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: /simulation lab guide/i });
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Asteroid / meteor impact' })).toBeTruthy();
    expect(within(dialog).getByRole('img', { name: /rock falls through the air/i })).toBeTruthy();
    expect(within(dialog).getByText('Impact angle')).toBeTruthy();
    expect(within(dialog).getByText(/5 – 90 ° from horizontal · starts at 45/)).toBeTruthy();
  });

  it('switches between simple and scientific wording and remembers the choice', async () => {
    const { user } = setup();
    const lede = () => document.querySelector('.help-lede')!.textContent;
    expect(lede()).toMatch(/space rock crashes into Earth/);
    await user.click(screen.getByRole('button', { name: 'Scientific' }));
    expect(lede()).toMatch(/Collins, Melosh & Marcus/);
    expect(screen.getByRole('button', { name: 'Scientific' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('sar.simhelp.level')).toBe('scientific');
  });

  it('opens in the remembered level', () => {
    localStorage.setItem('sar.simhelp.level', 'scientific');
    setup('flood');
    expect(document.querySelector('.help-lede')!.textContent).toMatch(/inertial shallow-water/);
  });

  it('lists the circles of the impact event with colour swatches', () => {
    setup();
    for (const name of ['Ground shaking ≈ M4+', 'Airblast ≥ 5 psi (34.5 kPa)', 'Crater', 'Ejecta deposit ≥ 10 cm']) expect(screen.getByText(name)).toBeTruthy();
    expect(document.querySelectorAll('.help-sw').length).toBeGreaterThanOrEqual(8);
  });

  it('navigates topics through the side list', async () => {
    const { user, onTopic } = setup();
    await user.click(screen.getByRole('button', { name: /Wildfire/ }));
    expect(onTopic).toHaveBeenCalledWith('wildfire');
  });

  it('hands the ready-made example to the Lab', async () => {
    const { user, onTry } = setup();
    await user.click(screen.getByRole('button', { name: /500 m asteroid hits Istanbul/ }));
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onTry.mock.calls[0][0]).toMatchObject({ category: 'impact', params: { diameter: 500, velocity: 20 } });
  });

  it('closes with the close button and with Escape', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: /close the guide/i }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('the animation can be paused and played, and a step can be chosen', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Pause the animation' }));
    expect(screen.getByRole('button', { name: 'Play the animation' })).toBeTruthy();
    const steps = screen.getByRole('list', { name: /steps of the animation/i });
    await user.click(within(steps).getAllByRole('button')[2]);
    expect(within(steps).getAllByRole('button')[2].getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('button', { name: 'Pause the animation' })).toBeTruthy(); // choosing a step plays from there
  });

  it('every topic renders in both registers', () => {
    for (const level of ['simple', 'scientific']) {
      localStorage.setItem('sar.simhelp.level', level);
      for (const t of TOPICS) {
        const view = render(<SimHelp topic={t.id} onTopic={() => {}} onClose={() => {}} onTry={() => {}} />);
        expect(screen.getAllByRole('heading', { level: 2, name: t.title }).length).toBeGreaterThan(0);
        view.unmount();
      }
    }
  });
});
