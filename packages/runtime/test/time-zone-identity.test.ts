import { describe, expect, it } from 'vitest';

import { timeZone } from '../src/formatting.js';

/**
 * A stored zone identity is compared, persisted and exchanged, so the spelling that comes back has
 * to be the pinned time-zone database's own and not whatever the host's presentation data prefers.
 * The pairs are names of the pinned release: zones, former names that survive only as links in its
 * `backward` file, links its `zone.tab` still lists for a country, and former names the release
 * links across a border.
 */

const ZONES = ['Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh'] as const;
const LINKS = [
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Europe/Kiev', 'Europe/Kyiv'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['US/Pacific', 'America/Los_Angeles'],
] as const;

describe('a time-zone identity', () => {
  it.each(ZONES)('keeps the database zone %s as it is', (id) => {
    expect(timeZone(id).id).toBe(id);
  });

  it.each(LINKS)('resolves the link %s to the zone %s', (link, zone) => {
    expect(timeZone(link).id).toBe(zone);
  });

  // The release links both to a neighbor that has kept the same clock since 1970, and zone.tab
  // still lists each for its own country. Following the link would store Norway's zone as
  // Germany's.
  it.each(['Europe/Oslo', 'Africa/Accra', 'America/Atikokan'])(
    'keeps %s, which its country still calls its own',
    (id) => {
      expect(timeZone(id).id).toBe(id);
    },
  );

  // Each line carries the name the link stands for in a "#=" comment, because the data refrains
  // from linking to a link.
  it.each([
    ['Africa/Asmera', 'Africa/Asmara'],
    ['Iceland', 'Atlantic/Reykjavik'],
    ['Pacific/Truk', 'Pacific/Chuuk'],
  ])(
    'resolves %s to %s, the name its line says it stands for',
    (link, zone) => {
      expect(timeZone(link).id).toBe(zone);
    },
  );

  // The release links each to a zone of another country. Mali, and Svalbard and Jan Mayen, have
  // one zone.tab line each; Canada, Antarctica and Micronesia have several, so the answer is the
  // name the release's `backzone` file says the former name stood for.
  it.each([
    ['Africa/Timbuktu', 'Africa/Bamako'],
    ['Atlantic/Jan_Mayen', 'Arctic/Longyearbyen'],
    ['America/Coral_Harbour', 'America/Atikokan'],
    ['Antarctica/South_Pole', 'Antarctica/McMurdo'],
    ['Pacific/Yap', 'Pacific/Chuuk'],
  ])(
    'resolves the former name %s inside its own country, to %s',
    (link, zone) => {
      expect(timeZone(link).id).toBe(zone);
    },
  );

  it.each(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Greenwich'])(
    'reads %s as UTC',
    (id) => {
      expect(timeZone(id).id).toBe('UTC');
    },
  );

  it('matches a name without regard to case and answers in the database spelling', () => {
    expect(timeZone('asia/calcutta').id).toBe('Asia/Kolkata');
    expect(timeZone('EUROPE/OSLO').id).toBe('Europe/Oslo');
  });

  it('leaves a fixed offset the table does not carry in the host spelling', () => {
    expect(timeZone('Etc/GMT+5').id).toBe('Etc/GMT+5');
  });

  it('refuses a name the host does not know', () => {
    expect(() => timeZone('Mars/Olympus_Mons')).toThrow();
  });
});
