import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import { AuthApi } from '../api/auth-api';
import { DevicesApi } from '../api/devices-api';
import type { Device, RememberedDevice } from '../api/dto';
import { AUTH_BROWSER } from '../auth/browser';
import { Empty } from '../ui/empty';

/**
 * Everything signed in as this person, and a button that ends any of it.
 *
 * **A row is a credential family, not a token.** The durable thing a `qits login` or a
 * `qits-bootstrap login` leaves behind is an opaque refresh credential that rotates on every use;
 * the family is the group those rotations belong to, and revoking it is the one action that
 * actually ends a session — a fifteen-minute access token minted a moment ago keeps working until
 * it expires, because it is validated offline against the JWKS and there is no revocation list.
 * The page says so rather than implying the button is instant.
 *
 * **`kind` comes from the server.** It is tempting to read `clientId` and match on `qits-cli`, and
 * it would be wrong: the ids are a deployment's configuration and this page would be a second,
 * stale copy of it. See `dto.ts`.
 *
 * **A revoked family stays listed.** Its row goes quiet and loses its button rather than vanishing,
 * because "I revoked that yesterday" is a thing a person needs to be able to check, and a list that
 * only shows live credentials cannot answer it. The families themselves are swept when they expire.
 *
 * The first of this application's pages to read anything: the two administrative pages beside it
 * are still empty states, and the reason is the one this page no longer has — there is a session
 * now, and this listing authenticates with it.
 *
 * **"Remembered browsers" is a second, separate list on the same page.** A credential family above
 * is a `qits login`/`qits-bootstrap login` device; a remembered browser is the `qits-device` cookie
 * a "Remember this device" sign-in left behind, which lets a later visit skip the form through
 * `POST /idp/api/auth/resume`. They are revoked through different doors and the two lists are never
 * merged — `current` marks the row for the browser this page is open in, which is otherwise
 * indistinguishable from any other.
 *
 * **"Sign out" ends the session and leaves.** It is a full document navigation to `/idp/login`,
 * the same `AUTH_BROWSER.assign` the auth pages use to arrive, because a `qits-session` cookie that
 * no longer exists is not a state the router can usefully render around — and it runs even when the
 * logout call itself fails, because staying on a page whose session may already be gone is worse
 * than leaving twice.
 */
@Component({
  selector: 'app-devices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Empty, QitsBadge, QitsButton],
  styleUrls: ['../ui/page.css'],
  styles: `
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    th {
      text-align: left;
      font-weight: 600;
      color: #374151;
      padding: 0.4rem 0.6rem 0.4rem 0;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
    }

    td {
      padding: 0.55rem 0.6rem 0.55rem 0;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: middle;
    }

    .revoked td {
      color: #9ca3af;
    }

    .actions {
      text-align: right;
      padding-right: 0;
    }

    .failed {
      margin: 0.9rem 0 0;
      color: #b91c1c;
    }

    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }

    .head h1 {
      flex: 1 1 auto;
    }

    section + section {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid #e5e7eb;
    }

    section h2 {
      margin: 0;
      font-size: 1.1rem;
    }
  `,
  template: `
    <header class="head">
      <h1>Signed-in devices</h1>
      <qits-button
        variant="secondary"
        size="sm"
        [busy]="signingOut()"
        [disabled]="signingOut()"
        (pressed)="signOut()"
      >
        Sign out
      </qits-button>
    </header>

    <section class="families">
      <h2>Credential families</h2>
      <p class="lede">
        Every command line and Git workstation holding a credential for this account. Revoking one
        ends its session; nothing else is affected.
      </p>

      @if (failure()) {
        <p class="failed" role="alert">{{ failure() }}</p>
      }

      @if (devices().length === 0) {
        @if (!loading()) {
          <app-empty
            message="Nothing is signed in. A qits login or a qits-bootstrap login puts a device here."
          />
        }
      } @else {
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Signed in</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (device of devices(); track device.id) {
              <tr [class.revoked]="device.revokedAt !== null">
                <td>
                  <qits-badge
                    [tone]="device.revokedAt ? 'neutral' : 'info'"
                    [label]="label(device)"
                  />
                </td>
                <td>{{ device.createdAt | date: 'medium' }}</td>
                <td>
                  @if (device.revokedAt) {
                    Revoked {{ device.revokedAt | date: 'medium' }}
                  } @else {
                    {{ device.expiresAt | date: 'medium' }}
                  }
                </td>
                <td class="actions">
                  @if (!device.revokedAt) {
                    <qits-button
                      variant="secondary"
                      size="sm"
                      [busy]="revoking() === device.id"
                      [disabled]="revoking() !== null"
                      (pressed)="revoke(device)"
                    >
                      Revoke
                    </qits-button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }

      <p class="note">
        A revoked device cannot refresh again. An access token it was issued in the last fifteen
        minutes keeps working until it expires — tokens are checked offline, against this service's
        published keys, so there is nothing to tell.
      </p>
    </section>

    <section class="remembered">
      <h2>Remembered browsers</h2>
      <p class="lede">
        Every browser this account told the idp to remember. Each one skips the sign-in form until
        it is revoked or it expires on its own.
      </p>

      @if (rememberedFailure()) {
        <p class="failed" role="alert">{{ rememberedFailure() }}</p>
      }

      @if (remembered().length === 0) {
        @if (!rememberedLoading()) {
          <app-empty message="No remembered browsers." />
        }
      } @else {
        <table>
          <thead>
            <tr>
              <th>Browser</th>
              <th>Last used</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (device of remembered(); track device.id) {
              <tr>
                <td>
                  {{ device.label }}
                  @if (device.current) {
                    <qits-badge tone="info" label="This device" />
                  }
                </td>
                <td>{{ device.lastUsedAt | date: 'medium' }}</td>
                <td>{{ device.expiresAt | date: 'medium' }}</td>
                <td class="actions">
                  <qits-button
                    variant="secondary"
                    size="sm"
                    [busy]="revokingRemembered() === device.id"
                    [disabled]="revokingRemembered() !== null"
                    (pressed)="revokeRemembered(device)"
                  >
                    Revoke
                  </qits-button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class DevicesPage {
  private readonly api = inject(DevicesApi);
  private readonly auth = inject(AuthApi);
  private readonly browser = inject(AUTH_BROWSER);

  protected readonly devices = signal<readonly Device[]>([]);
  protected readonly loading = signal(true);
  protected readonly revoking = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly remembered = signal<readonly RememberedDevice[]>([]);
  protected readonly rememberedLoading = signal(true);
  protected readonly revokingRemembered = signal<string | null>(null);
  protected readonly rememberedFailure = signal<string | null>(null);

  protected readonly signingOut = signal(false);

  constructor() {
    void this.reload();
    void this.reloadRemembered();
  }

  protected label(device: Device): string {
    if (device.kind === 'cli') return 'Command line';
    if (device.kind === 'workstation') return 'Git workstation';
    // A client this installation no longer configures. Its id is the only true thing left to say
    // about it, and it is still the person's to revoke.
    return device.clientId;
  }

  protected async revoke(device: Device): Promise<void> {
    if (this.revoking()) return;
    this.revoking.set(device.id);
    this.failure.set(null);
    try {
      await this.api.revoke(device.id);
      await this.reload();
    } catch {
      // Deliberately one message for every way this fails, matching `auth/failure.ts`'s rule: the
      // server's body describes a credential's existence and is not a browser's to relay.
      this.failure.set('That device could not be revoked. Reload the page and try again.');
    } finally {
      this.revoking.set(null);
    }
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.devices.set(await this.api.list());
    } catch {
      this.failure.set('The list of devices could not be read. Reload the page to try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async revokeRemembered(device: RememberedDevice): Promise<void> {
    if (this.revokingRemembered()) return;
    this.revokingRemembered.set(device.id);
    this.rememberedFailure.set(null);
    try {
      await this.api.revokeRememberedDevice(device.id);
      await this.reloadRemembered();
    } catch {
      this.rememberedFailure.set(
        'That browser could not be forgotten. Reload the page and try again.',
      );
    } finally {
      this.revokingRemembered.set(null);
    }
  }

  private async reloadRemembered(): Promise<void> {
    this.rememberedLoading.set(true);
    try {
      this.remembered.set(await this.api.rememberedDevices());
    } catch {
      this.rememberedFailure.set(
        'The list of remembered browsers could not be read. Reload the page to try again.',
      );
    } finally {
      this.rememberedLoading.set(false);
    }
  }

  /**
   * Ends with a full navigation even when the logout call itself fails: a session that could not
   * be ended cleanly is still not one worth staying on, and there is nothing else this page could
   * do about an idp that refused or could not be reached.
   */
  protected async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch {
      // Leaving anyway — see the doc comment above the class.
    }
    this.browser.assign('/idp/login');
  }
}
