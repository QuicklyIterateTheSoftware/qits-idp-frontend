import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { QitsBadge } from '@qits/ui-components';
import { AdminApi, readFailure } from '../api/admin-api';
import type { User } from '../api/dto';
import { Empty } from '../ui/empty';

/**
 * The people with an account here (qits-2531): `GET /idp/api/users`, read with the session.
 *
 * A row is a name, when it was made and its roles; the service sends no credential. The list needs
 * an account with `qits:admin`, and any other session is told so rather than shown an empty table.
 * Inviting and deleting are on the CLI (`qits users invite`, `qits users delete`); this page reads.
 */
@Component({
  selector: 'app-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Empty, QitsBadge],
  styleUrls: ['../ui/page.css'],
  styles: `
    .roles {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
  `,
  template: `
    <header class="head">
      <h1>Users</h1>
      <p class="lede">The people with an account on this identity provider, and their roles.</p>
    </header>

    @if (failure()) {
      <p class="failed" role="alert">{{ failure() }}</p>
    } @else if (users().length === 0) {
      @if (!loading()) {
        <app-empty
          message="There are no users. A person gets an account by spending a register token."
        />
      }
    } @else {
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Created</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          @for (user of users(); track user.username) {
            <tr>
              <td>{{ user.username }}</td>
              <td>{{ user.createdAt | date: 'medium' }}</td>
              <td>
                <span class="roles">
                  @for (role of user.roles; track role) {
                    <qits-badge tone="info" [label]="role" />
                  } @empty {
                    —
                  }
                </span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <p class="note">
      Invite a person with <code>qits users invite</code>, and remove one with
      <code>qits users delete</code>.
    </p>
  `,
})
export class UsersPage {
  private readonly api = inject(AdminApi);

  protected readonly users = signal<User[]>([]);
  protected readonly loading = signal(true);
  protected readonly failure = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await this.api.users());
    } catch (error) {
      this.failure.set(readFailure(error, 'users'));
    } finally {
      this.loading.set(false);
    }
  }
}
