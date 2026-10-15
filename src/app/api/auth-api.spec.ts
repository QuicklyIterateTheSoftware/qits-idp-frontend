import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthApi } from './auth-api';
import type { AuthSession } from './dto';

/**
 * Four paths, and every body they can carry. The paths are asserted because they are the one thing
 * about these calls the compiler cannot check and the edge's anonymous carve-out depends on:
 * everything under `/idp/` is let through unauthenticated, and a call that drifted out of that
 * prefix would 401 in production and pass every test that only mocked the service.
 */
describe('AuthApi', () => {
  let api: AuthApi;
  let http: HttpTestingController;

  const SESSION: AuthSession = {
    userId: '3f9b3f1e-0000-4000-8000-000000000001',
    username: 'alice',
    roles: ['qits:admin'],
    expiresAt: '2026-08-15T06:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AuthApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for creation options with the username and the token', async () => {
    const pending = api.registerOptions('alice', 'token-abc');

    const request = http.expectOne('/idp/api/auth/register-options');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ username: 'alice', token: 'token-abc' });
    request.flush({ challenge: 'BAUG' });

    await expect(pending).resolves.toEqual({ challenge: 'BAUG' });
  });

  it('registers with an attestation, and never a password of its own', async () => {
    const attestation = {
      id: 'credential-id',
      rawId: 'AQID',
      type: 'public-key',
      response: { clientDataJSON: 'BAUG', attestationObject: 'BwgJ' },
    };
    const pending = api.register({ username: 'alice', token: 'token-abc', attestation });

    const request = http.expectOne('/idp/api/auth/register');
    expect(request.request.body).toEqual({ username: 'alice', token: 'token-abc', attestation });
    expect(request.request.body).not.toHaveProperty('password');
    request.flush(SESSION);

    await expect(pending).resolves.toEqual(SESSION);
  });

  it('registers with neither factor to have the idp generate a password, and gets it back once', async () => {
    const pending = api.register({ username: 'alice', token: 'token-abc' });

    const request = http.expectOne('/idp/api/auth/register');
    expect(request.request.body).toEqual({ username: 'alice', token: 'token-abc' });
    expect(request.request.body).not.toHaveProperty('password');
    expect(request.request.body).not.toHaveProperty('attestation');
    request.flush({ ...SESSION, password: 'g3n3r4ted-pw' });

    await expect(pending).resolves.toEqual({ ...SESSION, password: 'g3n3r4ted-pw' });
  });

  it('asks for assertion options with the username alone — no token on this side', async () => {
    const pending = api.loginOptions('alice');

    const request = http.expectOne('/idp/api/auth/login-options');
    expect(request.request.body).toEqual({ username: 'alice' });
    request.flush({ challenge: 'BAUG', rpId: 'localhost' });

    await expect(pending).resolves.toEqual({ challenge: 'BAUG', rpId: 'localhost' });
  });

  it('logs in and answers with the session the cookie was set for', async () => {
    const pending = api.login({ username: 'alice', password: 'hunter2' });

    const request = http.expectOne('/idp/api/auth/login');
    expect(request.request.body).toEqual({ username: 'alice', password: 'hunter2' });
    request.flush(SESSION);

    await expect(pending).resolves.toEqual(SESSION);
  });

  it('lets a refusal through as a thrown error, without describing it', async () => {
    const pending = api.login({ username: 'alice', password: 'wrong' });

    http
      .expectOne('/idp/api/auth/login')
      .flush({ error: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });

    await expect(pending).rejects.toBeTruthy();
  });
});
