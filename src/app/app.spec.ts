import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * A fixture navigation, not the platform's. `provideQitsNavigationLinks` answers the layout's
 * `QITS_NAVIGATION` from a literal, so the chrome makes no `/main-navigation` request — which is
 * what keeps `http.verify()` honest instead of failing on a call this file never asked for.
 */
const NAV = [
  { label: 'Artifacts', href: '/artifacts/' },
  { label: 'Identity', href: '/idp/' },
] as const;

/**
 * The shell owns two things — the outlet and the chrome's sub-menu — so that is what is asserted
 * here, plus the route table putting each of the six doors on the right side of the chrome.
 *
 * That last part is this app's one structural rule and the only one worth a spec: the
 * administrative pages are inside `QitsMainLayout` and the three public ones — sign in, register,
 * and the CLI code page — are **not**. It is a
 * property no page can assert about itself, it is invisible on screen until someone is looking at
 * a sign-in form wrapped in a sidebar, and it is a two-character edit away in the route table.
 *
 * What the layout renders is the ui-components library's business. The link count checked against
 * it is the fixture's, and what it proves is that this app mounts the chrome and the chrome renders
 * what it is told; the platform's real link count is a deployment fact and the gateway's own spec's
 * job.
 */
describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('is an outlet and a handed-over sub-menu, and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('h1')).toBeNull();
    // The sub-menu is an <ng-template>: declared here, rendered by the layout somewhere else. It
    // must draw nothing at this level, or it would appear above every route including the auth
    // pages that have no chrome at all.
    expect(shell.querySelector('app-view-nav')).toBeNull();
  });

  it('sends the base path to the clients, inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelectorAll('nav a')).toHaveLength(NAV.length);
    expect(layout.querySelector('main app-clients-page')).not.toBeNull();
    http.verify();
  });

  it('routes /users to the users page, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/users');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-users-page')).not.toBeNull();
    http.verify();
  });

  it('routes /devices to the devices page, inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/devices');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-devices-page')).not.toBeNull();
    // The page reads all three of its own listings on arrival; answering them here keeps `verify`
    // about the chrome.
    http.expectOne('/idp/api/devices').flush([]);
    http.expectOne('/idp/api/remembered-devices').flush([]);
    http.expectOne('/idp/api/passkeys').flush([]);
    http.verify();
  });

  it('draws the sign-in page with no chrome around it at all', async () => {
    const harness = await RouterTestingHarness.create('/login');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.tagName.toLowerCase()).toBe('app-login-page');
    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('qits-main-layout')).toBeNull();
    expect(shell.querySelector('nav a')).toBeNull();
    // The page's first call, before any form: answering it here keeps `verify` about the chrome.
    http
      .expectOne('/idp/api/auth/resume')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    http.verify();
  });

  it('draws the registration page with no chrome either', async () => {
    const harness = await RouterTestingHarness.create('/register');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.tagName.toLowerCase()).toBe('app-register-page');
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('qits-main-layout')).toBe(
      null,
    );
    http.verify();
  });

  it('draws the CLI code page with no chrome, and asks nobody for anything', async () => {
    const harness = await RouterTestingHarness.create('/connect/cli?code=abc123');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.tagName.toLowerCase()).toBe('app-cli-page');
    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('qits-main-layout')).toBeNull();
    // The strong one: this document's URL held a credential a moment ago, so it makes no request
    // that could carry it anywhere — the chrome's own /main-navigation call included, which the
    // route table keeps away by putting this page outside the layout.
    http.verify();
  });

  it('draws an unknown URL under /idp/ as a page, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/nothing-here');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-not-found')).not.toBeNull();
    http.verify();
  });
});
