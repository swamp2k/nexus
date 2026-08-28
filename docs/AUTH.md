# Nexus authentication

## Goals

Authentication must be secure without making ordinary family members manage passwords, MFA apps, recovery codes, or technical account settings.

Initial direction:

- email magic-link login
- long-lived revocable sessions on trusted personal devices
- simple roles: `admin`, `member`, `viewer`
- no plaintext login or session tokens stored in D1
- passkeys may be added later without replacing the session model

## Token model

Magic-link and session tokens are opaque random values generated with Web Crypto.

Only a SHA-256 hash of each token is stored in D1. The raw token exists only in the login link or session cookie. A database leak therefore does not expose immediately usable login/session tokens.

## Tables

`users`
- one row per Nexus user
- unique case-insensitive email address
- display name, role, account status

`auth_login_tokens`
- short-lived one-time magic-link tokens
- stores token hash, email, expiry and consumption timestamp

`auth_sessions`
- revocable long-lived sessions
- stores session token hash, owner, expiry, last-seen and revocation timestamp

## Cookie direction

Production session cookies should be:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- scoped to `/`

The exact session lifetime should remain configurable rather than being encoded into the database schema.

## Login flow

1. User enters email address.
2. Nexus creates a short-lived opaque login token and stores only its hash.
3. Nexus sends a link containing the raw token.
4. Following the link atomically consumes the token.
5. Nexus finds or validates the permitted user account.
6. Nexus creates a new opaque session token, stores only its hash, and sets the raw token in a secure HttpOnly cookie.
7. Subsequent requests resolve the session to a user and permissions.

## Account creation

Nexus should not become an open public signup service by accident. Initial family users should be explicitly invited/created by an admin. A valid email address alone must not grant access.

## Email delivery

Email delivery is deliberately kept behind a small interface. No provider credentials belong in source control. The provider will be wired after the delivery choice is confirmed.

## Cloudflare bindings

D1 should be accessed through a Worker binding, not via the Cloudflare REST API. The concrete D1 database resource and generated Worker binding types are added only after the actual Cloudflare resource is selected/created.
