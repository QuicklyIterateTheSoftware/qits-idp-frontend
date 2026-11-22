import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ServiceClient } from '../api/dto';
import { ClientsPage } from './clients-page';

/** The Clients page reads `GET /idp/api/service-clients` with the session, sorted by id. */
describe('ClientsPage', () => {
  let http: HttpTestingController;

  const CI: ServiceClient = {
    clientId: 'dev-qits-ci',
    source: 'database',
    createdAt: '2026-09-10T17:00:00Z',
    rotatedAt: null,
  };
  const ARTIFACTS: ServiceClient = {
    clientId: 'dev-qits-artifacts',
    source: 'database',
    createdAt: '2026-09-10T17:00:00Z',
    rotatedAt: '2026-10-01T08:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(answer: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
    const fixture = TestBed.createComponent(ClientsPage);
    answer(http.expectOne({ method: 'GET', url: '/idp/api/service-clients' }));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists every service client, sorted by id, and never a secret', async () => {
    const page = await open((req) => req.flush([CI, ARTIFACTS]));

    const rows = page.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('dev-qits-artifacts');
    expect(rows[1].textContent).toContain('dev-qits-ci');
    expect(rows[1].textContent).toContain('Never');
    expect(page.querySelector('table')?.textContent?.toLowerCase()).not.toContain('secret:');
  });

  it('says there are none when the list is empty', async () => {
    const page = await open((req) => req.flush([]));

    expect(page.querySelector('table')).toBeNull();
    expect(page.querySelector('app-empty')?.textContent).toContain('no service clients');
  });

  it('tells a session without qits:admin that it needs the role', async () => {
    const page = await open((req) =>
      req.flush({ error: 'access_denied' }, { status: 403, statusText: 'Forbidden' }),
    );

    expect(page.querySelector('[role=alert]')?.textContent).toContain('qits:admin');
  });
});
