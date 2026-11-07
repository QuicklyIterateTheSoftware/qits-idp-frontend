import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { AuthApi } from '../api/auth-api';
import { AUTH_BROWSER } from '../auth/browser';
import { authFailure } from '../auth/failure';
import { DEFAULT_REDIRECT, safeRedirect } from '../auth/redirect';
import { asAssertion, toRequestOptions } from '../auth/webauthn';

/** Which action is in flight, or `null` when none is. Two buttons, one at a time. */
type Pending = 'passkey' | 'password' | null;

/**
 * Where a person signs in. A username, a passkey, and a password for the addresses where a passkey
 * cannot exist.
 *
 * **The passkey is the action and the password is the alternative**, and the page says so by
 * layout rather than by argument: the primary button runs the ceremony, the password sits below a
 * rule in smaller type. Nothing secret is typed on the passkey path — the authenticator holds the
 * key, the server holds a public one, and a page that cannot be phished is worth an extra second of
 * a person's attention.
 *
 * **The password half is not a courtesy, it is the only way in from one real address.** WebAuthn
 * requires a secure context; `localhost` and loopback count as one over plain http, so the ordinary
 * `http://localhost:8080` route works with no TLS at all. A raw IP does not — and
 * `http://<wsl-ip>:8080` is today's path from a Windows browser to this platform. There
 * `navigator.credentials` is simply absent, so the ceremony would fail with a `TypeError` and no
 * explanation. `window.isSecureContext` is checked instead and the passkey button is not drawn,
 * with one plain sentence saying why. Automated tests take the same door for their own reason.
 *
 * **Success leaves the application entirely.** The edge sends `return_host` and `return_path` when
 * it turns an anonymous navigation away. The IdP, not this public SPA, validates that host against
 * its configured browser-host allow-list and returns the complete location. A router hop cannot go
 * there, so this is a full document navigation. A login with no return target at all — a typed
 * address, a password manager's saved login URL — asks the same endpoint and gets the
 * installation's landing location, because `/` on this origin is the IdP's own SPA rather than the
 * platform.
 *
 * **There is a `<form>` element, and it never submits.** The sibling explorers build forms out of
 * labelled fields and a `qits-button` with no `<form>` around them, and that shape is wrong on this
 * one page: a password input outside a form is invisible to the browser's own credential manager —
 * Chrome says so in the console — so nothing would ever offer to save the password this page
 * accepts. The element is there for that, and for nothing else. It holds no submit button, so
 * implicit submission never fires; `(keydown.enter)` on the inputs is what makes Enter work, and it
 * dispatches to the action the address can actually run. The `submit` handler is a belt on a pair
 * of braces.
 *
 * **No chrome around it**, by the route table rather than by anything here: this page is a sibling
 * of `QitsMainLayout`, not a child. See app.routes.ts.
 *
 * **A remembered device skips the form entirely.** Before drawing anything else, the page asks
 * `POST /idp/api/auth/resume`, which reads the `qits-device` cookie a prior "Remember this device"
 * login left behind. A 204 means a fresh session cookie is already set, so the page leaves exactly
 * the way a password or passkey sign-in does — `arrive()` is the one place that decides where, and
 * resuming reuses it rather than growing a second copy. Anything else — 401, because there is no
 * remembered device, or a network failure, because none of this is worth distinguishing from "no" —
 * falls through to the ordinary form. The brief "Signing you in…" state in between is what keeps a
 * visible flash of the empty form from being the first thing a remembered browser sees.
 *
 * **"Remember this device" is checked by default** and rides on the login body on both paths — the
 * passkey ceremony and the password call alike — because the choice is about this browser, not
 * about which factor proved it.
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, RouterLink],
  styleUrls: ['../ui/auth.css'],
  template: `
    <div class="card">
      <h1>Sign in</h1>

      @if (resuming()) {
        <p class="lede">Signing you in…</p>
      } @else {
        <p class="lede">To the qits platform.</p>

        <form (submit)="$event.preventDefault()">
          <label class="field">
            <span class="label" id="username-label">Username</span>
            <input
              type="text"
              class="text"
              autocomplete="username webauthn"
              spellcheck="false"
              autocapitalize="none"
              aria-labelledby="username-label"
              [value]="username()"
              (input)="onUsername($event)"
              (keydown.enter)="withPasskey()"
            />
          </label>

          <label class="remember">
            <input type="checkbox" [checked]="remember()" (change)="onRemember($event)" />
            Remember this device
          </label>

          @if (passkeys) {
            <div class="actions">
              <qits-button
                variant="primary"
                [disabled]="!named() || pending() !== null"
                [busy]="pending() === 'passkey'"
                (pressed)="withPasskey()"
              >
                Sign in with a passkey
              </qits-button>
            </div>
            <p class="hint">Your authenticator answers. Nothing secret is typed on this page.</p>
          } @else {
            <p class="insecure">
              Passkeys need localhost or https, and this address is neither — so there is no passkey
              button here. A password works everywhere, including this address.
            </p>
          }

          <div class="alternative">
            <label class="field">
              <span class="label" id="password-label">Password</span>
              <input
                type="password"
                class="text"
                autocomplete="current-password"
                aria-labelledby="password-label"
                [value]="password()"
                (input)="onPassword($event)"
                (keydown.enter)="withPassword()"
              />
            </label>
            <div class="actions">
              <qits-button
                [variant]="passkeys ? 'secondary' : 'primary'"
                [disabled]="!named() || !password() || pending() !== null"
                [busy]="pending() === 'password'"
                (pressed)="withPassword()"
              >
                Sign in with a password
              </qits-button>
            </div>
          </div>
        </form>

        @if (failure()) {
          <p class="failed" role="alert">{{ failure() }}</p>
        }

        <p class="elsewhere">
          No account yet? <a routerLink="/register" queryParamsHandling="preserve">Register with a token</a>.
        </p>
      }
    </div>
  `,
})
export class LoginPage {
  private readonly api = inject(AuthApi);
  private readonly browser = inject(AUTH_BROWSER);
  private readonly route = inject(ActivatedRoute);

  /**
   * Whether a passkey can happen at all, decided once. It cannot change while the page is open: a
   * document's secure-context status is fixed by the URL it was served from, so a signal would be
   * a signal that never fires.
   */
  protected readonly passkeys = this.browser.secureContext && this.browser.credentials !== null;

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly remember = signal(true);
  protected readonly pending = signal<Pending>(null);
  protected readonly failure = signal<string | null>(null);

  /** True until the remembered-device check answers. The form is not drawn while this holds. */
  protected readonly resuming = signal(true);

  protected readonly named = computed(() => this.username().trim().length > 0);

  constructor() {
    void this.resume();
  }

  protected onUsername(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
  }

  protected onPassword(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
  }

  protected onRemember(event: Event): void {
    this.remember.set((event.target as HTMLInputElement).checked);
  }

  /**
   * The one call this page makes before anything is drawn. A 204 is a login that already happened,
   * so it leaves through `arrive()` exactly as a fresh one would; anything else — no remembered
   * device, or no answer at all — is treated the same way and simply shows the form.
   */
  private async resume(): Promise<void> {
    try {
      await this.api.resume();
      await this.arrive();
    } catch {
      this.resuming.set(false);
    }
  }

  /** Options, ceremony, assertion — three calls, one of them to the authenticator. */
  protected async withPasskey(): Promise<void> {
    if (!this.passkeys || !this.named() || this.pending()) return;
    const username = this.username().trim();
    this.pending.set('passkey');
    this.failure.set(null);
    try {
      const options = await this.api.loginOptions(username);
      const credential = await this.browser.credentials?.get({
        publicKey: toRequestOptions(options),
      });
      await this.api.login({
        username,
        assertion: asAssertion(credential ?? null),
        remember: this.remember(),
      });
      await this.arrive();
    } catch (error) {
      this.refuse(error);
    }
  }

  /** One call. The fallback path, and the only one on an address without a secure context. */
  protected async withPassword(): Promise<void> {
    if (!this.named() || !this.password() || this.pending()) return;
    this.pending.set('password');
    this.failure.set(null);
    try {
      await this.api.login({
        username: this.username().trim(),
        password: this.password(),
        remember: this.remember(),
      });
      await this.arrive();
    } catch (error) {
      this.refuse(error);
    }
  }

  /**
   * Gone. `pending` is deliberately left standing: the document is on its way out, and clearing it
   * would flicker the buttons back to life for however long the next page takes to arrive.
   */
  private async arrive(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const host = params.get('return_host');
    if (!host) {
      // A bookmark made before domain SSO used the same-origin spelling. A plainly local path is
      // still honoured on this origin, guarded by the old, deliberately tiny check. Anything the
      // guard refuses — and a login with no target at all — falls through to the IdP: since the
      // login moved onto its own host, `/` here is the IdP's SPA rather than the platform, so the
      // server names the installation's landing location instead.
      const local = safeRedirect(params.get('return_path') ?? params.get('redirect'));
      if (local !== DEFAULT_REDIRECT) {
        this.browser.assign(local);
        return;
      }
    }
    // `redirect` is the legacy same-origin spelling; preserving it makes an already-bookmarked
    // local login link safe while every cross-host return takes the IdP's allow-listed path.
    const target = await this.api.returnLocation(
      host,
      host ? (params.get('return_path') ?? safeRedirect(params.get('redirect'))) : null,
    );
    this.browser.assign(target.location);
  }

  private refuse(error: unknown): void {
    this.failure.set(
      authFailure(error, 'That did not sign you in. Check the username and try again.'),
    );
    this.pending.set(null);
  }
}
