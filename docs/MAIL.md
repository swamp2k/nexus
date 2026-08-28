# Nexus mail

Nexus keeps application mail behind a small provider interface. The first provider is Forward Email.

## Forward Email

Magic links are sent through Forward Email's `POST /v1/emails` API.

Required Worker runtime configuration:

- `FORWARD_EMAIL_API_TOKEN` — secret; never commit this value.
- `MAIL_FROM` — sender alias configured at Forward Email, for example `login@example.com`.

The sender address must exist as an alias on the Forward Email domain.

## Cloudflare setup

Set the API token as a Worker secret in Cloudflare. Set `MAIL_FROM` as a normal Worker variable once the Nexus sending domain and alias have been chosen.

Do not add either real value to `wrangler.jsonc` in the repository.

## Auth behavior

`POST /api/auth/request` accepts JSON:

```json
{ "email": "person@example.com" }
```

For privacy, the endpoint always returns the same accepted response for valid email syntax whether or not the address belongs to a Nexus user.

For active users it:

1. enforces a one-minute per-user cooldown,
2. creates a cryptographically random login token,
3. stores only its SHA-256 hash in D1,
4. expires it after 15 minutes,
5. sends the raw token only inside the login URL,
6. deletes the token again if mail delivery fails.

Forward Email is intentionally isolated behind `worker/mail/provider.ts`, so changing mail provider later does not require redesigning Nexus authentication.
