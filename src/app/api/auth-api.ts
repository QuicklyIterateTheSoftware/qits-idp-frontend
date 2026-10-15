import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  AuthSession,
  CreationOptionsJson,
  LoginRequest,
  RegisterRequest,
  RegisterResult,
  ReturnLocation,
  RequestOptionsJson,
} from './dto';

/**
 * The four calls that make a person. Two ask the server what ceremony to run, two finish it.
 *
 * **`HttpClient` on the fetch backend, not `fetch` directly** — the house choice everywhere, and it
 * earns itself twice over here. `HttpTestingController` is the only request-mocking story this
 * platform's suites use, and every one of these calls carries cookies the page never touches: the
 * `_quarkus_webauthn_challenge` the options call sets and the follow-up must return, and the
 * `qits-session` the finishing call sets. Same-origin requests send both by default, so the code
 * that makes them correct is the code that is *not* written — no `credentials` option anywhere,
 * because the only value worth setting would be the default and the only value worth fearing
 * (`omit`) would break the ceremony silently.
 *
 * **No `httpResource`.** These are commands, not reads: each one is issued because a person pressed
 * a button, and a resource that re-fetches would re-run a WebAuthn ceremony. Promises, unwrapped at
 * the edge of the service, the way every sibling's API class does it.
 *
 * **Failures are thrown, not described.** An `HttpErrorResponse` reaching a caller here still holds
 * the server's body, and the pages above deliberately do not read it — see `auth/failure.ts`. This
 * class stays the transport and leaves that judgement in one place.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Creation options for a new account. The token is checked here, before any ceremony state. */
  registerOptions(username: string, token: string): Promise<CreationOptionsJson> {
    return firstValueFrom(
      this.http.post<CreationOptionsJson>(`${this.base}/idp/api/auth/register-options`, {
        username,
        token,
      }),
    );
  }

  /**
   * Finish a registration with an attestation, or with neither factor to have the idp generate the
   * account's password. Sets the session cookie; the generated password, when there is one, comes
   * back exactly once on the result.
   */
  register(request: RegisterRequest): Promise<RegisterResult> {
    return firstValueFrom(
      this.http.post<RegisterResult>(`${this.base}/idp/api/auth/register`, request),
    );
  }

  /** Assertion options for an existing account. Anonymous. */
  loginOptions(username: string): Promise<RequestOptionsJson> {
    return firstValueFrom(
      this.http.post<RequestOptionsJson>(`${this.base}/idp/api/auth/login-options`, { username }),
    );
  }

  /** Finish a sign-in with an assertion or a password. Sets the session cookie. */
  login(request: LoginRequest): Promise<AuthSession> {
    return firstValueFrom(this.http.post<AuthSession>(`${this.base}/idp/api/auth/login`, request));
  }

  /**
   * The only redirect location a public auth page may use. The IdP compares the supplied authority
   * with its explicit browser-host allow-list, so a hand-written login URL cannot become an open
   * redirect even though its query parameters are public input.
   */
  returnLocation(host: string | null, path: string | null): Promise<ReturnLocation> {
    const params = new HttpParams()
      .set('return_host', host ?? '')
      .set('return_path', path ?? '');
    return firstValueFrom(
      this.http.get<ReturnLocation>(`${this.base}/idp/api/auth/return-location`, { params }),
    );
  }
}
