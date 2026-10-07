# Projects page setup

The Projects page reads from GitHub and Cloudflare with two read-only tokens. Never paste them into chat or code; they go straight into Cloudflare secrets.

## 1. GitHub token (read-only)

1. github.com → your avatar (top right) → **Settings**.
2. Left menu, bottom: **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Name: `nexus-projects`. Expiration: 1 year (set a reminder). Resource owner: `swamp2k`.
4. Repository access: **All repositories**.
5. Permissions → Repository permissions: only **Metadata: Read-only** (it is selected automatically). Leave everything else as "No access".
6. **Generate token** and keep the page open for step 4 below.

## 2. Cloudflare token (read-only)

1. dash.cloudflare.com → your avatar (top right) → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token** (Get started).
2. Name: `nexus-projects`.
3. Permissions (three rows, all **Account**, all **Read**):
   - Account · **Workers Scripts** · Read
   - Account · **Cloudflare Pages** · Read
   - Account · **D1** · Read
4. Account Resources: Include · your account.
5. **Continue to summary** → **Create Token**. Keep the page open.

## 3. Account ID

dash.cloudflare.com → **Workers & Pages** → the **Account ID** is shown in the right-hand column (copy icon).

## 4. Store them as secrets

In a terminal in the nexus folder run each command and paste the value when it asks (it is not shown or saved anywhere else):

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
```

## 5. Database

```bash
npm run db:migrate
npx wrangler d1 execute nexus --remote --file tools/projects-seed.sql
```

Then open Nexus → Projekter → **Scan nu**. After that the hourly cron rescans once a day by itself.
