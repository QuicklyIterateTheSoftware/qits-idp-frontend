import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type { ServiceClient, User } from './dto';

/**
 * The reads behind the Users and Clients pages (qits-2531).
 *
 * Both authenticate with the session cookie, like `DevicesApi`, and both need an account that holds
 * `qits:admin`: the service answers 403 to any other session. The CLI reads the same APIs:
 * `qits users list` and `qits service-clients list`.
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Every account, sorted by username. */
  users(): Promise<User[]> {
    return firstValueFrom(this.http.get<User[]>(`${this.base}/idp/api/users`));
  }

  /** Every service client. */
  serviceClients(): Promise<ServiceClient[]> {
    return firstValueFrom(this.http.get<ServiceClient[]>(`${this.base}/idp/api/service-clients`));
  }
}

/** The sentence a page shows when a list could not be read. A 403 means the account is no admin. */
export function readFailure(error: unknown, what: string): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 403) {
    return `Only an account with the qits:admin role can see the ${what}.`;
  }
  if (status === 401) {
    return 'You are not signed in. Sign in again and reload the page.';
  }
  return `The ${what} could not be read. Reload the page to try again.`;
}
