import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

/**
 * The route table's one rule: no page draws navigation of its own (qits-2481). The admin pages sit
 * in `AdminFrame`, which has no links; the public pages sit outside it. The landing app owns the
 * navigation between the admin pages.
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
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('is an outlet, and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('h1')).toBeNull();
    expect(shell.querySelector('nav')).toBeNull();
  });

  it('sends the base path to the clients, with no navigation', async () => {
    const harness = await RouterTestingHarness.create('/');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('app-admin-frame');
    expect(layout.querySelector('nav')).toBeNull();
    expect(layout.querySelector('main app-clients-page')).not.toBeNull();
    http.expectOne('/idp/api/service-clients').flush([]);
    http.verify();
  });

  it('routes /users to the users page, with no navigation', async () => {
    const harness = await RouterTestingHarness.create('/users');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('app-admin-frame');
    expect(layout.querySelector('nav')).toBeNull();
    expect(layout.querySelector('main app-users-page')).not.toBeNull();
    http.expectOne('/idp/api/users').flush([]);
    http.verify();
  });

  it('routes /devices to the devices page, with no navigation', async () => {
    const harness = await RouterTestingHarness.create('/devices');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('app-admin-frame');
    expect(layout.querySelector('nav')).toBeNull();
    expect(layout.querySelector('main app-devices-page')).not.toBeNull();
    // The page reads all three of its own listings on arrival; answering them here keeps `verify`
    // honest.
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
    expect(shell.querySelector('app-admin-frame')).toBeNull();
    expect(shell.querySelector('nav a')).toBeNull();
    // The page's first call, before any form: answering it here keeps `verify` honest.
    http.expectOne('/idp/api/auth/resume').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.verify();
  });

  it('draws the registration page with no chrome either', async () => {
    const harness = await RouterTestingHarness.create('/register');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.tagName.toLowerCase()).toBe('app-register-page');
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('app-admin-frame')).toBe(
      null,
    );
    http.verify();
  });

  it('draws the CLI code page with no chrome, and asks nobody for anything', async () => {
    const harness = await RouterTestingHarness.create('/connect/cli?code=abc123');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.tagName.toLowerCase()).toBe('app-cli-page');
    const shell = harness.fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('app-admin-frame')).toBeNull();
    // The strong one: this document's URL held a credential a moment ago, so it makes no request
    // that could carry it anywhere.
    http.verify();
  });

  it('draws an unknown URL under /idp/ as a page, with no navigation', async () => {
    const harness = await RouterTestingHarness.create('/nothing-here');
    const layout = harness.routeNativeElement as HTMLElement;

    expect(layout.tagName.toLowerCase()).toBe('app-admin-frame');
    expect(layout.querySelector('nav')).toBeNull();
    expect(layout.querySelector('main app-not-found')).not.toBeNull();
    http.verify();
  });
});
