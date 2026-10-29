import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from '@angular/core';
import { withRecoveryMessage } from '@neolorn/thoth';
import { provideLocalization } from '#i18n';
import { messages } from '#i18n/shell';

/**
 * The ordinary path, in full.
 *
 * One import and one call. The configuration, catalog set, catalog loaders, recovery payload and
 * route table are all things Thoth generated, and `provideLocalization` closes over every one of
 * them; an application that imported them here would only be handing Thoth back its own output.
 *
 * Document `lang` and `dir`, focus and scroll preservation across a locale switch, and the
 * announcement a screen reader needs are not opted into. They are what the defaults are for.
 *
 * What remains is the one thing Thoth cannot know: which message to show when localization itself
 * is unavailable.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideLocalization(
      withRecoveryMessage({ message: messages.recovery.unavailable }),
    ),
  ],
};
