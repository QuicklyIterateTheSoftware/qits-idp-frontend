import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The shell: one outlet and nothing else.
 *
 * Markup here would sit above every route, including the sign-in page, which must show nothing but
 * itself. The admin pages get their padding from `AdminFrame`; their navigation lives in the
 * landing app (qits-2481).
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {}
