import { expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
    routes: [{ id: 'route:_index', path: '', parameterNames: [] }],
  },
  localizedPaths: {},
};

const policyWith = (roots: readonly string[]): LocaleUrlPolicy => ({
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: roots,
  omitDefaultPrefix: false,
});

const answer = (policy: LocaleUrlPolicy) =>
  createLocaleRequestHandler({
    policy,
    projection: PROJECTION,
    cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    cookie: false,
    render: () => new Response('<!doctype html>'),
  })(new Request('https://site.example/'));

it('answers the root address the same whether or not the roots list has an empty slot', async () => {
  const control = await answer(policyWith([]));
  // One slot, nothing in it.
  const holed = await answer(policyWith(new Array<string>(1)));
  expect(control.status).not.toBe(404);
  expect(holed.status).toBe(control.status);
  expect(holed.headers.get('location')).toBe(control.headers.get('location'));
});
