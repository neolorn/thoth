/**
 * A path-prefix policy written out by hand with a member of another kind of policy beside its own.
 *
 * A policy is read by its kind. An `origins` table on a path-prefix policy is not one of its
 * tables, so an address is written in the locale asked for, whatever origin the context names.
 */
import { expect, it } from 'vitest';

import {
  toExternalPath,
  type LocaleUrlPolicy,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-PolicyMemberOfAnotherKindTestIdentity012345',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'thani' },
  },
};

const POLICY = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: [],
  omitDefaultPrefix: false,
  origins: { 'https://ar.example': 'ar-EG' },
} as unknown as LocaleUrlPolicy;

it('writes a path policy address in the active locale whatever the origin', () => {
  expect(
    toExternalPath('/second', 'en-US', {
      policy: POLICY,
      projection: PROJECTION,
      origin: 'https://ar.example',
    }),
  ).toBe('/en-us/second');
});
