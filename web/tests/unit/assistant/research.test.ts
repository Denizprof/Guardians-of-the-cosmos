// The live research client: what it asks the encyclopedia and how it reads the reply. The network is replaced by a
// fake with the service's reply shape here; the acceptance record (assistant-model/ACCEPTANCE.md) uses the real service.
import { describe, expect, it } from 'vitest';
import { createWikipediaResearch, searchTerms } from '../../../src/assistant/local/research';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('searchTerms', () => {
  it.each([
    ['Tell me about Türkiye.', 'Türkiye'],
    ['Explain how gravity works', 'gravity'],
    ['What is quantum physics?', 'quantum physics'],
    ['Türkiye hakkında bilgi ver', 'Türkiye'],
    ['Kuantum fiziği nedir?', 'Kuantum fiziği'],
    ['Give me the latest NISAR mission update.', 'NISAR mission'],
  ])('%s -> %s', (q, terms) => expect(searchTerms(q)).toBe(terms));
});

describe('createWikipediaResearch', () => {
  it('searches, reads the first real page summary and returns it with its address and dates', async () => {
    const urls: string[] = [];
    const research = createWikipediaResearch(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('list=search')) return json({ query: { search: [{ title: 'Turkey (disambiguation)' }, { title: 'Turkey' }] } });
      if (url.includes('disambiguation')) return json({ type: 'disambiguation', extract: 'Turkey may refer to many things, places and birds.' });
      return json({ type: 'standard', title: 'Turkey', extract: 'Turkey, officially the Republic of Türkiye, is a country.', timestamp: '2026-11-10T08:00:00Z', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Turkey' } } });
    });
    const r = await research('Tell me about Türkiye', 'en');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toMatchObject({ title: 'Turkey', url: 'https://en.wikipedia.org/wiki/Turkey', edited: '2026-11-10', site: 'Wikipedia (English)' });
    expect(urls[0]).toMatch(/^https:\/\/en\.wikipedia\.org\/w\/api\.php\?.*srsearch=T%C3%BCrkiye.*origin=\*/);
  });
  it('tries Turkish first for a Turkish question, then English', async () => {
    const hosts: string[] = [];
    const research = createWikipediaResearch(async (input) => {
      const url = String(input);
      hosts.push(new URL(url).host);
      if (url.startsWith('https://tr.')) return json({ query: { search: [] } });
      if (url.includes('list=search')) return json({ query: { search: [{ title: 'Gravity' }] } });
      return json({ extract: 'Gravity is a fundamental interaction that attracts masses.' });
    });
    const r = await research('Yerçekimi nedir?', 'tr');
    expect(hosts).toEqual(['tr.wikipedia.org', 'en.wikipedia.org', 'en.wikipedia.org']);
    expect(r.ok && r.result.site).toBe('Wikipedia (English)');
  });
  it('reports "unavailable" when the service fails, and "nothing-found" when it finds nothing', async () => {
    expect(await createWikipediaResearch(async () => json({}, 503))('x', 'en')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await createWikipediaResearch(async () => { throw new TypeError('Failed to fetch'); })('x', 'en')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await createWikipediaResearch(async () => json({ query: { search: [] } }))('x', 'en')).toEqual({ ok: false, reason: 'nothing-found' });
  });
  it('skips a page that does not mention the subject at all', async () => {
    const research = createWikipediaResearch(async (input) => String(input).includes('list=search')
      ? json({ query: { search: [{ title: 'New Horizons' }] } })
      : json({ title: 'New Horizons', extract: 'New Horizons is an interplanetary space probe launched in 2006.' }));
    expect(await research('latest NISAR update', 'en')).toEqual({ ok: false, reason: 'nothing-found' });
  });
  it('never returns a link to another site, whatever the reply says', async () => {
    const research = createWikipediaResearch(async (input) => String(input).includes('list=search')
      ? json({ query: { search: [{ title: 'X' }] } })
      : json({ extract: 'A long enough summary of the subject for the answer.', content_urls: { desktop: { page: 'https://evil.example/phish' } } }));
    const r = await research('x', 'en');
    expect(r.ok && r.result.url).toBe('https://en.wikipedia.org/wiki/X');
  });
});
