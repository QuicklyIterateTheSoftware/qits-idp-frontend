import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { AUTH_BROWSER } from '../auth/browser';

/**
 * Where a browser lands at the end of `qits login`: one code, large, with a button that copies it.
 *
 * **This page is the redirect target of a public OAuth client**, named as `redirect_uri` and
 * matched exactly by the IdP against a string it builds from its own configuration. A command-line
 * tool has no loopback listener at the moment a person finishes signing in — they may be on another
 * machine entirely — so the code comes back here and travels the last few centimetres by hand. What
 * makes that safe is PKCE: the code is worthless without the verifier held by the process waiting
 * in the terminal, so a code seen over a shoulder, left in a clipboard or caught in a screen share
 * cannot be spent by whoever saw it.
 *
 * **The code leaves the address bar as soon as it has been read.** It arrives as a query parameter,
 * which is the one place a credential is most likely to be written down by something other than the
 * person — browser history, a synced tab list, a bookmark made by accident, an `HTTP referer` on
 * any later navigation. `navigate(… , { replaceUrl: true })` is Angular's spelling of
 * `history.replaceState`: it rewrites the current entry rather than pushing a new one, so pressing
 * Back does not walk into the version of this URL that still holds the code. The code stays in this
 * component's own state, which no other document can read.
 *
 * **It loads nothing from another origin** — no font, no analytics, no icon. Every request this
 * document makes is a request that could carry the URL it was made from, and this URL had a
 * credential in it a moment ago. There is no `HttpClient` call here at all: the page has nothing to
 * ask anybody. That is a property worth stating because it is invisible in the code.
 *
 * **On `?error=` it says the sign-in did not complete.** The IdP sends that when a request it had
 * already decided it may answer turns out to be malformed — and a person reading it can do exactly
 * one useful thing, which is run `qits login` again. So that is the whole message; the code is in
 * the terminal's hands, not theirs.
 *
 * No chrome around it, by the route table: this is a sibling of `AdminFrame`, like `login` and
 * `register`. It renders with no session and must — the person may have been signed in already, and
 * a page that demanded one would bounce the finished flow back into a login.
 */
@Component({
  selector: 'app-cli-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsButton],
  styleUrls: ['../ui/auth.css'],
  styles: `
    /* The code is the page. Monospaced because it is typed-or-pasted text and the difference
       between an l and a 1 matters when somebody falls back to reading it aloud; wrapped with
       overflow-wrap anywhere because it is one long unspaced token and must not widen the card. */
    .code {
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

    .copied {
      margin: 0.6rem 0 0;
      font-size: 0.85rem;
      color: #15803d;
    }
  `,
  template: `
    <div class="card">
      @if (code()) {
        <h1>Your sign-in code</h1>
        <p class="lede">Paste this into the terminal that is waiting for it.</p>

        <p class="code" data-testid="code">{{ code() }}</p>

        <div class="actions">
          <qits-button variant="primary" (pressed)="copy()">Copy the code</qits-button>
        </div>

        @if (copied()) {
          <p class="copied" role="status">Copied.</p>
        }

        <p class="hint">
          Paste this code into the waiting <code>qits login</code>. It works once and expires in 5
          minutes.
        </p>
      } @else {
        <h1>That sign-in did not complete</h1>
        <p class="lede">No code was issued, so there is nothing to paste.</p>
        <p class="failed" role="alert">
          Run <code>qits login</code> again in your terminal to start over.
        </p>
      }
    </div>
  `,
})
export class CliPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly browser = inject(AUTH_BROWSER);

  /**
   * The code, read once at construction and then held only here.
   *
   * A signal rather than a getter over the query parameters on purpose: the parameters are about to
   * be erased, and a template reading them live would blank the page the moment it happened.
   */
  protected readonly code = signal(this.route.snapshot.queryParamMap.get('code') ?? '');

  protected readonly copied = signal(false);

  constructor() {
    if (this.route.snapshot.queryParamMap.keys.length > 0) {
      // Replace rather than push: the entry holding the code is overwritten, so Back cannot reach
      // it. `void` because nothing downstream depends on the navigation and a failed one leaves the
      // page exactly as correct — the code is already off the query parameters as far as this
      // component is concerned.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  protected async copy(): Promise<void> {
    this.copied.set(await this.browser.copy(this.code()));
  }
}
