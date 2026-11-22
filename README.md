# qits-idp-platform-frontend

The identity provider's frontend: three public pages and three administrative ones. Served by
qits-platform-idp itself at `/idp/` through Quinoa.

- **`/idp/login`** — where a person signs in, with a passkey or a password.
- **`/idp/register`** — where a person spends a register token to make an account.
- **`/idp/connect/cli`** — where a person confirms a CLI sign-in code.
- **`/idp/clients`**, **`/idp/users`**, **`/idp/devices`** — the administrative pages.

**No page draws navigation of its own** (qits-2481). The public pages show nothing but themselves.
The administrative pages are shown only inside the landing app, in an iframe in its main slot,
and the landing app's sidebar is their navigation. They sit in `AdminFrame`, which gives them
padding and nothing else.

**Every page loads lazily, and this is the platform's first SPA to do that.** The split above is
the reason. Someone at `/idp/login` is by definition not yet allowed to see a client roster, so
shipping the admin pages in the bundle that draws the sign-in form makes the most public page on
the platform pay for code it can never use — and the reverse, an operator downloading a sign-in
form to reach `/idp/clients`, is no better.

**Every page reads its real API.** `login` and `register` talk to `/idp/api/auth/*`. The
administrative pages read with the session cookie (qits-2531): `users` lists `GET /idp/api/users`,
`clients` lists `GET /idp/api/service-clients` — one row per service's `idp:client`, never a secret
— and `devices` lists the account's own credentials. `users` and `clients` need an account with
`qits:admin`; any other session is told so. The CLI reads the same APIs: `qits users list` and
`qits service-clients list`.

**Passkeys need a secure context, and one real address does not have one.** `localhost` and
loopback count as secure over plain http, so the ordinary `http://localhost:8080` route runs the
ceremony with no TLS. A raw IP does not — and `http://<wsl-ip>:8080` is today's path from a
Windows browser to this platform. Both pages check `window.isSecureContext`, draw no passkey button
where it is false, and say so in one sentence; the password path works from everywhere and is what
automated tests use.

**Registration is gated by a token, not closed.** The platform's bootstrap mints one register token
and prints it in its closing report. The page takes it, spends it once, and the account it makes is
the installation's first administrator. Users are per-installation by decision, so a second
platform starts from its own token — which is also why a passkey's binding to the relying-party id
costs nothing here.

**Commissioned clients are not listed.** A commission is a short-lived credential a service makes
for one context, such as a CI run. `GET /idp/api/clients` shows a service only its own, over its
own Basic pair, and there is no listing across owners.

**Bare `/idp/` redirects to `/idp/clients`, and that line is still provisional.** The front door
should land on whatever the visitor is — a sign-in form when nobody is, an administrative home when
someone is. The question can be asked now that sessions exist; what cannot be asked yet is whether
the answer is this SPA's to give, since the edge is what turns an anonymous navigation into a
`/idp/login?redirect=…` and it does that before this route table is ever consulted.

Note what is _not_ under this SPA even though it shares the segment: this service's protocol surface
sits at `/idp/token`, `/idp/jwks` and `/idp/.well-known/openid-configuration`, beside these pages
rather than under an `/api` of its own. Those are answered by the service and never reach this
application.

## How it is served

qits-idp-platform-service carries this repository as a git submodule at `service/src/main/webui` —
Quinoa's `web-ui-dir` — and builds it during `mvn package`, serving the bundle at `/idp/`. The
segment is spelled here as `baseHref` in `angular.json` and there as
`quarkus.quinoa.ui-root-path`; the two move together. This repository ships no container image of
its own.

That mount is the arrangement this repo is built for, and it does not exist yet: the service
declares no Quinoa and carries no webui submodule at the time of writing. Nothing here waits on it —
this tree builds, lints and tests on its own.

Note the known wart, which is every client's alike: bare `/idp` (no trailing slash) is a 404.
`/idp/` works.

## Development server

```bash
ng serve
```

Then open `http://localhost:4200/`. `proxy.conf.json` forwards this service's whole surface —
`/idp/api`, `/idp/token`, `/idp/jwks`, `/idp/.well-known` and `/idp/q` — to a gateway on
`localhost:8080`, because `ng serve` puts no gateway in front. In a deployment every call is a
same-origin path behind the real gateway.

Sign-in works against that proxy, and it works because the proxy is same-origin. The ceremony spans
two requests and the challenge travels between them in a `_quarkus_webauthn_challenge` cookie the
page never reads; a cross-origin arrangement would drop it and the second call would fail with
nothing on screen to explain why. `http://localhost:4200` is a secure context in its own right, so
passkeys run here — but the relying-party id the service is configured with must match the host the
browser is on, or the authenticator refuses before any request is made.

## Running the checks

```bash
npm run lint && npm test && npm run build
```

The same three, in the same order, are what `.config/qits/ci-event-release-request.yml` runs — once
per release request, on the folded `release/<id>` branch, with its verdict gating the release.
Nothing builds on a push any more.
Note what that pipeline installs from: the npm proxy behind it is qits-platform-mirror, and the
`@qits` scope comes from qits-artifacts — so a run here cannot be green while either service is
down. Their deploys are taken alone, with the CI queue empty.

Installing on a developer machine needs a registry credential, and it is not in this repository:
`.npmrc` here carries the routing only. `qits help guide --for workstation` sets up the credential
(`qits registry-login --configure`). CI takes both the addresses and the credential from the step
environment.

## Building

```bash
ng build
```

The bundle lands in `dist/qits-platform-spa-idp/browser`, which is the path
`quarkus.quinoa.build-dir` names on the service side. Four lazy chunks come out beside the initial
one, one per page — that is the routing above, visible in the output.

## Running unit tests

```bash
ng test
```

Vitest on jsdom — no browser, which is what lets CI run them.
