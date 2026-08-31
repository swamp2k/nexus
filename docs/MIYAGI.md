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

## Persistence

Each generated analysis stores:

- user ownership
- analysis period
- model name
- normalized context JSON
- SHA-256 context hash
- generated analysis text
- creation timestamp

The saved context is intentional: follow-up chat should discuss the same data that produced the visible analysis, even if new Nexus data arrives later.

Chat messages are stored separately in `miyagi_messages` and linked to the analysis.

AI output never overwrites Garmin data, wellbeing entries, or user-authored journal text.

## Provider configuration

The first configured model is Claude Sonnet 4.6 through Anthropic's Messages API.

`wrangler.jsonc` contains the non-secret model setting:

```json
"MIYAGI_MODEL": "claude-sonnet-4-6"
```

The API key must be a Cloudflare Worker secret:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Never commit the API key.

## Database migration

Miyagi requires `migrations/0013_miyagi.sql`.

Deploys do not apply migrations automatically. Apply explicitly:

```bash
npm run db:migrate
```

## API

```text
GET  /api/wellbeing/miyagi/latest
POST /api/wellbeing/miyagi/analyze
POST /api/wellbeing/miyagi/chat
```

`POST /analyze` accepts an optional JSON body:

```json
{ "days": 90 }
```

`POST /chat` requires the saved analysis id and a message:

```json
{
  "analysisId": "...",
  "message": "Hvordan ser søvn ud til at hænge sammen med mit overskud?"
}
```

## Analysis behavior

The system prompt requires Miyagi to:

- answer in Danish
- distinguish source facts, associations, and hypotheses
- avoid claiming causality from correlation
- cite concrete dates/periods/sample counts when describing patterns
- say when data coverage is too thin
- avoid diagnoses and prescriptions
- preserve journal wording as user-authored source material
- prioritize a small number of useful findings rather than commenting on every metric

## Product boundary

Miyagi is allowed to offer low-risk reflection such as things worth observing or tracking.

It must not present itself as a doctor, diagnose conditions, prescribe treatment, or turn sparse personal telemetry into medical certainty.

The UI should make this boundary visible without drowning the user in warnings.
