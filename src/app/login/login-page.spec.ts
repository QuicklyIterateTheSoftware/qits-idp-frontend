import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { AUTH_BROWSER, type AuthBrowser } from '../auth/browser';

/**
 * The sign-in page, driven through the router so the `?redirect=` parameter is a real one.
 *
 * Everything the page touches outside itself is either an `HttpTestingController` request or the
 * `AUTH_BROWSER` token — no module mock, no stubbed global. That is deliberate beyond tidiness:
 * vitest's registry is shared across files, so a module mock here would be an ordering hazard for
 * every other spec in the repository, and `window.location.assign` cannot be spied under jsdom at
 * all.
 */
describe('LoginPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  /** What the fake browser was asked to do. Reset per test by `beforeEach`. */
  let ceremonies: PublicKeyCredentialRequestOptions[];
  let assigned: string[];

  const SESSION = {
    userId: '3f9b3f1e-0000-4000-8000-000000000001',
    username: 'alice',
    roles: ['qits:admin'],
    expiresAt: '2026-08-15T06:00:00Z',
  };

  /** A credential as a real authenticator hands one back: strings and `ArrayBuffer`s. */
  const SIGNED = {
    id: 'credential-id',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
      authenticatorData: new Uint8Array([7, 8, 9]).buffer,
      signature: new Uint8Array([10, 11, 12]).buffer,
      userHandle: null,
    },
  } as unknown as Credential;

  /** A browsing context that can run a ceremony, and answers it with `SIGNED`. */
  function capable(): AuthBrowser {
    return {
      secureContext: true,
      credentials: {
        get: (options?: CredentialRequestOptions) => {
          if (options?.publicKey) ceremonies.push(options.publicKey);
          return Promise.resolve(SIGNED);
        },
        create: () => Promise.resolve(null),
      } as unknown as CredentialsContainer,
      assign: (url: string) => assigned.push(url),
      copy: () => Promise.resolve(true),
    };
  }

  /** The raw-IP route: no secure context, so no `navigator.credentials` at all. */
  function insecure(): AuthBrowser {
    return {
      secureContext: false,
      credentials: null,
      assign: (url) => assigned.push(url),
      copy: () => Promise.resolve(true),
    };
  }

  function configure(browser: AuthBrowser): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AUTH_BROWSER, useValue: browser },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  /**
   * Opens the page and answers its `resume` call with a 401, exactly as a browser with no
   * remembered device gets — which is what every test not about `resume` itself wants, so the
   * form is on screen by the time this returns. `openResuming` below is the raw door for the specs
   * that drive `resume` directly.
   */
  async function open(url = '/login'): Promise<void> {
    await openResuming(url);
    http
      .expectOne('/idp/api/auth/resume')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
  }

  async function openResuming(url = '/login'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  /**
   * Answer the landing lookup a targetless login now makes: the IdP is asked with no host and no
   * path, and names the installation's front door.
   */
  async function landing(): Promise<void> {
    const destination = http.expectOne(
      (request) =>
        request.url === '/idp/api/auth/return-location' &&
        request.params.get('return_host') === '' &&
        request.params.get('return_path') === '',
    );
    destination.flush({ location: 'https://wohlben.eu/' });
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  async function type(selector: string, value: string): Promise<void> {
    const input = page().querySelector<HTMLInputElement>(selector);
    expect(input, `no input matching ${selector}`).toBeTruthy();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle();
  }

  async function press(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  async function toggle(selector: string, checked: boolean): Promise<void> {
    const input = page().querySelector<HTMLInputElement>(selector);
    expect(input, `no input matching ${selector}`).toBeTruthy();
    if (input) {
      input.checked = checked;
      input.dispatchEvent(new Event('change'));
    }
    await settle();
  }

  beforeEach(() => {
    ceremonies = [];
    assigned = [];
  });

  afterEach(() => http.verify());

  describe('on an address that can run a ceremony', () => {
    beforeEach(() => configure(capable()));

    it('offers the passkey as the primary action and the password below it', async () => {
      await open();

      expect(page().querySelector('h1')?.textContent).toContain('Sign in');
      expect(buttons().some((button) => button.textContent?.includes('passkey'))).toBe(true);
      expect(buttons().some((button) => button.textContent?.includes('password'))).toBe(true);
      expect(page().textContent).not.toContain('Passkeys need localhost');
      http.verify();
    });

    it('will not start anything until a username is typed', async () => {
      await open();

      const passkey = buttons().find((button) => button.textContent?.includes('passkey'));
      expect(passkey?.disabled).toBe(true);
      http.verify();
    });

    it('runs the whole passkey flow: options, ceremony, assertion, and away', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await press('passkey');

      const options = http.expectOne('/idp/api/auth/login-options');
      expect(options.request.body).toEqual({ username: 'alice' });
      options.flush({
        challenge: 'BAUG',
        timeout: 300000,
        rpId: 'localhost',
        allowCredentials: [{ type: 'public-key', id: 'BwgJ' }],
        userVerification: 'required',
      });
      await settle();

      // The authenticator was asked with decoded bytes, not with the server's text.
      expect(ceremonies).toHaveLength(1);
      expect(Array.from(new Uint8Array(ceremonies[0].challenge as ArrayBuffer))).toEqual([4, 5, 6]);
      expect(ceremonies[0].rpId).toBe('localhost');
      expect(
        Array.from(new Uint8Array(ceremonies[0].allowCredentials?.[0].id as ArrayBuffer)),
      ).toEqual([7, 8, 9]);

      const login = http.expectOne('/idp/api/auth/login');
      expect(login.request.body).toEqual({
        username: 'alice',
        assertion: {
          id: 'credential-id',
          rawId: 'AQID',
          type: 'public-key',
          response: {
            clientDataJSON: 'BAUG',
            authenticatorData: 'BwgJ',
            signature: 'CgsM',
            userHandle: null,
          },
        },
        remember: true,
      });
      login.flush(SESSION);
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
    });

    it('signs in with a password when that button is the one pressed', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'hunter2');
      await press('password');

      const login = http.expectOne('/idp/api/auth/login');
      expect(login.request.body).toEqual({
        username: 'alice',
        password: 'hunter2',
        remember: true,
      });
      login.flush(SESSION);
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
      expect(ceremonies).toHaveLength(0);
    });

    it('ticks "remember this device" by default', async () => {
      await open();

      const checkbox = page().querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(checkbox?.checked).toBe(true);
    });

    it('sends remember: false on the password path once the checkbox is unticked', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await toggle('input[type="checkbox"]', false);
      await type('input[type="password"]', 'hunter2');
      await press('password');

      const login = http.expectOne('/idp/api/auth/login');
      expect(login.request.body).toEqual({
        username: 'alice',
        password: 'hunter2',
        remember: false,
      });
      login.flush(SESSION);
      await settle();
      await landing();
    });

    it('sends remember: false on the passkey path once the checkbox is unticked', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await toggle('input[type="checkbox"]', false);
      await press('passkey');
      http.expectOne('/idp/api/auth/login-options').flush({ challenge: 'BAUG' });
      await settle();

      const login = http.expectOne('/idp/api/auth/login');
      expect((login.request.body as { remember: boolean }).remember).toBe(false);
      login.flush(SESSION);
      await settle();
      await landing();
    });

    it('honours a same-origin redirect from the edge', async () => {
      await open('/login?redirect=%2Fidp%2Fclients');
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'hunter2');
      await press('password');
      http.expectOne('/idp/api/auth/login').flush(SESSION);
      await settle();

      expect(assigned).toEqual(['/idp/clients']);
    });

    it('asks the IdP to validate a cross-host return before leaving the canonical login origin', async () => {
      await open('/login?return_host=prod.wohlben.eu&return_path=%2Fprojects%2F7%3Ftab%3Druns');
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'hunter2');
      await press('password');
      http.expectOne('/idp/api/auth/login').flush(SESSION);
      await settle();
      const destination = http.expectOne(
        (request) =>
          request.url === '/idp/api/auth/return-location' &&
          request.params.get('return_host') === 'prod.wohlben.eu' &&
          request.params.get('return_path') === '/projects/7?tab=runs',
      );
      destination.flush({ location: 'https://prod.wohlben.eu/projects/7?tab=runs' });
      await settle();

      expect(assigned).toEqual(['https://prod.wohlben.eu/projects/7?tab=runs']);
    });

    it('sends a stranger’s redirect to the front door instead', async () => {
      await open('/login?redirect=%2F%2Fevil.example');
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'hunter2');
      await press('password');
      http.expectOne('/idp/api/auth/login').flush(SESSION);
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
    });

    it('says one calm thing on a refusal, and none of what the server said', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'wrong');
      await press('password');
      http
        .expectOne('/idp/api/auth/login')
        .flush({ error: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });
      await settle();

      const alert = page().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('did not sign you in');
      expect(page().textContent).not.toContain('invalid_credentials');
      expect(assigned).toEqual([]);
    });

    it('blames an unreachable service rather than the person’s credential', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await press('passkey');
      http.expectOne('/idp/api/auth/login-options').flush({ challenge: 'BAUG' });
      await settle();

      // The ceremony resolved; the assertion post is what gets no answer at all.
      http
        .expectOne('/idp/api/auth/login')
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      await settle();

      expect(page().querySelector('[role="alert"]')?.textContent).toContain('could not be reached');
    });
  });

  describe('when the passkey prompt is dismissed', () => {
    beforeEach(() => {
      const browser = capable();
      configure({
        ...browser,
        credentials: {
          get: () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')),
          create: () => Promise.resolve(null),
        } as unknown as CredentialsContainer,
      });
    });

    it('says to try again instead of implying the username is wrong', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await press('passkey');
      http.expectOne('/idp/api/auth/login-options').flush({ challenge: 'BAUG' });
      await settle();

      expect(page().querySelector('[role="alert"]')?.textContent).toContain('dismissed');
      expect(assigned).toEqual([]);
    });
  });

  describe('resuming a remembered device', () => {
    beforeEach(() => configure(capable()));

    it('shows a brief state and no form while the resume call is in flight', async () => {
      await openResuming();

      expect(page().textContent).toContain('Signing you in');
      expect(page().querySelector('form')).toBeNull();
      http.expectOne('/idp/api/auth/resume').flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();
    });

    it('follows the return location on a 204, exactly as a fresh login would, without ever showing the form', async () => {
      await openResuming();

      http.expectOne('/idp/api/auth/resume').flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
      expect(page().querySelector('form')).toBeNull();
    });

    it('follows a cross-host return target from a resumed session too', async () => {
      await openResuming('/login?return_host=prod.wohlben.eu&return_path=%2Fprojects%2F7');

      http.expectOne('/idp/api/auth/resume').flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      const destination = http.expectOne(
        (request) =>
          request.url === '/idp/api/auth/return-location' &&
          request.params.get('return_host') === 'prod.wohlben.eu' &&
          request.params.get('return_path') === '/projects/7',
      );
      destination.flush({ location: 'https://prod.wohlben.eu/projects/7' });
      await settle();

      expect(assigned).toEqual(['https://prod.wohlben.eu/projects/7']);
    });

    it('shows the ordinary form when there is no remembered device', async () => {
      await openResuming();

      http
        .expectOne('/idp/api/auth/resume')
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(page().textContent).not.toContain('Signing you in');
      expect(page().querySelector('form')).toBeTruthy();
      expect(buttons().some((button) => button.textContent?.includes('passkey'))).toBe(true);
    });

    it('also falls back to the form when the resume call cannot be answered at all', async () => {
      await openResuming();

      http
        .expectOne('/idp/api/auth/resume')
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      await settle();

      expect(page().querySelector('form')).toBeTruthy();
    });
  });

  describe('on an address that cannot', () => {
    beforeEach(() => configure(insecure()));

    it('draws no passkey button and says in one sentence why', async () => {
      await open();

      expect(buttons().some((button) => button.textContent?.includes('passkey'))).toBe(false);
      expect(page().textContent).toContain('Passkeys need localhost or https');
      expect(page().textContent).toContain('A password works everywhere');
      http.verify();
    });

    it('still signs a person in with a password', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');
      await type('input[type="password"]', 'hunter2');
      await press('password');
      http.expectOne('/idp/api/auth/login').flush(SESSION);
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
    });
  });
});
