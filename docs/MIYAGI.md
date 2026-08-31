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
  └─ journal_entries
          ↓
worker/wellbeing/miyagi.ts
          ↓
90-day normalized context + deterministic summary
          ↓
Anthropic Messages API
          ↓
miyagi_analyses
          ↓
optional follow-up conversation
          ↓
miyagi_messages
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

Chat messages are stored separately in `miyagi_messages` and linked to the analysis.

The UI exposes a history view where prior analyses and their associated chats can be reopened.

AI output never overwrites Garmin data, wellbeing entries, or user-authored journal text.

## Journal assistant

Journal AI is related to Miyagi but intentionally has a narrower job.

When a user writes a journal entry, Nexus can generate a short contextual follow-up. It may consider:

- the new journal entry
- the same day's wellbeing metrics
- same-day Garmin daily signals
- sleep around that date
- activities on that date
- a small number of recent journal entries
- a compact rolling summary of older journal history

The journal assistant should not receive the full 90-day Miyagi dataset for every entry.

The goal is reflection and useful follow-up, not broad longitudinal analysis.

### Token strategy

The journal assistant borrows the useful parts of the NoteFlow tracker strategy:

- recent entries remain raw but bounded
- older history is compressed into a rolling summary
- current structured Nexus data is reduced to a small set of relevant fields
- journal bodies are clipped in AI context while source text remains intact in D1
- follow-up conversations are bounded

Current implementation limits include:

- recent raw journal window: 30 days, maximum 12 entries
- each recent journal entry: maximum 800 context characters
- current entry: maximum 4,000 context characters
- older rolling-summary input: maximum 12,000 characters per refresh
- rolling summary refresh: at most weekly when older unsummarized entries exist
- maximum 3 AI follow-up rounds per journal entry

The rolling summary lives in `journal_ai_state`. Individual AI prompts and user responses remain in `journal_followups` linked to the original `journal_entries` row.

Journal AI must never block or roll back the journal save itself. Source text is saved first; AI is a secondary layer.

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

Miyagi analysis preferences and rolling journal-AI summary state require `migrations/0014_wellbeing_history_and_ai.sql`.

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
POST /api/wellbeing/miyagi/chat
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

### Journal AI

```text
GET  /api/wellbeing/journal-ai/day?date=YYYY-MM-DD
POST /api/wellbeing/journal-ai/generate
POST /api/wellbeing/journal-ai/answer
```

AI followups use `journal_followups`; the original journal entry remains authoritative and immutable except through its normal journal CRUD flow.

## Product boundary

Miyagi and Journal AI are allowed to offer low-risk reflection such as things worth observing or tracking.

They must not present themselves as doctors, diagnose conditions, prescribe treatment, or turn sparse personal telemetry into medical certainty.

The UI should make this boundary visible without drowning the user in warnings.
