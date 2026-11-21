import type { Routes } from '@angular/router';
import { AdminFrame } from './admin/admin-frame';
import { NotFound } from './not-found/not-found';

/**
 * Six pages: three public ones, three administrative ones.
 *
 * **`login`, `register` and `connect/cli` are the public pages.** A person arrives at them before
 * they are signed in, so they show nothing but themselves.
 *
 * **`clients`, `users` and `devices` are the administrative pages, and they have no navigation of
 * their own** (qits-2481). The landing app is their only consumer: it shows each one in an iframe in
 * its main slot and lists them in its own sidebar. A second sidebar inside that frame would be
 * navigation twice. `AdminFrame` gives them only page padding.
 *
 * **Every page loads lazily.** A visitor at `/idp/login` does not pay for the admin pages, and an
 * operator on `/idp/devices` does not download a sign-in form.
 *
 * **The `'' → clients` redirect stays.** The edge sends an anonymous navigation to
 * `/idp/login?redirect=…` before this table is read, so a guard here would be a weaker copy of
 * that decision.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register-page').then((m) => m.RegisterPage),
  },
  {
    path: 'connect/cli',
    loadComponent: () => import('./connect/cli-page').then((m) => m.CliPage),
  },
  {
    path: '',
    component: AdminFrame,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'clients' },
      {
        path: 'clients',
        loadComponent: () => import('./clients/clients-page').then((m) => m.ClientsPage),
      },
      {
        path: 'users',
        loadComponent: () => import('./users/users-page').then((m) => m.UsersPage),
      },
      {
        path: 'devices',
        loadComponent: () => import('./devices/devices-page').then((m) => m.DevicesPage),
      },
      { path: '**', component: NotFound },
    ],
  },
];
