// New spec. Behaviour under test: the AI assistant panel inside an investigation (not connected state, schema-valid
// cited answers, rejection of uncited / invalid responses). Per the user's instruction "debug all code with zillion
// different type tests". The dev build has no VITE_ASSISTANT_GATEWAY_URL, so for the "connected" tests the served
// adapter module is patched in the browser only (helpers.connectAssistantGateway); no app source is touched.
import type { Page, Route } from '@playwright/test';
import { appReady, connectAssistantGateway, expect, openInvestigation, stubExternal, test } from './helpers';

const J = { 'content-type': 'application/json' };
const asst = (p: Page) => p.locator('section.asst');
const input = (p: Page) => p.getByRole('textbox', { name: 'Ask the assistant' });
const send = (p: Page) => p.getByRole('button', { name: 'Send' });

interface Stub { queries: any[] }
type Responder = (req: any) => { status?: number; body: unknown };

async function stubGateway(page: Page, respond: Responder, health: unknown = { status: 'ok', model_configured: true, contract_version: '1.0' }): Promise<Stub> {
  const stub: Stub = { queries: [] };
  await connectAssistantGateway(page);
  await page.route('**/api/assistant/health', (r: Route) => r.fulfill({ status: 200, headers: J, body: JSON.stringify(health) }));
  await page.route('**/api/assistant/query', (r: Route) => {
    const req = JSON.parse(r.request().postData() ?? '{}');
    stub.queries.push(req);
    const out = respond(req);
    return r.fulfill({ status: out.status ?? 200, headers: J, body: JSON.stringify(out.body) });
  });
  return stub;
}

const eventCite = (req: any) => req.context.event.citation_id as string;
const layerCite = (req: any) => req.context.selected_layers[0].citation_id as string;
const okResponse = (req: any) => ({
  version: '1.0',
  status: 'ok',
  answer: { text: `The event is documented [[${eventCite(req)}]].\n\nThe selected scene shows a change [[${layerCite(req)}]].`, format: 'plain' },
  citations: [
    { id: eventCite(req), type: 'reference', label: 'Event record' },
    { id: layerCite(req), type: 'observation', label: 'Selected NISAR scene', granule: 'NISAR_TEST_GRANULE' },
  ],
  confidence: 0.72,
  limitations: ['Test stub: not a real model.'],
});

async function ask(page: Page, q: string) {
  await input(page).fill(q);
  await send(page).click();
}
async function setup(page: Page) {
  await stubExternal(page);
  await appReady(page);
  await openInvestigation(page, /Venezuela earthquakes/);
  // The assistant is a collapsed disclosure in the redesigned panel: it mounts (and checks its gateway) when opened.
  await expect(asst(page)).toHaveCount(0);
  await page.locator('section.panel details.disclosure > summary', { hasText: 'Ask about this investigation' }).click();
  await asst(page).scrollIntoViewIfNeeded();
}

// With no gateway the app uses its in-browser assistant (assistant/local): it answers from the checked knowledge
// base (public/data/assistant/kb.json), the open view and the map's catalog, cites what it used, and says what it
// can help with when a question is outside its field.
test.describe('assistant: in-browser chatbot (no gateway configured)', () => {
  test('answers a radar question from a checked record, with a citation, a note on its source and follow-up suggestions', async ({ page }) => {
    await setup(page);
    await ask(page, 'What is SAR?');
    const reply = asst(page).locator('.asst-assistant');
    await expect(reply.locator('.asst-text')).toContainText(/radar/i);
    await expect(reply.locator('.asst-text')).not.toContainText('[[');
    const chip = reply.getByRole('list', { name: 'Citations' }).locator('.asst-chip');
    await expect(chip.first()).toHaveAttribute('href', /^https:\/\//);
    await expect(reply).toContainText('Answered from the Global SAR knowledge base');
    await expect(reply.getByRole('list', { name: 'Suggested questions' }).getByRole('button').first()).toBeVisible();
  });

  test('"What am I looking at?" is answered from the open investigation', async ({ page }) => {
    await setup(page);
    await asst(page).getByRole('button', { name: 'What am I looking at?' }).click();
    const reply = asst(page).locator('.asst-assistant');
    await expect(reply.locator('.asst-text')).toContainText('Venezuela earthquakes');
    await expect(reply.locator('.asst-chip')).toHaveCount(1);
  });

  test('when live research cannot be reached, a general question says so plainly, with suggestions and no made-up answer', async ({ page }) => {
    await page.route(/wikipedia\.org/, (r) => r.abort());
    await setup(page);
    await ask(page, 'Who won the football world cup?');
    const reply = asst(page).locator('.asst-assistant');
    await expect(reply).toHaveClass(/asst-declined/);
    await expect(reply).not.toHaveClass(/asst-failed/);
    await expect(reply.locator('.asst-text')).toContainText('Live research is not available');
    await expect(reply.locator('.asst-chip')).toHaveCount(0);
    await expect(reply.getByRole('list', { name: 'Suggested questions' }).getByRole('button')).not.toHaveCount(0);
  });

  test('a knowledge base that fails to load is reported, and nothing can be asked', async ({ page, allow }) => {
    allow.console.push(/kb\.json|Failed to load resource/);
    await page.route('**/data/assistant/kb.json', (r) => r.fulfill({ status: 500, body: 'boom' }));
    await setup(page);
    await expect(asst(page).getByRole('heading', { name: 'Assistant unavailable' })).toBeVisible();
    await expect(asst(page)).toContainText('knowledge base could not be loaded');
    await expect(input(page)).toHaveCount(0);
    await expect(send(page)).toHaveCount(0);
  });

  test('the assistant runs from the site itself: its knowledge and classifier load from this origin only', async ({ page }) => {
    const assistantFiles: string[] = [];
    page.on('request', (r) => { if (/kb\.json|intent\.(json|bin)/.test(r.url())) assistantFiles.push(new URL(r.url()).origin); });
    await setup(page);
    await ask(page, 'What is SAR?');
    await expect(asst(page).locator('.asst-assistant')).toHaveCount(1);
    expect(assistantFiles.length).toBeGreaterThanOrEqual(3);
    expect(new Set(assistantFiles)).toEqual(new Set([new URL(page.url()).origin]));
  });

  test('a suggested follow-up can be clicked and is answered', async ({ page }) => {
    await setup(page);
    await ask(page, 'Who made this?');
    const first = asst(page).locator('.asst-assistant').first();
    await expect(first.locator('.asst-text')).toContainText('Guardians of the Cosmos');
    await first.getByRole('list', { name: 'Suggested questions' }).getByRole('button').first().click();
    await expect(asst(page).locator('.asst-assistant')).toHaveCount(2);
  });

  test('"Ask" in the top bar opens the chat as a side panel when no investigation is open', async ({ page }) => {
    await stubExternal(page);
    await appReady(page);
    await page.getByRole('button', { name: 'Ask the assistant' }).click();
    const panel = page.locator('section.panel[aria-label="Assistant"]');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Can radar predict earthquakes?' }).click();
    await expect(panel.locator('.asst-assistant .asst-text')).toContainText(/^No\./);
    await expect(panel.locator('.asst-assistant .asst-chip')).toHaveAttribute('href', /usgs\.gov/);
    await panel.getByRole('button', { name: 'Close panel' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('simple/scientific level toggle is present and exclusive', async ({ page }) => {
    await setup(page);
    const lvl = asst(page).getByRole('group', { name: 'Explanation level' });
    await expect(lvl.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
    await lvl.getByRole('button', { name: 'Scientific' }).click();
    await expect(lvl.getByRole('button', { name: 'Scientific' })).toHaveAttribute('aria-pressed', 'true');
    await expect(lvl.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('assistant: gateway unreachable', () => {
  test('health request failing gives the "could not be reached" state', async ({ page, allow }) => {
    allow.console.push(/Failed to load resource|net::ERR_|Failed to fetch/);
    await connectAssistantGateway(page);
    await page.route('**/api/assistant/health', (r) => r.abort('connectionrefused'));
    await setup(page);
    await expect(asst(page)).toContainText('assistant gateway could not be reached');
    await expect(input(page)).toHaveCount(0);
  });

  test('model not configured (health says so) shows the not-connected state', async ({ page }) => {
    await stubGateway(page, () => ({ body: {} }), { status: 'unavailable', model_configured: false });
    await setup(page);
    await expect(asst(page).getByRole('heading', { name: 'Assistant not connected' })).toBeVisible();
  });
});

test.describe('assistant: stubbed gateway', () => {
  test('answer and citation chips render; markers link to chips; context + question are sent', async ({ page }) => {
    const stub = await stubGateway(page, (req) => ({ body: okResponse(req) }));
    await setup(page);
    await expect(input(page)).toBeEnabled();
    await expect(send(page)).toBeDisabled(); // empty draft
    await ask(page, 'What changed here?');
    const reply = asst(page).locator('.asst-assistant');
    await expect(reply.locator('.asst-text')).toContainText('The event is documented');
    await expect(reply.locator('.asst-text')).toContainText('The selected scene shows a change');
    // raw [[markers]] are replaced by numbered links
    await expect(reply.locator('.asst-text')).not.toContainText('[[');
    await expect(reply.locator('a.asst-mark')).toHaveCount(2);
    await expect(reply.locator('a.asst-mark').first()).toHaveText('[1]');
    // chips
    const chips = reply.getByRole('list', { name: 'Citations' }).locator('.asst-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('Reference');
    await expect(chips.nth(0)).toContainText('Event record');
    await expect(chips.nth(1)).toContainText('Observation');
    await expect(chips.nth(1)).toContainText('Selected NISAR scene');
    await expect(reply).toContainText('Model-reported confidence: 72%');
    await expect(reply).toContainText('Test stub: not a real model.');
    // request contract
    expect(stub.queries).toHaveLength(1);
    expect(stub.queries[0].query).toBe('What changed here?');
    expect(stub.queries[0].version).toBe('1.0');
    expect(stub.queries[0].context.event.id).toBe('venezuela-2026');
    // the user's message is shown and the box was cleared
    await expect(asst(page).locator('.asst-user')).toContainText('What changed here?');
    await expect(input(page)).toHaveValue('');
  });

  test('Enter sends, Shift+Enter inserts a newline', async ({ page }) => {
    const stub = await stubGateway(page, (req) => ({ body: okResponse(req) }));
    await setup(page);
    await input(page).fill('line one');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('line two');
    await expect(input(page)).toHaveValue('line one\nline two');
    expect(stub.queries).toHaveLength(0);
    await input(page).press('Enter');
    await expect(asst(page).locator('.asst-assistant .asst-chip').first()).toBeVisible();
    expect(stub.queries[0].query).toBe('line one\nline two');
  });

  test('follow-up questions send the previous turns as conversation history', async ({ page }) => {
    const stub = await stubGateway(page, (req) => ({ body: okResponse(req) }));
    await setup(page);
    await ask(page, 'First?');
    await expect(asst(page).locator('.asst-assistant')).toHaveCount(1);
    await ask(page, 'Second?');
    await expect(asst(page).locator('.asst-assistant')).toHaveCount(2);
    const conv = stub.queries[1].conversation;
    expect(conv.map((t: any) => t.role)).toEqual(['user', 'assistant']);
    expect(conv[0].content).toBe('First?');
  });

  test('UNCITED answer (status ok, no citations) is rejected: error state, no answer text', async ({ page }) => {
    await stubGateway(page, () => ({ body: { version: '1.0', status: 'ok', answer: { text: 'It was definitely a huge earthquake.', format: 'plain' }, citations: [] } }));
    await setup(page);
    await ask(page, 'Tell me');
    const reply = asst(page).locator('.asst-assistant');
    await expect(reply).toHaveClass(/asst-failed/);
    await expect(reply.getByRole('alert')).toContainText('did not match the contract and was discarded');
    await expect(asst(page)).not.toContainText('definitely a huge earthquake');
    await expect(reply.locator('.asst-chip')).toHaveCount(0);
  });

  test('citation id that is NOT in the request context is rejected (anti-fabrication)', async ({ page }) => {
    await stubGateway(page, () => ({
      body: { version: '1.0', status: 'ok', answer: { text: 'Invented fact [[made:up]].', format: 'plain' }, citations: [{ id: 'made:up', type: 'reference', label: 'Fake' }] },
    }));
    await setup(page);
    await ask(page, 'Anything?');
    await expect(asst(page).locator('.asst-assistant').getByRole('alert')).toContainText('discarded');
    await expect(asst(page)).not.toContainText('Invented fact');
  });

  test('answer marker without a matching citation is rejected', async ({ page }) => {
    await stubGateway(page, (req) => ({
      body: { version: '1.0', status: 'ok', answer: { text: `Ok [[${eventCite(req)}]] but also [[ghost:1]].`, format: 'plain' }, citations: [{ id: eventCite(req), type: 'reference', label: 'Event' }] },
    }));
    await setup(page);
    await ask(page, 'Q');
    await expect(asst(page).locator('.asst-assistant').getByRole('alert')).toContainText('discarded');
  });

  test('schema violations are rejected: unknown property, bad version, javascript: citation url', async ({ page }) => {
    const bodies: ((req: any) => unknown)[] = [
      (req) => ({ ...okResponse(req), extra: 'nope' }),
      (req) => ({ ...okResponse(req), version: '2.0' }),
      (req) => ({ ...okResponse(req), citations: [{ id: eventCite(req), type: 'reference', label: 'E', url: 'javascript:alert(1)' }, { id: layerCite(req), type: 'observation', label: 'L' }] }),
    ];
    let i = 0;
    await stubGateway(page, (req) => ({ body: bodies[i++ % bodies.length](req) }));
    await setup(page);
    for (let n = 1; n <= bodies.length; n++) {
      await ask(page, `q${n}`);
      await expect(asst(page).locator('.asst-assistant.asst-failed')).toHaveCount(n);
    }
    await expect(asst(page).locator('.asst-chip')).toHaveCount(0);
  });

  test('HTML in an answer is rendered as text, never as markup', async ({ page }) => {
    await stubGateway(page, (req) => ({
      body: { ...okResponse(req), answer: { text: `<img src=x onerror="window.__xss=1"> <b>bold</b> [[${eventCite(req)}]] [[${layerCite(req)}]]`, format: 'markdown' } },
    }));
    await setup(page);
    await ask(page, 'xss?');
    await expect(asst(page).locator('.asst-assistant .asst-text')).toContainText('<img src=x');
    await expect(asst(page).locator('.asst-assistant .asst-text img, .asst-assistant .asst-text b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('gateway error response (503 with contract error body) shows its message', async ({ page, allow }) => {
    allow.console.push(/503/);
    await stubGateway(page, () => ({ status: 503, body: { version: '1.0', status: 'unavailable', error: { code: 'overloaded', message: 'Model is busy, try later.' } } }));
    await setup(page);
    await ask(page, 'hello');
    await expect(asst(page).locator('.asst-assistant').getByRole('alert')).toContainText('Model is busy, try later.');
  });

  test('gateway returning HTML (non-JSON) gives a clear error, not a crash', async ({ page, allow }) => {
    allow.console.push(/502|500/);
    await connectAssistantGateway(page);
    await page.route('**/api/assistant/health', (r) => r.fulfill({ status: 200, headers: J, body: JSON.stringify({ status: 'ok', model_configured: true }) }));
    await page.route('**/api/assistant/query', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
    await setup(page);
    await ask(page, 'hello');
    await expect(asst(page).locator('.asst-assistant').getByRole('alert')).toContainText('non-JSON response');
  });

  test('busy state: "Thinking…" shown and Send disabled while waiting', async ({ page }) => {
    await connectAssistantGateway(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/assistant/health', (r) => r.fulfill({ status: 200, headers: J, body: JSON.stringify({ status: 'ok', model_configured: true }) }));
    await page.route('**/api/assistant/query', async (r) => {
      const req = JSON.parse(r.request().postData() ?? '{}');
      await gate;
      await r.fulfill({ status: 200, headers: J, body: JSON.stringify(okResponse(req)) });
    });
    await setup(page);
    await ask(page, 'slow one');
    await expect(asst(page).getByText('Thinking…')).toBeVisible();
    await expect(asst(page).getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await expect(send(page)).toBeDisabled();
    release();
    await expect(asst(page).locator('.asst-assistant .asst-chip').first()).toBeVisible();
    await expect(asst(page).getByText('Thinking…')).toHaveCount(0);
  });
});
