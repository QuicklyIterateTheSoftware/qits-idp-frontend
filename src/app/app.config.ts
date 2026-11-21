import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

/**
 * Three providers.
 *
 * - `provideBrowserGlobalErrorListeners` sends global errors and unhandled rejections to Angular's
 *   `ErrorHandler`.
 * - `provideRouter`: every page is a path segment, so each is bookmarkable.
 * - `withFetch`: the default XHR backend is invisible to OTLP fetch instrumentation.
 *
 * No `provideQitsNavigation`: no page here draws the platform navigation any more (qits-2481).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
  ],
};
