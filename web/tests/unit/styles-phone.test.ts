// Regression guards for phone / touch layout rules in src/styles.css (audit round 2, group "styles").
// jsdom does no layout, so these tests read the stylesheet and check that the rules exist in the right media
// block and resolve the way the cascade needs. They do NOT replace a browser check at 375 x 812.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, '../../src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Bodies of every top-level block that starts with exactly this at-rule header. */
function blocks(header: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(`${header} {`, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return out;
}

/** Declarations of the rule whose selector list contains `selector` (exact, after whitespace normalising). */
function decl(block: string, selector: string): string | null {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let found: string | null = null;
  while ((m = re.exec(block))) {
    const sels = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (sels.includes(selector)) found = (found ?? '') + m[2];
  }
  return found;
}

const phone = blocks('@media (max-width: 820px)').join('\n');
const touch = blocks('@media (max-width: 820px), (pointer: coarse)').join('\n');
const zOf = (d: string | null) => Number(/z-index:\s*(\d+)/.exec(d ?? '')?.[1] ?? NaN);

describe('styles.css phone rules', () => {
  it('finds both media blocks', () => {
    expect(phone).toContain('--sheet-h');
    expect(touch).toContain('--bar-h: 44px');
  });

  // Finding 5: the drawer (z-index 7) was painted under the bottom sheet (z-index 9), hiding catalog errors.
  it('lifts the drawer above the bottom sheet while a sheet is open', () => {
    const panelZ = zOf(/\n\.panel \{([^}]*)\}/.exec(css)?.[1] ?? null);
    expect(panelZ).toBeGreaterThan(0);
    const popZ = zOf(decl(phone, '.app.has-panel .popover'));
    expect(popZ).toBeGreaterThan(panelZ);
    expect(popZ).toBeLessThan(20); // stays under the tutorial card
    // the top bar (search results live inside it) must stay above the lifted drawer, as it is without a sheet
    expect(zOf(decl(phone, '.app.has-panel .topbar'))).toBeGreaterThan(popZ);
  });

  // Finding 6: collapsing the sheet left the timeline at 52vh, on top of the swipe grip.
  it('moves everything that sits on the sheet down when the sheet is collapsed', () => {
    expect(decl(phone, '.panel.collapsed')).toMatch(/height:\s*120px/);
    expect(decl(phone, '.app:has(.panel.collapsed)')).toMatch(/--sheet-h:\s*120px/);
    expect(decl(phone, '.timeline')).toMatch(/bottom:\s*calc\(var\(--sheet-h\) \+ 8px\)/);
    expect(decl(phone, '.app.has-panel .tutorial')).toMatch(/bottom:\s*calc\(var\(--sheet-h\) \+ 8px\)/);
    expect(decl(phone, '.app.has-panel:has(.timeline) .tutorial')).toMatch(/bottom:\s*calc\(var\(--sheet-h\) \+ 92px\)/);
    // map controls clear the timeline in the collapsed state too, without out-ranking the side-by-side rule
    const sel = '.app:has(.panel.collapsed):where(:has(.timeline)) .maplibregl-ctrl-bottom-left';
    expect(decl(phone, sel)).toMatch(/bottom:\s*calc\(var\(--sheet-h\) \+ 88px\)/);
    expect(phone.indexOf(sel)).toBeGreaterThan(phone.indexOf('.app:has(.timeline) .maplibregl-ctrl-bottom-left'));
    expect(phone.indexOf(sel)).toBeLessThan(phone.indexOf('.app .maps.side .maplibregl-ctrl-bottom-left'));
  });

  // Findings 16 and 40: EN / TR were 36 px wide and the zoom / compass buttons 29 px on touch screens.
  it('gives the language buttons and the map zoom / compass buttons a 44 px hit area', () => {
    expect(decl(touch, '.lang-btn')).toMatch(/min-width:\s*44px/);
    const nav = decl(touch, '.maplibregl-ctrl-group button');
    expect(nav).toMatch(/width:\s*44px/);
    expect(nav).toMatch(/height:\s*44px/);
  });

  it('reserves room for the wider zoom group next to the attribution', () => {
    const d = decl(phone, '.maplibregl-ctrl-bottom-right');
    const px = Number(/max-width:\s*calc\(100% - (\d+)px\)/.exec(d ?? '')?.[1]);
    expect(px).toBeGreaterThanOrEqual(66); // 10 px margin + 44 px button + 2 px border + gap
  });

  it('lays the zoom group out in a row on short phones with sheet + timeline, where a 134 px column cannot fit', () => {
    const short = blocks('@media (max-width: 820px) and (max-height: 780px)').join('\n');
    const base = '.app.has-panel:has(.timeline):not(:has(.panel.collapsed))';
    expect(decl(short, `${base} .maplibregl-ctrl-group`)).toMatch(/display:\s*flex/);
    expect(decl(short, `${base} .maplibregl-ctrl-group button + button`)).toMatch(/border-left/);
    const px = Number(/max-width:\s*calc\(100% - (\d+)px\)/.exec(decl(short, `${base} .maplibregl-ctrl-bottom-right`) ?? '')?.[1]);
    expect(px).toBeGreaterThanOrEqual(154); // 10 + 3 * 44 + 2 border + gap
  });
});
