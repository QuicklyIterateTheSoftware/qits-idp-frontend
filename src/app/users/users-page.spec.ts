import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { User } from '../api/dto';
import { UsersPage } from './users-page';

/** The Users page reads `GET /idp/api/users` with the session and draws one row per account. */
describe('UsersPage', () => {
  let http: HttpTestingController;

  const ADMIN: User = {
    username: 'alice',
    createdAt: '2026-10-15T18:46:29Z',
    roles: ['qits:admin'],
  };
  const PLAIN: User = { username: 'bob', createdAt: '2026-10-16T09:00:00Z', roles: [] };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(answer: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
    const fixture = TestBed.createComponent(UsersPage);
    answer(http.expectOne({ method: 'GET', url: '/idp/api/users' }));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists every user with its roles', async () => {
    const page = await open((req) => req.flush([ADMIN, PLAIN]));

    const rows = page.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('alice');
    expect(rows[0].textContent).toContain('qits:admin');
    expect(rows[1].textContent).toContain('bob');
    expect(page.querySelector('app-empty')).toBeNull();
  });

  it('says there are no users when the list is empty', async () => {
    const page = await open((req) => req.flush([]));

    expect(page.querySelector('table')).toBeNull();
    expect(page.querySelector('app-empty')?.textContent).toContain('There are no users');
  });

  it('tells a session without qits:admin that it needs the role', async () => {
    const page = await open((req) =>
      req.flush({ error: 'access_denied' }, { status: 403, statusText: 'Forbidden' }),
    );

    expect(page.querySelector('[role=alert]')?.textContent).toContain('qits:admin');
    expect(page.querySelector('table')).toBeNull();
  });
});
