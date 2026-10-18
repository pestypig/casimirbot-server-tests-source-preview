import { afterEach, expect, it, vi } from 'vitest';
import { fetchHekEventsForWindow } from '../solar-events-hek';
import { createSolarEventImageSelection } from '../../../../shared/solar-event-image-selection';
import { solarHekReferenceUrls } from '../../../../shared/solar-hek-reference-links';

afterEach(() => vi.unstubAllGlobals());

const window = { start: '2026-09-27T00:00:00Z', end: '2026-09-28T00:00:00Z', resultLimit: 2 };

it('reads the current HER array-of-event-objects response without inventing missing fields', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: [
    { kb_archivid: 'ivo://helio-informatics.org/FL_example', event_type: 'FL',
      event_starttime: '2026-09-27T01:00:00', event_endtime: '2026-09-27T01:05:00',
      event_coordsys: 'UTC-HPC-TOPO', hpc_x: 300, hpc_y: -120, hgc_x: -35, hgc_y: -12, frm_name: 'reporting method',
      obs_observatory: 'SDO', ar_noaanum: 14534,
      refs: ['N/A', 'http://solarmonitor.org/example', 'javascript:alert(1)', 'https://example.org/context'] },
    { kb_archivid: 'ivo://helio-informatics.org/AR_example', event_type: 'AR',
      event_starttime: '2026-09-27T01:30:00', event_endtime: '2026-09-27T01:35:00' },
  ], overmax: false }) }));
  vi.stubGlobal('fetch', fetch);

  const events = await fetchHekEventsForWindow(window);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ ivorn: 'ivo://helio-informatics.org/FL_example',
    event_type: 'FL', start: '2026-09-27T01:00:00Z', end: '2026-09-27T01:05:00Z',
    event_coordsys: 'UTC-HPC-TOPO', frm_name: 'reporting method',
    frame: 'reporting method', observatory: 'SDO', noaa_ar: 14534, u: 0.25, v: -0.1,
    hgc_x: -35, hgc_y: -12 });
  expect(events[0].reference_urls).toEqual(['http://solarmonitor.org/example', 'https://example.org/context']);
  expect(createSolarEventImageSelection(events[0], 0, 1)).toMatchObject({
    eventStartUtc: '2026-09-27T01:00:00Z', detectionMethod: 'reporting method',
    relationship: 'contextual_co_occurrence_only', scientificAdmission: false,
  });
  expect(String(fetch.mock.calls[0][0])).toContain('event_coordsys');
  expect(String(fetch.mock.calls[0][0])).toContain('hgc_x');
  expect(events[1].u).toBeUndefined();
  expect(events[1].v).toBeUndefined();
  expect(events[1].start).toBe('2026-09-27T01:30:00');
  expect(createSolarEventImageSelection(events[1], 0, 1)).toBeNull();
  expect(String(fetch.mock.calls[0][0])).toMatch(/^https:\/\/www\.lmsal\.com\/hek\/her\?/);
});

it('retains legacy column-table support and caps returned events to the requested limit', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: {
    columns: ['kb_archivid', 'event_type', 'event_starttime', 'event_endtime'],
    rows: [
      ['ivo://test/1', 'FL', '2026-09-27T01:00:00', '2026-09-27T01:05:00'],
      ['ivo://test/2', 'FL', '2026-09-27T02:00:00', '2026-09-27T02:05:00'],
      ['ivo://test/3', 'FL', '2026-09-27T03:00:00', '2026-09-27T03:05:00'],
    ],
  } }) })));
  const events = await fetchHekEventsForWindow(window);
  expect(events.map(event => event.ivorn)).toEqual(['ivo://test/1', 'ivo://test/2']);
});

it('rejects a paginated HER response instead of presenting its first page as a complete census', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    result: [{ kb_archivid: 'ivo://test/first', event_type: 'FL' }], overmax: true,
  }) })));
  await expect(fetchHekEventsForWindow(window)).rejects.toThrow('HEK_RESULTS_TRUNCATED');
});

it('bounds untrusted catalog references and excludes unsafe or ambiguous links', () => {
  const links = Array.from({ length: 12 }, (_, index) => `https://example.org/${index}`);
  expect(solarHekReferenceUrls(['N/A', 'ftp://example.org/file', 'https://user:pass@example.org/x',
    'https://example.org/line\nbreak', ...links])).toEqual(links.slice(0, 8));
});
