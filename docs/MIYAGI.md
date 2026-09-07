# Mr. Miyagi

Mr. Miyagi is Nexus' private cross-domain wellbeing analysis feature.

It combines normalized Nexus data across health, motion, subjective check-ins, and journal entries, then uses an LLM to explain recurring patterns and possible associations.

Miyagi is deliberately an analysis/reflection tool, not a medical system.

## Data flow

```text
D1 normalized data
  ├─ garmin_daily
  ├─ garmin_sleep
  ├─ garmin_activities
  ├─ wellbeing_entries + wellbeing_metrics
  ├─ journal_entries
  ├─ journal_legacy_messages (user-authored legacy context only)
  └─ journal_ai_state (rolling long-term summary)
          ↓
worker/wellbeing/miyagi.ts
          ↓
90-day normalized context + deterministic summary
          ↓
Anthropic Messages API
          ↓
miyagi_analyses
          ↓
one ongoing Miyagi conversation
          ↓
miyagi_conversation_messages
```

The model never receives direct database access. The Worker builds a bounded context first.

## Analysis context

The default analysis window is 90 days. The API currently bounds requests to 30–180 days.

Context includes:

- Garmin daily health signals such as steps, resting heart rate, stress, Body Battery, activity/sedentary time, and respiration
- normalized sleep stages and duration
- Motion activities with duration, distance, heart rate, elevation, calories, and type
- daily subjective metrics with their configured direction
- journal entries
- a compact long-term journal summary built from older user-authored journal entries and legacy user messages
- deterministic aggregate values such as average sleep, steps, resting heart rate, stress, activity volume, and per-metric averages

Journal text is bounded before it is sent to the provider to prevent pathological context growth. Source entries in D1 remain untouched.

## Analysis behavior and options

Miyagi is insight-first rather than data-first. Raw values are evidence for a finding, not the main product.

Default analysis options are:

- length: `short`
- tone: `empathetic`
- focus: empty / general analysis

The user can override these per analysis:

- `short`, `normal`, or `deep`
- `objective`, `empathetic`, or `miyagi`
- optional free-text focus

The system prompt requires Miyagi to:

- answer in Danish
- distinguish source facts, associations, and hypotheses
- avoid claiming causality from correlation
- avoid long recitations of raw values
- look for signals that move together and before/after patterns
- ask concrete questions when human context is missing around an interesting period
- say when data coverage is too thin
- avoid diagnoses and prescriptions
- preserve journal wording as user-authored source material
- prioritize a small number of useful findings rather than commenting on every metric

## Persistence and history

Each generated analysis stores:

- user ownership
- analysis period
- model name
- normalized context JSON
- SHA-256 context hash
- generated analysis text
- focus
- response length
- tone
- creation timestamp

The saved context is intentional: follow-up chat should discuss the same data that produced the visible analysis, even if new Nexus data arrives later.

All current Miyagi dialogue is stored in `miyagi_conversation_messages` as one chronological user-owned timeline. Each message may retain an `analysis_id` showing which analysis was active for that reply and/or a `journal_entry_id` showing that it originated from a daily check-in comment.

The conversation continues across new analyses. A new analysis changes the analytical background for subsequent replies; it does not start a second chat or erase the visible conversation.

The UI exposes a history view where prior analyses can still be reopened with the messages associated with that analysis at the time.

AI output never overwrites Garmin data, wellbeing entries, or user-authored journal text.

## Daily check-in and Miyagi conversation

The daily check-in contains subjective metrics plus an optional free-text comment.

The comment remains authoritative source text in `journal_entries`. In the same database write it is also referenced into `miyagi_conversation_messages` as a user message with `kind = 'checkin'` and the original journal creation timestamp.

If a comment is present:

1. the check-in and journal text are saved first
2. the Miyagi chat opens
3. the comment appears immediately as the user's next conversation message
4. Miyagi builds a bounded same-day context from wellbeing metrics, Garmin health/sleep/activity, recent journal history and the latest analysis when one exists
5. Miyagi's reply is written to the same chronological conversation timeline

There is no separate journal-assistant chat in the UI.

Miyagi may still converse when no full analysis exists. In that case he must stay within the available conversation/check-in context and must not pretend to have longitudinal structured data he has not analyzed.

The old `journal_followups` and `miyagi_messages` tables are retained as legacy storage only. Migration `0031_miyagi_conversation.sql` backfills their content into the unified timeline. Existing journal follow-up rows are unfolded into separate assistant and user messages using their original `created_at` and `answered_at` timestamps.

The rolling summary in `journal_ai_state` remains a compact source-only memory helper. Original journal text remains ground truth and AI output never overwrites it.

### Export and chronology

`GET /api/wellbeing/export` returns an authenticated JSON export containing:

- wellbeing metric definitions
- all recorded check-in values
- authoritative journal entries
- Miyagi analyses
- `miyagi.conversationTimeline`, ordered by `createdAt`

The conversation timeline includes current Miyagi chat, check-in comments, migrated journal follow-up dialogue, and imported legacy conversation rows with provenance metadata. Check-in comments therefore remain available both as raw journal source records and as their correctly timestamped position in the conversation timeline.

## Provider configuration

The configured model is Claude Sonnet 4.6 through Anthropic's Messages API.

`wrangler.jsonc` contains the non-secret model setting:

```json
"MIYAGI_MODEL": "claude-sonnet-4-6"
```

The API key must be a Cloudflare Worker secret:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Never commit the API key.

## Database migrations

Miyagi base persistence requires `migrations/0013_miyagi.sql`.

Miyagi analysis preferences and rolling journal summary state require `migrations/0014_wellbeing_history_and_ai.sql`.

The unified Miyagi/check-in conversation requires `migrations/0031_miyagi_conversation.sql`.

Deploys do not apply migrations automatically. Apply explicitly:

```bash
npm run db:migrate
```

## API

### Miyagi

```text
GET  /api/wellbeing/miyagi/latest
GET  /api/wellbeing/miyagi/history
GET  /api/wellbeing/miyagi/history/:analysisId
POST /api/wellbeing/miyagi/analyze
POST /api/wellbeing/miyagi/checkin
POST /api/wellbeing/miyagi/chat
GET  /api/wellbeing/export
```

`POST /analyze` accepts:

```json
{
  "days": 90,
  "focus": "",
  "length": "short",
  "tone": "empathetic"
}
```

`POST /chat` requires the saved analysis id and a message:

```json
{
  "analysisId": "...",
  "message": "Hvordan ser søvn ud til at hænge sammen med mit overskud?"
}
```

### Daily history

```text
GET /api/wellbeing/history?limit=180
```

Returns daily wellbeing metrics, journal entries, and linked journal-AI followups grouped by date.

### Legacy Journal AI routes

The old `/api/wellbeing/journal-ai/*` routes remain temporarily for backwards compatibility and historical data handling. The current UI does not call them; new check-in comments use `POST /api/wellbeing/miyagi/checkin` and the unified conversation timeline.

## Product boundary

Miyagi and Journal AI are allowed to offer low-risk reflection such as things worth observing or tracking.

They must not present themselves as doctors, diagnose conditions, prescribe treatment, or turn sparse personal telemetry into medical certainty.

The UI should make this boundary visible without drowning the user in warnings.
