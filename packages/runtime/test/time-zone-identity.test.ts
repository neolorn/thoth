import { describe, expect, it } from 'vitest';

import { timeZone } from '../src/formatting.js';

/**
 * A stored zone identity is compared, persisted and exchanged, so the spelling that comes back has
 * to be the pinned time-zone database's own and not whatever the host's presentation data prefers.
 * The pairs are names of the pinned release: zones, former names that survive only as links in its
 * `backward` file, and links its `zone.tab` still lists for a country.
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
