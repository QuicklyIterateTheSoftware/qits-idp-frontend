import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The frame of the administrative pages: page padding and an outlet, and no navigation.
 *
 * The landing app shows these pages in an iframe and owns the navigation between them
 * (qits-2481), so nothing here links to another page.
 */
@Component({
  selector: 'app-admin-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<main class="admin"><router-outlet /></main>`,
  styles: `
    :host {
      display: block;
    }
    .admin {
      padding: 24px;
      box-sizing: border-box;
    }
  `,
})
export class AdminFrame {}
