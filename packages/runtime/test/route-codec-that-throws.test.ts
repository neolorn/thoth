import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import {
  LocalizationError,
  createPathPrefixLocalePolicy,
  resolveLocalizedRoute,
  type RouteParameterCodec,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * A route parameter codec that throws where it is asked to read an address.
 *
 * Section 2 of `specs/07-routing-rendering-and-seo.spec.md` has a codec decline a spelling by
 * answering that it did not parse, which is an address that names no route. A throw is not that
 * answer. It is a defect in the consumer application's codec, so the address is not reported as
 * missing: resolution fails with a typed failure, and the request handler answers as it answers a
 * render that failed.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
});

const projectionWith = (
  codec: RouteParameterCodec,
): RouteRuntimeProjection => ({
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-RouteCodecThatThrowsTestIdentity0123456789a',
    routes: [
      { id: 'article', path: 'articles/:slug', parameterNames: ['slug'] },
    ],
  },
  parameters: { article: { slug: codec } },
});

const THROWN = new Error('the codec under test threw');

/** Reads its own spellings, and throws at every other one in place of declining it. */
const THROWS_READING: RouteParameterCodec<string> = {
  parse: (text) => {
    if (text.startsWith('known')) return { ok: true, value: text };
    throw THROWN;
  },
  serialize: (value) => value,
};

/** Reads every spelling, and throws where it writes one that is not its own. */
const THROWS_WRITING: RouteParameterCodec<string> = {
  parse: (text) => ({ ok: true, value: text }),
  serialize: (value) => {
    if (value.startsWith('known')) return value;
    throw THROWN;
  },
};

function failureOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolving an address whose parameter codec throws', () => {
  it('fails with a typed failure naming the route, the parameter and the locale', () => {
    const failure = failureOf(() =>
      resolveLocalizedRoute(
        '/ar-eg/articles/unread',
        POLICY,
        projectionWith(THROWS_READING),
      ),
    );

    expect(failure).toBeInstanceOf(LocalizationError);
    expect(failure).toMatchObject({
      diagnostic: {
        code: 'invalid-configuration',
        outcome: 'operational-failure',
        reason: 'consumer-code-threw',
        targetLocale: 'ar-EG',
      },
      cause: THROWN,
    });
    const { message } = (failure as LocalizationError).diagnostic;
    expect(message).toContain('article');
    expect(message).toContain('slug');
    expect(message).toContain('ar-EG');
  });

  it('fails the same way where the codec throws writing the canonical spelling', () => {
    const failure = failureOf(() =>
      resolveLocalizedRoute(
        '/en-us/articles/unwritten',
        POLICY,
        projectionWith(THROWS_WRITING),
      ),
    );

    expect(failure).toMatchObject({
      diagnostic: {
        code: 'invalid-configuration',
        reason: 'consumer-code-threw',
        targetLocale: 'en-US',
      },
      cause: THROWN,
    });
  });

  it('keeps a typed error the codec threw as the cause, and names the codec in its own', () => {
    const typed = new LocalizationError({
      code: 'route-unavailable',
      outcome: 'localized-representation-unavailable',
      message: 'the codec under test threw a typed error',
    });
    const failure = failureOf(() =>
      resolveLocalizedRoute(
        '/en-us/articles/unread',
        POLICY,
        projectionWith({
          parse: () => {
            throw typed;
          },
          serialize: (value) => String(value),
        }),
      ),
    );

    expect(failure).toMatchObject({
      diagnostic: {
        code: 'invalid-configuration',
        reason: 'consumer-code-threw',
      },
      cause: typed,
    });
  });

  it('still resolves an address the codec reads', () => {
    expect(
      resolveLocalizedRoute(
        '/en-us/articles/known-one',
        POLICY,
        projectionWith(THROWS_READING),
      ),
    ).toMatchObject({ status: 'success', routeId: 'article' });
  });

  it('still answers not found where the codec declines the spelling', () => {
    expect(
      resolveLocalizedRoute(
        '/en-us/articles/declined',
        POLICY,
        projectionWith({
          parse: () => ({ ok: false }),
          serialize: (value) => String(value),
        }),
      ),
    ).toMatchObject({ status: 'not-found' });
  });
});

describe('the request handler at an address whose parameter codec throws', () => {
  const answering = (
    path: string,
    render = vi.fn(() => new Response('<!doctype html><html></html>')),
  ) => ({
    render,
    response: createLocaleRequestHandler({
      policy: POLICY,
      projection: projectionWith(THROWS_READING),
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
      cookie: false,
      render,
    })(new Request(`https://site.example${path}`)),
  });

  it('answers as a render that failed, and never as not found', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { render, response } = answering('/ar-eg/articles/unread');
    const answered = await response;

    expect(answered.status).toBe(500);
    expect(answered.headers.get('cache-control')).toBe('private, no-store');
    expect(answered.body).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it('carries the fields a render that drew nothing is answered with', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failed = await answering('/ar-eg/articles/unread').response;
    const drewNothing = await answering(
      '/ar-eg/articles/known-one',
      vi.fn(() => new Response(null)),
    ).response;

    expect(drewNothing.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe(
      drewNothing.headers.get('cache-control'),
    );
    expect(failed.headers.get('vary')).toBe(drewNothing.headers.get('vary'));
  });

  it('says so once during development, naming the route, the parameter and the locale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = createLocaleRequestHandler({
      policy: POLICY,
      projection: projectionWith(THROWS_READING),
      cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
      cookie: false,
    });

    await handler(new Request('https://site.example/ar-eg/articles/unread'));
    await handler(new Request('https://site.example/ar-eg/articles/other'));

    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0] as [string];
    expect(line).toContain('article');
    expect(line).toContain('slug');
    expect(line).toContain('ar-EG');
  });
});
