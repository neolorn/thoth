import { beforeEach, describe, expect, it } from 'vitest';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Localization,
  LocalizedMessage,
  externalDestination,
  provideLocalizationSetup,
  withFormattingContext,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { messages } from '#i18n/shell';

import { runtimeExtensions } from './runtime-extensions';

/**
 * Catalog content rendered on the structured path stays data.
 *
 * `specs/09-safe-content-and-ux.spec.md` sections 2 to 5: catalog text is never HTML, a catalog
 * never chooses a URL, a target, a relationship or a handler, and never chooses a class, a style
 * or a token. The one markup-bearing message the shell renders elsewhere is a plain message that
 * Angular interpolates, which escapes it whatever the runtime does, so it cannot show any of this.
 * These messages go through `localized-message`, where the runtime decides what each part becomes.
 *
 * `hostile.link-options` and `hostile.styled` write options on built-in slots. The toolkit carries
 * a built-in slot's options through to the part unvalidated, so the template is the only thing
 * standing between them and the element.
 */

const destination = externalDestination(
  'https://support.example/guide',
  ['https://support.example'],
  '_self',
);

@Component({
  selector: 'inert-content-host',
  imports: [LocalizedMessage],
  template: `
    <localized-message data-markup [handle]="messages.hostile.markup" />
    <localized-message
      data-link
      [handle]="messages.hostile.linkOptions"
      [slots]="linkBindings"
    />
    <localized-message data-styled [handle]="messages.hostile.styled" />
  `,
})
class InertContentHost {
  protected readonly messages = messages;
  protected readonly linkBindings = Object.freeze({
    link: Object.freeze({ kind: 'link' as const, destination }),
  });
}

/** Attribute names on an element, less the ones Angular writes for its own bookkeeping. */
function authoredAttributes(element: Element): readonly string[] {
  return element
    .getAttributeNames()
    .filter((name) => !name.startsWith('_ng') && !name.startsWith('ng-'))
    .sort();
}

async function render(): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
        },
        withFormattingContext({ timeZone: 'UTC' }),
      ),
    ],
  });
  await TestBed.inject(Localization).initialize();
  const fixture = TestBed.createComponent(InertContentHost);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('catalog text on the structured path', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    host = await render();
  });

  it('renders markup a catalog wrote as the text it is', () => {
    const message = host.querySelector('[data-markup]');
    expect(message?.querySelector('script')).toBeNull();
    expect(message?.querySelector('img')).toBeNull();
    expect(message?.textContent).toContain('<script>alert(1)</script>');
    expect(message?.querySelector('strong')?.textContent?.trim()).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('produces no event attribute anywhere a catalog reached', () => {
    const named = [...host.querySelectorAll('*')].flatMap((element) =>
      element.getAttributeNames().filter((name) => /^on/iu.test(name)),
    );
    expect(named).toEqual([]);
  });
});

describe('options a catalog wrote on a built-in slot', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    host = await render();
  });

  it('leave the link going where the binding says', () => {
    const anchors = host.querySelectorAll('[data-link] a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor?.getAttribute('href')).toBe(destination.href);
    expect(anchor?.getAttribute('target')).toBe('_self');
    expect(anchor?.getAttribute('rel')).toBe(
      destination.kind === 'external' ? destination.rel : null,
    );
    expect(anchor?.textContent?.trim()).toBe('help');
  });

  it('put no class, style or token on the element', () => {
    const strong = host.querySelector('[data-styled] strong');
    expect(strong?.textContent?.trim()).toBe('this');
    expect(strong === null ? [] : authoredAttributes(strong)).toEqual([
      'dir',
      'lang',
    ]);
  });
});
