// TEST FIXTURE: a schema-valid AssistantRequest with hand-written context. Not real analysis output.
export function sampleRequest(overrides = {}) {
  return {
    version: '1.0',
    query: 'What does the colour scale show?',
    locale: 'en',
    explanation_level: 'simple',
    context: {
      event: {
        citation_id: 'event:fixture-event',
        id: 'fixture-event',
        title: 'Fixture event',
        category: 'earthquake',
        date: '2026-01-01T00:00:00Z',
        technique: 'insar',
        location: { lon: -67.2, lat: 10.6 },
        references: [{ citation_id: 'ref:fixture-event:0', label: 'Fixture reference', url: 'https://example.org/ref' }],
      },
      selected_layers: [
        {
          citation_id: 'layer:fixture_layer',
          layer_id: 'fixture_layer',
          type: 'derived',
          role: 'after',
          kind: 'los',
          product: 'GUNW',
          legend: { units: 'cm' },
          provenance: {
            mission: 'NISAR',
            granule: 'FIXTURE_GRANULE_001',
            tier: 'PROVISIONAL',
            acquisition: { reference: '2026-06-13T10:06:56Z', secondary: '2026-06-25T10:06:55Z' },
            processing: ['fixture step'],
            origin: 'derived_by_team',
          },
        },
      ],
      map_view: { center: [-67.2, 10.6], zoom: 5, bbox: [-70, 9, -64, 12] },
    },
    ...overrides,
  };
}
