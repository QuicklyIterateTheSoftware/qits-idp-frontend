import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { AuthApi } from '../api/auth-api';
import { AUTH_BROWSER } from '../auth/browser';
import { authFailure } from '../auth/failure';
import { DEFAULT_REDIRECT, safeRedirect } from '../auth/redirect';
import { asAttestation, toCreationOptions } from '../auth/webauthn';

/** Which action is in flight, or `null` when none is. Two buttons, one at a time. */
type Pending = 'passkey' | 'generated' | null;

/**
 * Where a person makes an account, which on this platform means spending a token that was printed
 * once.
 *
 * **The token is what makes this page safe to leave open.** Registration is not a public invitation:
 * the platform's bootstrap mints one register token, prints it in its closing report, and the row
 * is consumed the moment an account is made from it. So the page can sit at a known URL with a
 * visible form and still admit exactly one person — the one holding the token. Every field here is
 * checked server-side before any ceremony state is created, which is why the token goes out with
 * the *options* call and not only with the finishing one.
 *
 * **The token field is not a password field**, and that is a decision rather than an oversight. It
 * is a long random string being pasted out of a terminal by the one operator entitled to it, on a
 * page where nobody is signed in yet; masking it would hide the one thing a mistyped paste shows.
 * It is spent on use, so a shoulder-surfer's window is the length of this page visit.
 *
 * **Nobody chooses a password here any more.** A passkey is still the first option, for the same
 * reasons login-page.ts states in full, including the raw-IP address where `window.isSecureContext`
 * is false and a passkey cannot exist at all. The second option used to be a password field; it is
 * now "Register without a passkey", which sends the token and the username and nothing else — the
 * idp itself generates a strong password and returns it once, beside the session fields, on that
 * same response. A request that carries a password of its own is refused, so there is nothing left
 * here to validate or to mask.
 *
 * **The generated password is shown exactly once, and the page waits on purpose.** Finishing that
 * call does not navigate away: the password is not recoverable after this screen, so the page holds
 * it in a read-only, monospaced, selectable box with a copy button, says plainly that it will not be
 * shown again and that it can be changed later, and only leaves for the place registration used to
 * land once the person presses Continue. The passkey path has nothing to show and still leaves
 * immediately, exactly as before. Nothing here ever reaches `console.log` — a value shown once on
 * screen is not a value worth a second, durable copy.
 *
 * **The `<form>` around the fields never submits**, and it is there so the browser's credential
 * manager can see the username field at all — same as the sign-in page, which states the argument.
 *
 * **A second factor is added later, not here.** Adding a passkey to an account the idp gave a
 * generated password (or the reverse) happens session-authenticated from an account page that does
 * not exist yet. This page's job is the first credential, and offering both at once would ask a
 * person to make two decisions when they came to make an account.
 *
 * **No chrome around it**, by the route table. See app.routes.ts.
 */
@Component({
  selector: 'app-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton, RouterLink],
  styleUrls: ['../ui/auth.css'],
  styles: `
    /* The generated password is the page, once it exists. Monospaced and selectable for the same
       reason the CLI sign-in code is: it is a token somebody will retype or paste, not prose, and
       the difference between an l and a 1 matters. */
    .password {
      margin: 0.4rem 0 0;
      padding: 0.7rem 0.8rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 1rem;
      line-height: 1.5;
      color: #111827;
      background: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      overflow-wrap: anywhere;
      user-select: all;
    }

    .once {
      margin: 0.9rem 0 0;
      padding: 0.5rem 0.65rem;
      font-size: 0.85rem;
      color: #92400e;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 6px;
    }

    .copied {
      margin: 0.6rem 0 0;
      font-size: 0.85rem;
      color: #15803d;
    }
  `,
  template: `
    <div class="card">
      @if (generatedPassword(); as generated) {
        <h1>Account created</h1>
        <p class="lede">This is your password. It is shown only this once.</p>

        <p class="password" data-testid="generated-password">{{ generated }}</p>

        <div class="actions">
          <qits-button variant="secondary" (pressed)="copy()">Copy the password</qits-button>
        </div>

        @if (copied()) {
          <p class="copied" role="status">Copied.</p>
        }

        <p class="once">
          Store it now — in a password manager, if you have one. It will not be shown again, and you
          can change it later from your account.
        </p>

        <div class="actions">
          <qits-button variant="primary" (pressed)="continue()">Continue</qits-button>
        </div>
      } @else {
        <h1>Create an account</h1>
        <p class="lede">The platform's bootstrap printed a register token. It is spent once.</p>

        <form (submit)="$event.preventDefault()">
          <label class="field">
            <span class="label" id="token-label">Register token</span>
            <input
              type="text"
              class="text"
              autocomplete="off"
              spellcheck="false"
              autocapitalize="none"
              aria-labelledby="token-label"
              [value]="token()"
              (input)="onToken($event)"
              (keydown.enter)="withPasskey()"
            />
          </label>

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

          @if (passkeys) {
            <div class="actions">
              <qits-button
                variant="primary"
                [disabled]="!ready() || pending() !== null"
                [busy]="pending() === 'passkey'"
                (pressed)="withPasskey()"
              >
                Register with a passkey
              </qits-button>
            </div>
            <p class="hint">
              Your authenticator keeps the key and this platform keeps only its public half. There is
              nothing here to steal and nothing to remember.
            </p>
          } @else {
            <p class="insecure">
              Passkeys need localhost or https, and this address is neither — so there is no passkey
              button here. Registering without one works everywhere, including this address.
            </p>
          }

          <div class="alternative">
            <p class="hint">
              No authenticator, or not on this device? The platform will generate a strong password
              for you and show it once.
            </p>
            <div class="actions">
              <qits-button
                [variant]="passkeys ? 'secondary' : 'primary'"
                [disabled]="!ready() || pending() !== null"
                [busy]="pending() === 'generated'"
                (pressed)="withoutPasskey()"
              >
                Register without a passkey
              </qits-button>
            </div>
          </div>
        </form>

        @if (failure()) {
          <p class="failed" role="alert">{{ failure() }}</p>
        }

        <p class="elsewhere">Already have an account? <a routerLink="/login" queryParamsHandling="preserve">Sign in</a>.</p>
      }
    </div>
  `,
})
export class RegisterPage {
  private readonly api = inject(AuthApi);
  private readonly browser = inject(AUTH_BROWSER);
  private readonly route = inject(ActivatedRoute);

  /** Fixed for the life of the document — see the sign-in page for why it is not a signal. */
  protected readonly passkeys = this.browser.secureContext && this.browser.credentials !== null;

  protected readonly token = signal('');
  protected readonly username = signal('');
  protected readonly pending = signal<Pending>(null);
  protected readonly failure = signal<string | null>(null);

  /** Set once registration without a passkey succeeds. Holds the idp's one-time answer, nothing more. */
  protected readonly generatedPassword = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly ready = computed(
    () => this.token().trim().length > 0 && this.username().trim().length > 0,
  );

  protected onToken(event: Event): void {
    this.token.set((event.target as HTMLInputElement).value);
  }

  protected onUsername(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
  }

  /** Options, ceremony, attestation. The token rides on both calls; the server spends it once. */
  protected async withPasskey(): Promise<void> {
    if (!this.passkeys || !this.ready() || this.pending()) return;
    const username = this.username().trim();
    const token = this.token().trim();
    this.pending.set('passkey');
    this.failure.set(null);
    try {
      const options = await this.api.registerOptions(username, token);
      const credential = await this.browser.credentials?.create({
        publicKey: toCreationOptions(options),
      });
      await this.api.register({ username, token, attestation: asAttestation(credential ?? null) });
      await this.arrive();
    } catch (error) {
      this.refuse(error);
    }
  }

  /**
   * One call, no ceremony, no password of our own: the idp generates one and hands it back once.
   * This does not leave the page — `generatedPassword` holds it until `continue()` is pressed.
   */
  protected async withoutPasskey(): Promise<void> {
    if (!this.ready() || this.pending()) return;
    this.pending.set('generated');
    this.failure.set(null);
    try {
      const result = await this.api.register({
        username: this.username().trim(),
        token: this.token().trim(),
      });
      if (result.password) {
        // The common case: hold it for the person to read, copy and acknowledge.
        this.generatedPassword.set(result.password);
        this.pending.set(null);
      } else {
        // Nothing to show — behave exactly like the passkey path and leave.
        await this.arrive();
      }
    } catch (error) {
      this.refuse(error);
    }
  }

  protected async copy(): Promise<void> {
    const password = this.generatedPassword();
    if (password === null) return;
    this.copied.set(await this.browser.copy(password));
  }

  /** Pressed once the generated password has been noted. Leaves for wherever registering used to. */
  protected continue(): void {
    void this.arrive();
  }

  /**
   * Registered and signed in — the server's answer set the session cookie, so the account exists
   * and this browser is already holding it. `pending` stays set on the way out; see login-page.ts.
   */
  private async arrive(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const host = params.get('return_host');
    if (!host) {
      // Same shape as login-page.ts: a plainly local path is honoured, everything else asks the
      // IdP for the installation's landing location — `/` here is the IdP's own SPA now.
      const local = safeRedirect(params.get('return_path') ?? params.get('redirect'));
      if (local !== DEFAULT_REDIRECT) {
        this.browser.assign(local);
        return;
      }
    }
    const target = await this.api.returnLocation(
      host,
      host ? (params.get('return_path') ?? safeRedirect(params.get('redirect'))) : null,
    );
    this.browser.assign(target.location);
  }

  private refuse(error: unknown): void {
    this.failure.set(
      authFailure(
        error,
        'That did not create an account. Check the token and the username, and try again.',
      ),
    );
    this.pending.set(null);
  }
}
