import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { routes } from '../app.routes';
import { AUTH_BROWSER, type AuthBrowser } from '../auth/browser';

/**
 * Registration, driven the same way the sign-in page beside it is: real router, real requests
 * through `HttpTestingController`, and the browser itself behind the one token that stands in for
 * it. The extra thing asserted here is the register token — it must ride on *both* calls, because
 * the server checks it before it creates any ceremony state and again when it spends the row.
 *
 * The password path no longer types anything in: it sends the token and the username alone, and the
 * idp hands back a generated password that the page must hold on screen — not navigate past — until
 * Continue is pressed.
 */
describe('RegisterPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  let ceremonies: PublicKeyCredentialCreationOptions[];
  let assigned: string[];
  let copied: string[];

  const SESSION = {
    userId: '3f9b3f1e-0000-4000-8000-000000000001',
    username: 'alice',
    roles: ['qits:admin'],
    expiresAt: '2026-08-15T06:00:00Z',
  };

  const GENERATED = { ...SESSION, password: 'c0rrect-h0rse-battery' };

  /** What `navigator.credentials.create` resolves with, reduced to the fields that go on the wire. */
  const CREATED = {
    id: 'credential-id',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
      attestationObject: new Uint8Array([7, 8, 9]).buffer,
      getTransports: () => ['internal'],
    },
  } as unknown as Credential;

  function capable(): AuthBrowser {
    return {
      secureContext: true,
      credentials: {
        create: (options?: CredentialCreationOptions) => {
          if (options?.publicKey) ceremonies.push(options.publicKey);
          return Promise.resolve(CREATED);
        },
        get: () => Promise.resolve(null),
      } as unknown as CredentialsContainer,
      assign: (url: string) => assigned.push(url),
      copy: (text: string) => {
        copied.push(text);
        return Promise.resolve(true);
      },
    };
  }

  function insecure(): AuthBrowser {
    return {
      secureContext: false,
      credentials: null,
      assign: (url) => assigned.push(url),
      copy: (text: string) => {
        copied.push(text);
        return Promise.resolve(true);
      },
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

  async function open(url = '/register'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  /** Answer the landing lookup a targetless registration makes; see login-page.spec.ts. */
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

  async function fillIdentity(): Promise<void> {
    await type('input[autocomplete="off"]', 'token-abc');
    await type('input[autocomplete="username webauthn"]', 'alice');
  }

  async function press(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  beforeEach(() => {
    ceremonies = [];
    assigned = [];
    copied = [];
  });

  afterEach(() => http.verify());

  describe('on an address that can run a ceremony', () => {
    beforeEach(() => configure(capable()));

    it('asks for a token and a username, and offers the passkey first', async () => {
      await open();

      expect(page().querySelector('h1')?.textContent).toContain('Create an account');
      expect(page().querySelector('input[autocomplete="off"]')).not.toBeNull();
      expect(page().querySelector('input[autocomplete="username webauthn"]')).not.toBeNull();
      const labels = buttons().map((button) => button.textContent ?? '');
      expect(labels.some((text) => text.includes('Register with a passkey'))).toBe(true);
      expect(labels.some((text) => text.includes('Register without a passkey'))).toBe(true);
      expect(labels.findIndex((text) => text.includes('passkey'))).toBe(0);
      http.verify();
    });

    it('will not start without both the token and the username', async () => {
      await open();
      await type('input[autocomplete="username webauthn"]', 'alice');

      const passkey = buttons().find((button) => button.textContent?.includes('with a passkey'));
      const withoutPasskey = buttons().find((button) =>
        button.textContent?.includes('without a passkey'),
      );
      expect(passkey?.disabled).toBe(true);
      expect(withoutPasskey?.disabled).toBe(true);
      http.verify();
    });

    it('never sends a password, whichever option is pressed', async () => {
      await open();
      await fillIdentity();
      await press('without a passkey');

      const register = http.expectOne('/idp/api/auth/register');
      expect(register.request.body).toEqual({ username: 'alice', token: 'token-abc' });
      expect(register.request.body).not.toHaveProperty('password');
    });

    it('runs the whole passkey flow, token on both calls, and leaves for the front door', async () => {
      await open();
      await fillIdentity();
      await press('with a passkey');

      const options = http.expectOne('/idp/api/auth/register-options');
      expect(options.request.body).toEqual({ username: 'alice', token: 'token-abc' });
      options.flush({
        rp: { id: 'localhost', name: 'qits platform' },
        user: { id: 'AQID', name: 'alice', displayName: 'alice' },
        challenge: 'BAUG',
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 300000,
        excludeCredentials: [],
        authenticatorSelection: {
          requireResidentKey: true,
          residentKey: 'required',
          userVerification: 'required',
        },
        attestation: 'none',
        extensions: {},
      });
      await settle();

      expect(ceremonies).toHaveLength(1);
      expect(Array.from(new Uint8Array(ceremonies[0].challenge as ArrayBuffer))).toEqual([4, 5, 6]);
      expect(Array.from(new Uint8Array(ceremonies[0].user.id as ArrayBuffer))).toEqual([1, 2, 3]);
      expect(ceremonies[0].rp.id).toBe('localhost');

      const register = http.expectOne('/idp/api/auth/register');
      expect(register.request.body).toEqual({
        username: 'alice',
        token: 'token-abc',
        attestation: {
          id: 'credential-id',
          rawId: 'AQID',
          type: 'public-key',
          response: {
            clientDataJSON: 'BAUG',
            attestationObject: 'BwgJ',
            transports: ['internal'],
          },
        },
      });
      register.flush(SESSION);
      await settle();
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
      // Nothing to show on the passkey path — it leaves immediately, same as before.
      expect(page().querySelector('[data-testid="generated-password"]')).toBeNull();
    });

    it('shows the generated password once and waits for Continue before leaving', async () => {
      await open();
      await fillIdentity();
      await press('without a passkey');

      const register = http.expectOne('/idp/api/auth/register');
      register.flush(GENERATED);
      await settle();

      expect(assigned).toEqual([]);
      const shown = page().querySelector('[data-testid="generated-password"]');
      expect(shown?.textContent).toBe('c0rrect-h0rse-battery');
      expect(page().textContent).toContain('shown only this once');

      await press('Continue');
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
    });

    it('copies the generated password through the browser token, never through a log', async () => {
      const logged = vi.spyOn(console, 'log');
      await open();
      await fillIdentity();
      await press('without a passkey');
      http.expectOne('/idp/api/auth/register').flush(GENERATED);
      await settle();

      await press('Copy the password');

      expect(copied).toEqual(['c0rrect-h0rse-battery']);
      expect(page().textContent).toContain('Copied.');
      expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
    });

    it('honours a sanitized redirect after Continue, the same as the sign-in page', async () => {
      await open('/register?redirect=%2Fidp%2Fclients');
      await fillIdentity();
      await press('without a passkey');
      http.expectOne('/idp/api/auth/register').flush(GENERATED);
      await settle();
      await press('Continue');
      await settle();

      expect(assigned).toEqual(['/idp/clients']);
    });

    it('asks the IdP to validate a cross-host return after Continue', async () => {
      await open('/register?return_host=prod.wohlben.eu&return_path=%2Fprojects');
      await fillIdentity();
      await press('without a passkey');
      http.expectOne('/idp/api/auth/register').flush(GENERATED);
      await settle();
      await press('Continue');
      http
        .expectOne(
          (request) =>
            request.url === '/idp/api/auth/return-location' &&
            request.params.get('return_host') === 'prod.wohlben.eu' &&
            request.params.get('return_path') === '/projects',
        )
        .flush({ location: 'https://prod.wohlben.eu/projects' });
      await settle();

      expect(assigned).toEqual(['https://prod.wohlben.eu/projects']);
    });

    it('says one calm thing on a spent token, and nothing the server said', async () => {
      await open();
      await fillIdentity();
      await press('without a passkey');
      http
        .expectOne('/idp/api/auth/register')
        .flush({ error: 'invalid_request' }, { status: 400, statusText: 'Bad Request' });
      await settle();

      const alert = page().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('did not create an account');
      expect(page().textContent).not.toContain('invalid_request');
      expect(assigned).toEqual([]);
      expect(page().querySelector('[data-testid="generated-password"]')).toBeNull();
    });
  });

  describe('on an address that cannot', () => {
    beforeEach(() => configure(insecure()));

    it('draws no passkey button and says in one sentence why', async () => {
      await open();

      expect(buttons().some((button) => button.textContent?.includes('with a passkey'))).toBe(
        false,
      );
      expect(
        buttons().some((button) => button.textContent?.includes('without a passkey')),
      ).toBe(true);
      expect(page().textContent).toContain('Passkeys need localhost or https');
      expect(page().textContent).toContain('Registering without one works everywhere');
      http.verify();
    });

    it('still makes the account and shows the generated password once', async () => {
      await open();
      await fillIdentity();
      await press('without a passkey');
      http.expectOne('/idp/api/auth/register').flush(GENERATED);
      await settle();

      expect(page().querySelector('[data-testid="generated-password"]')?.textContent).toBe(
        'c0rrect-h0rse-battery',
      );

      await press('Continue');
      await landing();

      expect(assigned).toEqual(['https://wohlben.eu/']);
    });
  });
});
