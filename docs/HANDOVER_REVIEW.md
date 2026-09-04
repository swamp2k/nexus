# Nexus ↔ UnraidWatch Integration Handover — Review

**Date:** 2026-09-02  
**Status:** Superseded in part — see the update below. Original review retained for the reasoning.

---

## Update — architecture revised to contract + transport

The integration was rebuilt around a **platform-neutral integration contract** with a **Cloudflare Service Binding** as its current transport, replacing the planned HTTPS + bearer-token design. That changes some findings and removes others. The reasoning below is kept because it still applies if an HTTP transport is added later.

| # | Finding | Now |
|---|---|---|
| 1 | Cloudflare token has no D1 permission | **Still blocking.** Re-confirmed: `wrangler d1 migrations list nexus --remote` → `code: 7403 — not authorized to access this service`. Two migrations are written but unapplied. |
| 2 | "UnraidWatch URL" ambiguous (Worker vs Pages) | **Obsolete for the active transport.** A Service Binding needs no URL. Still relevant if HTTP is added — the API origin is `unraidwatch-api`, not `unraidwatch.pages.dev`. |
| 3 | Migration 0025 leaves the Unraid API key in Nexus D1 | **Resolved.** `0026_unraidwatch_integration.sql` drops `unraid_servers`. |
| 4 | `UNRAID_CREDENTIALS_KEY` does not exist | **Resolved.** The key chain is `UNRAIDWATCH_CREDENTIALS_KEY` → `UNRAID_CREDENTIALS_KEY` → `GARMIN_CREDENTIALS_KEY`, matching the Garmin and MelCloud modules. No new secret needed. |
| 5 | DTO casing and nullability | **Resolved as recommended.** Contract emits camelCase; the Nexus UI is unchanged. UnraidWatch's `0` no-sensor sentinel is normalized to `null` at the contract boundary. |
| 6 | Polling and caching load | **Addressed.** Nexus polls every 30 s instead of 10 s, and the integration service holds a 10 s per-isolate overview cache. No new infrastructure. |
| 7 | CORS boundary | **Obsolete for the active transport** — a Service Binding never touches CORS. Still relevant for a future HTTP transport. |
| 8 | Who may configure it in Nexus | **Resolved as recommended.** Per-user config row; `viewer` cannot write. |
| 9 | Criterion 13 needs a merge | **Still true,** and now with a required order: UnraidWatch must deploy before Nexus, because Nexus's binding targets `unraidwatch-api#NexusIntegration`. |

Unchanged and still in force: UnraidWatch is the SSOT; Nexus carries no Unraid GraphQL client and no Unraid API key; no generic GraphQL passthrough; phase 1 is read-only; server-side only; Nexus and UnraidWatch user IDs are never assumed to match.

---

## Executive Summary

The handover document is architecturally correct. It aligns with Nexus's own AGENTS.md rules:

> **3.** Reuse mature domain logic; keep one source of truth. … **Unraid Watch**, DBA Gold, PC Watch, Home Assistant and similar are reusable domain components … Do not reimplement domain logic that already exists and works elsewhere — reuse that implementation and let it stay the SSOT for its domain.  
> **4.** Integration boundaries are pragmatic, not dogmatic. An HTTP API is right when it buys a useful stable boundary — **Unraid Watch owning all Unraid API access is the standing example.**

The plan—UnraidWatch as SSOT, hashed integration token, Nexus worker as thin proxy, read-only phase 1—is sound. However, the document leaves 4 **execution blockers** and 5 **open decisions** unresolved.

---

## Blockers

These will fail or silently misfire without explicit resolution:

### 1. Cloudflare Token Has No D1 Permission

**Issue:**  
The `CLOUDFLARE_API_TOKEN` cannot execute D1 migrations. Verified against the live API:

```
GET /accounts                          → 200 ✓
GET /accounts/…/workers/scripts        → 200 ✓
GET /accounts/…/d1/database            → 403 Authentication error ✗
GET /accounts/…/d1/database/e2d4b9fe-… → 403 Authentication error ✗
```

**Impact:**  
Handover steps 4 ("determine whether 0025 is applied") and 5 ("apply required migrations") cannot run from this session. Both `npm run db:migrate` (Nexus) and `wrangler d1 migrations apply` (UnraidWatch) fail silently or require the token to be upgraded.

**Resolution:**  
Add `D1:Edit` permission to the token, **or** explicitly state in the handover that *you* will run migrations manually and the agent writes them but does not apply them.

---

### 2. "UnraidWatch URL" Is Ambiguous; Intuitive Answer Is Wrong

**Issue:**  
```
https://unraidwatch-api.sr-goodjob.workers.dev/api/health   → 200 {"ok":true}   ✓
https://unraidwatch.pages.dev/api/health                     → 200 text/html    ✗ (SPA fallback)
```

The API is a separate Worker with no custom domain. Anyone (user or agent) will paste `unraidwatch.pages.dev` and get an opaque JSON parse error.

**Impact:**  
Silent failures, misleading error messages, confusing setup experience.

**Resolution:**  
1. Document: Nexus stores the **Worker API origin**, not the Pages URL.
2. The Nexus test endpoint should validate and reject non-JSON responses with a clear error: `"Got HTML instead of JSON — ensure you're using the Worker API URL, not the Pages URL."`

---

### 3. Migration 0025 vs. Criterion 9

**Issue:**  
Criterion 9 says: "Nexus never stores or receives the Unraid API key."  
Handover says: "Stop using the table, or repurpose."

For rows that already exist, those conflict. An unused `unraid_servers` row still encrypts and holds an Unraid API key in Nexus D1.

**Impact:**  
Criterion 9 fails to pass — keys remain encrypted but stored.

**Resolution:**  
Add an explicit step: migration `0026` that `DELETE FROM unraid_servers` or drops the table entirely (it's a leaf — safe to drop). Ensures no residual secrets remain.

---

### 4. `UNRAID_CREDENTIALS_KEY` Secret Does Not Exist

**Issue:**  
`worker/unraid/credentials.ts:25` references `env.UNRAID_CREDENTIALS_KEY`, but the deployed Nexus worker bindings do not include it. The code silently falls back to `env.GARMIN_CREDENTIALS_KEY`.

**Impact:**  
If you remove `UNRAID_CREDENTIALS_KEY`, nothing breaks (already absent). If you later add it, code already handles fallback. Low risk but confusing.

**Resolution:**  
Document this explicitly: the integration-token encryption should keep the existing **fallback pattern** (same as MelCloud and Garmin do). No new secret is needed.

---

## Open Decisions

These shape the code and will require a rework cycle if you guess wrong. Decide now:

### 5. DTO Casing and Nullability

**Question:**  
Should the integration API return camelCase or snake_case? Are numeric fields nullable?

**Current state:**
- UnraidWatch types emit snake_case (`cpu_pct`, `ram_used_gb`, `used_gb`) and non-nullable numbers.
- Nexus UI expects camelCase (`cpuPct`, `ramUsedGb`, `usedGb`) and nullable numbers (`tempAvg: number | null`).

**Impact:**  
If you choose **snake_case**, Nexus adapter layer must map every field. If you choose **camelCase**, UnraidWatch emits non-standard names. Either way, someone gets a mapping layer.

**Recommendation:**  
Integration DTO emits **camelCase matching UnraidPage.tsx exactly** — makes Nexus adapter a passthrough, keeps the UI unchanged.

---

### 6. Polling and Caching Strategy

**Question:**  
How aggressively should Nexus poll, and should UnraidWatch provide cached snapshots?

**Current state:**
- Nexus polls at ~10s while visible.
- UnraidWatch's per-minute cron already runs `collectMetrics` + `checkServerAvailability` + monitors for every user.
- This adds ~36 GraphQL queries/minute per Nexus user on top of existing load.
- UnraidWatch only caches **cpu/ram/temp** (`system_metrics`); no snapshot of array/docker/vms/shares/ups.

**Impact:**  
If you do nothing, every user doubles the Unraid GraphQL load.

**Recommendation:**  
Add a short KV/in-Worker TTL cache (10–15s) on `/api/integrations/nexus/overview`, keyed by server ID. Drop Nexus polling to 30s. Keeps load reasonable without complex cache invalidation.

---

### 7. CORS Boundary

**Question:**  
Is the integration API server-side-only, or can browsers call it?

**Current state:**  
`middleware/cors.ts` only allows `Content-Type` in `Access-Control-Allow-Headers` — no `Authorization`. This blocks browser-side Bearer token auth but is irrelevant for Worker→Worker calls.

**Impact:**  
Nobody can call the integration API directly from a browser. That's fine (this is the whole point of the Nexus proxy). But it should be explicit so future devs don't wonder why CORS is missing Authorization.

**Resolution:**  
Document: "Integration API is server-side-only by design. Nexus browser never sees the token or credentials."

---

### 8. Who May Configure It in Nexus

**Question:**  
Role-based access: is the UnraidWatch integration per-user or admin-only?

**Current state:**  
Nexus roles are admin/member/viewer. Current Unraid routes block only `viewer`.

**Decision needed:**  
- Per-user (a `member` configures their own token): allows multi-account flexibility but requires per-user UI state.
- Admin-only (single shared integration): simpler, one token per Nexus instance, all users share it.

**Recommendation:**  
Per-user. Matches the existing pattern in Nexus (every user has their own Garmin credentials, MelCloud config, etc.).

---

### 9. Deployment and Criterion 13

**Question:**  
How do changes deploy, and when can criterion 13 ("both Cloudflare deployments are green") be verified?

**Current state:**  
- Nexus deploys via **Cloudflare Workers Builds from GitHub**, not GitHub Actions. Triggered on push to `main`.
- UnraidWatch deploys via GitHub Actions, path-filtered.
- Nothing on the feature branch `claude/nexus-unraidwatch-handover-fiebo5` deploys automatically.

**Impact:**  
Criterion 13 is not achievable until you merge to `main`. The handover should clarify: deployments happen on merge, not branch push.

**Resolution:**  
Update criterion 13: "After merging to main, both Cloudflare deployments complete successfully."

---

## Verified ✓ / Not Verified ?

### Verified
- ✅ All 7 named Nexus files exist (UnraidPage.tsx, UnraidSettings.tsx, unraid.css, client.ts, credentials.ts, routes.ts, 0025_unraid.sql).
- ✅ Unraid work started after `ec4a768` ("Load navigation editor styles"); the 13 commits after it are all Unraid.
- ✅ No later unrelated work on the branch to worry about destroying.
- ✅ Nexus UI tabs exactly match handover (Overblik, Docker, VM'er, Shares, UPS, Forbindelse).
- ✅ Nexus polls ~10s while visible, pauses on Forbindelse tab.
- ✅ UnraidWatch files, routes, pages, and encryption all present as described.
- ✅ UnraidWatch uses AES-GCM encryption via `ENCRYPTION_KEY`, confirmed bound on deployed worker.
- ✅ Cloudflare account exists, 17 workers deployed (nexus, unraidwatch-api, others).
- ✅ `unraidwatch-api.sr-goodjob.workers.dev/api/health` responds 200 with JSON.

### Not Verified
- ? Whether migration `0025_unraid.sql` is actually applied to Nexus production D1 (no D1 read permission — genuinely unknown).
- ? Whether Nexus Unraid page works end-to-end in production (would need authenticated session).
- ? Whether the Cloudflare token has Workers *write* permission (auth endpoint, not secrets).

### Not Run
- ❌ No builds, typechecks, or tests — inspection only.
- ❌ Nothing committed or pushed.

---

## Recommendation

**Patch the handover document** with blockers 1–4 (clear execution path) and decisions 5–6 (these shape the code). Items 7–9 are clarifications you can fold in while you're there.

Once those are resolved, the overall plan is sound and ready to implement.

---

## Next Steps

1. **Resolve blocker 1:** Upgrade Cloudflare token to include D1:Edit, or document manual migration step.
2. **Resolve blocker 2:** Document Worker API origin, add validation in Nexus test endpoint.
3. **Resolve blocker 3:** Add migration 0026 to remove `unraid_servers` table.
4. **Resolve blocker 4:** Document fallback pattern for `UNRAID_CREDENTIALS_KEY`.
5. **Decide 5–9:** Pick DTO casing, cache strategy, role boundaries, deployment flow.
6. **Implement:** Once the handover is finalized, end-to-end implementation is straightforward.
