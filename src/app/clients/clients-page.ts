import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminApi, readFailure } from '../api/admin-api';
import type { ServiceClient } from '../api/dto';
import { Empty } from '../ui/empty';

/**
 * The service clients this identity provider issues tokens to (qits-2531):
 * `GET /idp/api/service-clients`, read with the session.
 *
 * Every service a deployment declares with `idp:client` has one row. The service sends no secret.
 * The list needs an account with `qits:admin`, and any other session is told so.
 *
 * Commissioned clients — the short-lived credentials a service makes for one context, such as a
 * CI run — are not listed: `GET /idp/api/clients` shows a service only its own, over its own
 * Basic pair, and there is no listing across owners.
 */
@Component({
  selector: 'app-clients-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Empty],
  styleUrls: ['../ui/page.css'],
  template: `
    <header class="head">
      <h1>Clients</h1>
      <p class="lede">
        The services this identity provider issues tokens to. Each one holds an id and a secret, and
        asks for a token with them.
      </p>
    </header>

    @if (failure()) {
      <p class="failed" role="alert">{{ failure() }}</p>
    } @else if (clients().length === 0) {
      @if (!loading()) {
        <app-empty message="There are no service clients." />
      }
    } @else {
      <table>
        <thead>
          <tr>
            <th>Client id</th>
            <th>Created</th>
            <th>Secret rotated</th>
          </tr>
        </thead>
        <tbody>
          @for (client of clients(); track client.clientId) {
            <tr>
              <td>{{ client.clientId }}</td>
              <td>{{ client.createdAt | date: 'medium' }}</td>
              <td>
                @if (client.rotatedAt) {
                  {{ client.rotatedAt | date: 'medium' }}
                } @else {
                  Never
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <p class="note">
      The same list is on the command line: <code>qits service-clients list</code>. Secrets are
      never shown.
    </p>
  `,
})
export class ClientsPage {
  private readonly api = inject(AdminApi);

  protected readonly clients = signal<ServiceClient[]>([]);
  protected readonly loading = signal(true);
  protected readonly failure = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const clients = await this.api.serviceClients();
      this.clients.set([...clients].sort((a, b) => a.clientId.localeCompare(b.clientId)));
    } catch (error) {
      this.failure.set(readFailure(error, 'service clients'));
    } finally {
      this.loading.set(false);
    }
  }
}
