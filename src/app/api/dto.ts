/**
 * The wire, written down. Every type here is the shape qits-platform-idp sends or takes on
 * `/idp/api/auth/*`, and nothing here is this application's own idea.
 *
 * **The WebAuthn option types are the JSON ones, not the browser's.** `PublicKeyCredentialCreationOptions`
 * in `lib.dom` carries `ArrayBuffer` where a JSON document carries base64url text, so the two cannot
 * be the same type and pretending otherwise would push the encoding problem into a cast somewhere
 * further from the wire. These are the text ones; `auth/webauthn.ts` turns them into the browser's
 * and turns the browser's answer back into text.
 *
 * **The server's base64url is unpadded**, which nothing here has to care about — `fromBase64Url`
 * takes either form. It is recorded because a fixture written by hand will usually be padded, and
 * that difference has cost other people an afternoon.
 */

/** What a finished register or login answers with. The session itself is an HttpOnly cookie. */
export interface AuthSession {
  readonly userId: string;
  readonly username: string;
  readonly roles: readonly string[];
  readonly expiresAt: string;
}

/** The server-validated document location to use after a successful browser ceremony. */
export interface ReturnLocation {
  readonly location: string;
}

/** One acceptable key type, as the server offers it (`alg` is a COSE identifier). */
export interface CredentialParameterJson {
  readonly type: string;
  readonly alg: number;
}

/** A credential the ceremony must exclude (register) or may use (login). */
export interface CredentialDescriptorJson {
  readonly type: string;
  readonly id: string;
  readonly transports?: readonly string[];
}

/** What kind of authenticator the server insists on. */
export interface AuthenticatorSelectionJson {
  readonly requireResidentKey?: boolean;
  readonly residentKey?: string;
  readonly userVerification?: string;
  readonly authenticatorAttachment?: string;
}

/** `POST /idp/api/auth/register-options` answers with this. */
export interface CreationOptionsJson {
  readonly rp: { readonly id?: string; readonly name: string };
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string };
  readonly challenge: string;
  readonly pubKeyCredParams: readonly CredentialParameterJson[];
  readonly timeout?: number;
  readonly excludeCredentials?: readonly CredentialDescriptorJson[];
  readonly authenticatorSelection?: AuthenticatorSelectionJson;
  readonly attestation?: string;
  readonly extensions?: Record<string, unknown>;
}

/** `POST /idp/api/auth/login-options` answers with this. */
export interface RequestOptionsJson {
  readonly challenge: string;
  readonly timeout?: number;
  readonly rpId?: string;
  readonly allowCredentials?: readonly CredentialDescriptorJson[];
  readonly userVerification?: string;
}

/** A new credential, serialized for the wire. */
export interface AttestationJson {
  readonly id: string;
  readonly rawId: string;
  readonly type: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports?: readonly string[];
  };
}

/** A signature from an existing credential, serialized for the wire. */
export interface AssertionJson {
  readonly id: string;
  readonly rawId: string;
  readonly type: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle: string | null;
  };
}

/**
 * Both halves of the register request take the token. An attestation rides beside it for a passkey
 * registration; with neither, the idp generates the account's password itself and returns it once,
 * on `RegisterResult`. There is no password field here — a request that carried one is refused.
 */
export interface RegisterRequest {
  readonly username: string;
  readonly token: string;
  readonly attestation?: AttestationJson;
}

/**
 * What a finished registration answers with. `password` is set only when the account was made
 * without a passkey: the idp generated it, this is the only time it is ever sent, and the page must
 * show it once and never log it.
 */
export interface RegisterResult extends AuthSession {
  readonly password?: string;
}

/**
 * Login takes no token. Exactly one factor, same as register. `remember`, when true, asks the idp
 * to also set a `qits-device` cookie, which a later visit's `resume` call can trade for a fresh
 * session with no form at all.
 */
export interface LoginRequest {
  readonly username: string;
  readonly assertion?: AssertionJson;
  readonly password?: string;
  readonly remember?: boolean;
}

/**
 * One signed-in device: a revocable credential family this account holds, CLI or Git workstation.
 *
 * `kind` is the server's word, not a mapping this application makes from `clientId`. The client ids
 * are a deployment's configuration, so a page that matched on the string `qits-cli` would mislabel
 * an installation that renamed one; `unknown` is what a family whose client is no longer configured
 * reports, and it is still revocable.
 */
export interface Device {
  readonly id: string;
  readonly clientId: string;
  readonly kind: 'cli' | 'workstation' | 'unknown';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

/**
 * One browser the idp was told to remember: the `qits-device` cookie a "Remember this device"
 * login leaves behind, which a later `resume` call trades for a session with no form at all.
 *
 * `label` is the User-Agent the browser sent when the cookie was set, capped at 200 characters by
 * the server — there is no structured kind here, unlike `Device`, because a browser's own string is
 * the only thing the idp ever had to say about it. `current` marks the device the page itself is
 * being read from, which is otherwise indistinguishable from any other row in this list.
 */
export interface RememberedDevice {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly current: boolean;
}

/**
 * One passkey this account registered, oldest first as the server lists them.
 *
 * `aaguid` identifies the authenticator model, not the individual key — a `00000000-0000-0000-0000-000000000000`
 * value is what a platform authenticator with no particular make to report sends, and the page reads
 * it as "Software key" rather than printing the all-zero id. `credentialId` is the WebAuthn
 * credential id, base64url, and is the only thing that tells two of this account's passkeys apart.
 */
export interface Passkey {
  readonly credentialId: string;
  readonly aaguid: string;
  readonly createdAt: string;
}
