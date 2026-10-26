# Savant API — integration with an API key

This document describes how an external system starts smart-contract audits in Savant
and retrieves the results using an API key. The source is `backend/api/openapi.yaml`
and the code on the `main` branch (as of 2026-10-26). Schemas are copied verbatim from
the OpenAPI specification.

---

## 1. What an API key can and cannot do

| Action | With a key | Endpoint |
| --- | --- | --- |
| Read plan rates (price per line) | ✅ | `GET /api/v1/audit-jobs/plan-rates` |
| Estimate an audit (no charge) | ✅ | `POST /api/v1/audit-jobs/estimate` |
| Upload a supporting document ahead of time | ✅ | `POST /api/v1/audit-documents` |
| Start an audit from files / ZIP / TAR / TAR.GZ | ✅ | `POST /api/v1/audit-jobs` |
| List audits | ✅ | `GET /api/v1/audit-jobs` |
| Audit status and progress | ✅ | `GET /api/v1/audit-jobs/{id}` |
| Structured report (JSON) | ✅ | `GET /api/v1/audit-jobs/{id}/report` |
| Report file (md / json / pdf / zip) | ✅ | `GET /api/v1/audit-jobs/{id}/report/download` |
| Download the audited sources | ✅ | `GET /api/v1/audit-jobs/{id}/source/download` |
| Import from GitHub (private or public repo) | ❌ session only | `POST /api/v1/repo/imports`, `/repo/imports/public` |
| Import a contract by address (Etherscan and similar) | ❌ session only | `POST /api/v1/contract-imports` |
| Test mode without an LLM (dry run) | ❌ browser admin only | — |
| Create / rotate / delete keys | ❌ session only | `/api/v1/api-keys` |
| Top up a balance, payments, payouts, KYC | ❌ session only | — |

There are no webhooks when an audit finishes. Poll the status (see §6).

---

## 2. Base URLs

| Environment | Base URL |
| --- | --- |
| Production | `https://savant.chat` |
| Dev / staging | `https://dev.savant.chat` |

Every path below is relative to the base URL and starts with `/api/v1`.

---

## 3. API keys

### 3.1 Getting a key

Keys are created in the Savant web UI, that is, from a browser session. A key cannot mint another key.

Key properties:

- format: `svk_<…>`;
- the full text is shown **once**, at creation or rotation. The database stores
  only the prefix and a SHA-256 hash;
- `expires_at` is optional. An expired or disabled key is rejected with `401`;
- the key acts **as the user who created it** (`kind: user`):
  the same balance, the same limits, the same audits.

Schemas for key management (for reference; these endpoints require a session):

```yaml
ApiKeyKind:
  type: string
  enum: [user]

CreateApiKeyRequest:            # POST /api/v1/api-keys
  type: object
  additionalProperties: false
  properties:
    name:       { type: string, maxLength: 120 }
    kind:       { $ref: ApiKeyKind }
    expires_at: { type: string, format: date-time }

ApiKeyCreatedResponse:          # response to create and rotate
  type: object
  required: [id, prefix, plaintext]
  properties:
    id:        { type: string, format: uuid }
    prefix:    { type: string }
    plaintext: { type: string }   # full svk_… key, shown once

ApiKey:                         # item from GET /api/v1/api-keys
  type: object
  required: [id, prefix, name, kind, active, created_at]
  properties:
    id:           { type: string, format: uuid }
    prefix:       { type: string }
    name:         { type: string }
    kind:         { $ref: ApiKeyKind }
    active:       { type: boolean }
    expires_at:   { type: string, format: date-time }
    last_used_at: { type: string, format: date-time }
    created_at:   { type: string, format: date-time }
```

Other operations: `POST /api/v1/api-keys/{id}/rotate`,
`PATCH /api/v1/api-keys/{id}` (`{"active": true|false}`), `DELETE /api/v1/api-keys/{id}`.

### 3.2 Sending the key

Any of the three `Authorization` header forms:

```
Authorization: Bearer svk_xxxxxxxx
Authorization: ApiKey svk_xxxxxxxx
Authorization: svk_xxxxxxxx
```

- When an `Authorization` header is present, the session cookie is ignored.
- A CSRF token is **not** required for key requests.
- A wrong, disabled, or expired key returns `401 unauthorized`.

### 3.3 Context: personal or organization

By default a request runs in the key owner's **personal** context: charges
come from the personal balance, and only personal audits are visible.

To act for an organization the key owner belongs to:

```
X-Savant-Context: org:<organization-uuid>
```

- An audit created in an organization context is paid from the organization balance and
  is visible only in that organization's context.
- Personal audits are not visible in an organization context, and the reverse is also true: a request for the
  wrong audit returns `404`, not `403`.
- An empty header or `X-Savant-Context: personal` means the personal context.

---

## 4. Shared conventions

### 4.1 Money

```yaml
MoneyAmount:
  type: string
  description: Decimal money amount serialized as a string with exactly two fractional digits.
  pattern: ^-?\d+\.\d{2}$
  examples: ['10.00']

AuditTokenRate:
  type: string
  description: USD price per source line, preserving configured decimal precision.
  pattern: ^\d+(\.\d+)?$
  examples: ['0.12']
```

Every amount is USD, as a string. Do not parse these into floats. Use a decimal type.

### 4.2 Errors

Every error uses the same envelope:

```yaml
ErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      $ref: ErrorBody

ErrorBody:
  type: object
  required: [code, message]
  properties:
    code:    { type: string }   # stable machine-readable code
    message: { type: string }   # text for a person
```

Example:

```json
{ "error": { "code": "unauthorized", "message": "authentication is required" } }
```

Branch on `error.code`, not on `message`.

Special envelopes for `402` when creating an audit:

```yaml
InsufficientFundsErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      type: object
      required: [code, message, current_balance, required, shortfall]
      properties:
        code:            { type: string, enum: [insufficient_funds] }
        message:         { type: string }
        current_balance: { $ref: MoneyAmount }
        required:        { $ref: MoneyAmount }
        shortfall:       { $ref: MoneyAmount }

MonthlyLimitExceededErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      type: object
      required: [code, message, tier_cap, current_spend, request_cost, shortfall, reset_at, upgrade_path]
      properties:
        code:          { type: string, enum: [monthly_limit_exceeded] }
        message:       { type: string }
        tier_cap:      { $ref: MoneyAmount }
        current_spend: { $ref: MoneyAmount }
        request_cost:  { $ref: MoneyAmount }
        shortfall:     { $ref: MoneyAmount }
        reset_at:      { type: string, format: date-time }
        upgrade_path:  { type: string }
```

### 4.3 Rate limits and retries

- Audit creation is limited per actor and per IP (by default 1000 requests
  per user and 10000 per IP per hour; the server can change these values).
- `429` and `503` include a `Retry-After` header (seconds). Do not retry sooner.
- `408 upload_timeout` means the upload was too slow or took too long. Retry
  or send a smaller archive.

---

## 5. Starting an audit

### 5.1 Plan rates

```
GET /api/v1/audit-jobs/plan-rates
```

```yaml
AuditPlanRatesResponse:
  type: object
  required: [plan_rates]
  properties:
    plan_rates:
      type: object
      required: [lite, advanced, pro]
      properties:
        lite:     { $ref: AuditPlanRate }
        advanced: { $ref: AuditPlanRate }
        pro:      { $ref: AuditPlanRate }

AuditPlanRate:
  type: object
  required: [rate]
  properties:
    rate:     { $ref: AuditTokenRate }        # USD per source line
    discount: { $ref: AuditPlanRateDiscount } # present when the user has a discount

AuditPlanRateDiscount:
  type: object
  required: [standard_rate, percent]
  properties:
    standard_rate: { $ref: AuditTokenRate }
    percent:       { type: number, minimum: 0, maximum: 100 }
```

Tiers (`tier`) are `AnalysisTier`:

```yaml
AnalysisTier:
  type: string
  enum: [lite, advanced, pro]
```

### 5.2 Request body (shared by estimate and create)

`Content-Type: multipart/form-data`. Schema:

```yaml
AuditJobMultipartRequest:
  type: object
  additionalProperties: false
  required: [tier]
  properties:
    tier:
      $ref: AnalysisTier                  # required: lite | advanced | pro
    file:                                 # repeatable part: one source file
      oneOf: [binary, array of binary]
    archive:                              # repeatable part: a source archive
      oneOf: [binary, array of binary]
    document:                             # repeatable part: an extra document (spec, whitepaper)
      oneOf: [binary, array of binary]    # documents are free context
    document-archive:                     # repeatable part: a document archive
      oneOf: [binary, array of binary]
    staged_document_ids:                  # ids of documents uploaded ahead of time (§5.5)
      type: array
      maxItems: 500
      uniqueItems: true
      items: { type: string, format: uuid }
    promoted_document_path:               # path INSIDE the source archive to treat as a document
      oneOf: [string, array of string]
    scope:                                # limit the audit to selected paths
      oneOf: [string, array of string]
    include_excluded:                     # include a file that was excluded automatically (tests, configs, …)
      oneOf: [string, array of string]
      maxItems: 500
    agent_channel:  { $ref: AgentChannel }  # admin session only — 403 with a key
    agent_image:    { type: string }        # admin session only — 403 with a key
    agent_settings: { type: string }        # admin session only — 403 with a key
    bypass_charge:  { type: boolean }       # admin only; ignored for everyone else
```

A "repeatable part" means multipart may send several parts with the same name
(`-F file=@A.sol -F file=@B.sol`, `-F scope=src/A.sol -F scope=src/B.sol`).

**Archives.** The format is detected from the contents (magic bytes), not the extension.
Supported formats are `zip`, `tar`, and `tar.gz`. Unpack limits:

| Limit | Value |
| --- | --- |
| Files in the archive | 60 000 |
| Size of one file | 100 MiB |
| Total unpacked size | 1 GiB |
| Input archive size | 1152 MiB |
| Compression ratio (zip bomb) | 200× |
| Path nesting depth | 32 |

Unsafe paths (`..`, absolute, NUL) are rejected with `archive_unsafe`.

**Automatic classification.** The server splits files into `source` (audited
and billed), `free_context` (passed to the agent as free context), and
`not_auditable`. It excludes tests, dependencies, generated code, lockfiles,
and similar files. The classification is in the estimate response (§5.3). To put
an excluded file back into the audit, use `include_excluded`. To narrow the audit, use `scope`.

Typical `400` codes: `tier_invalid`, `source_binary`, `source_too_small`,
`no_source_files`, `document_empty`, `document_unsupported`,
`scope_too_many_files`, `archive_too_many_files`, `archive_too_large`,
`file_too_large`, `archive_unsafe`, `archive_invalid`.

### 5.3 Cost estimate (free)

```
POST /api/v1/audit-jobs/estimate[?documents_only=true]
```

The body is the same as in §5.2. This creates nothing and charges nothing. Call it
before creating an audit to show the price and see which files will be included.

`documents_only=true` estimates documents only (requires `document` or `staged_document_ids`,
and forbids `file`, `archive`, `scope`, `promoted_document_path`, and `include_excluded`).

`200` response:

```yaml
AuditJobEstimateResponse:
  type: object
  required: [estimated_cost, token_count, files]
  properties:
    estimated_cost:    { $ref: MoneyAmount }      # amount that would be reserved
    token_count:       { type: integer, minimum: 0 }
    files:
      type: array
      items: { $ref: AuditJobEstimateFile }
    discount:          { $ref: AuditJobEstimateDiscount }
    excluded_files:
      type: array
      items: { $ref: AuditJobExcludedFile }
    hidden_file_count: { type: integer, minimum: 0 }

AuditJobEstimateFile:
  type: object
  required: [path, tokens, cost, standard_cost, selection_class]
  properties:
    path:               { type: string, minLength: 1 }
    staged_document_id: { type: string, format: uuid }  # staged documents only
    tokens:             { type: integer, minimum: 1 }
    cost:               { $ref: MoneyAmount }
    standard_cost:      { $ref: MoneyAmount }           # price before the discount
    selection_class:    { $ref: AuditSourceFileClass }
    tier:               { $ref: AuditSourceTier }
    reason:             { type: string }
    detail:             { type: string, maxLength: 5500 }
    default_selected:   { type: boolean }

AuditJobEstimateDiscount:
  type: object
  required: [standard_cost, amount, percent]
  properties:
    standard_cost: { $ref: MoneyAmount }
    amount:        { $ref: MoneyAmount }
    percent:       { type: number, minimum: 0, maximum: 100 }

AuditJobExcludedFile:
  type: object
  required: [path, tier, reason]
  properties:
    path:   { type: string, minLength: 1 }
    tier:   { $ref: AuditSourceTier }
    reason: { $ref: AuditSourceExclusionReason }
    detail: { type: string }

AuditSourceFileClass:
  type: string
  enum: [source, free_context, not_auditable]

AuditSourceTier:
  type: string
  enum: [checked, unchecked, disabled]

AuditSourceExclusionReason:
  type: string
  enum: [empty_file, unreadable, binary, metadata, minified, generated, lockfile, log,
         build-output, dependencies, tests, documentation, config, ci, secret-material,
         hidden, minified-likely, large]
```

Response codes: `200`, `400`, `401`, `408`, `409 staged_document_not_found`,
`503` (plus `Retry-After`; unpacking is temporarily overloaded).

Example:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs/estimate \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -F tier=advanced \
  -F archive=@contracts.zip
```

### 5.4 Creating an audit

```
POST /api/v1/audit-jobs
```

The body is §5.2. The server prices the upload again (the estimate price is not sent and
is not locked), **reserves** that amount on the balance, and queues the audit.

`201` response:

```yaml
AuditJobCreateResponse:
  type: object
  required: [job_id, state]
  properties:
    job_id: { type: string, format: uuid }
    state:  { $ref: AuditJobState }
```

Response codes:

| Code | Meaning |
| --- | --- |
| `201` | Audit created, funds reserved |
| `400` | Bad input (codes in §5.2) |
| `401` | Missing or invalid key |
| `402` | `insufficient_funds` or `monthly_limit_exceeded` (schemas in §4.2) |
| `403` | No permission to create audits in this context, or admin-only fields were sent (`agent_*`) |
| `408` | `upload_timeout` |
| `409` | `staged_document_not_found` |
| `429` | Rate limit; see `Retry-After` |
| `503` | Dependency unavailable / unpack overload / `runner_channel_unavailable`; see `Retry-After` |

Example — ZIP:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -F tier=lite \
  -F archive=@contracts.zip \
  -F document=@whitepaper.pdf
# → {"job_id":"7c1e…","state":"pending"}
```

Example — separate files, a scope limit, and an organization context:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -H "X-Savant-Context: org:$ORG_ID" \
  -F tier=pro \
  -F file=@src/Vault.sol \
  -F file=@src/Token.sol \
  -F scope=src/Vault.sol
```

**The request is not idempotent.** A retry creates a second audit and a second reservation.
After a network error, check `GET /api/v1/audit-jobs` first
(the new audit is first in the list), then decide whether to retry.

### 5.5 Staging documents (optional)

For a large document, or to reuse one between estimate and create,
upload it separately and then refer to it by id.

```
POST /api/v1/audit-documents          (multipart: document, tier)
DELETE /api/v1/audit-documents/{id}
```

```yaml
AuditDocumentStageRequest:
  type: object
  required: [document, tier]
  properties:
    document: { type: string, format: binary }
    tier:     { $ref: AnalysisTier }

StagedAuditDocument:            # 201 response
  type: object
  required: [id, name, size, sha256, tokens, cost, standard_cost, expires_at]
  properties:
    id:            { type: string, format: uuid }
    name:          { type: string }
    size:          { type: integer, format: int64, minimum: 1 }
    sha256:        { type: string, pattern: ^[0-9a-f]{64}$ }
    tokens:        { type: integer, minimum: 0 }
    cost:          { $ref: MoneyAmount }
    standard_cost: { $ref: MoneyAmount }
    expires_at:    { type: string, format: date-time }
```

- A document lives for 24 hours. The limits are 2 GiB and 500 live documents per user.
- Then pass `-F staged_document_ids=<id>` to estimate / create.
- A document is single-use: after an audit claims it, another use returns `409`.

---

## 6. Tracking status

### 6.1 Audit states

```yaml
AuditJobState:
  type: string
  enum: [pending, delayed, processing_audit, completed, failed, cancelled]
```

| State | Meaning | Terminal |
| --- | --- | --- |
| `pending` | Queued | no |
| `delayed` | Delayed by the server; it will still run | no |
| `processing_audit` | Running | no |
| `completed` | Done; the report is available | **yes** |
| `failed` | Finished with an error | **yes** |
| `cancelled` | Cancelled | **yes** |

Duration depends on the tier and the amount of code. The API cannot cancel an audit.

### 6.2 One audit

```
GET /api/v1/audit-jobs/{id}
```

`200` is `AuditJobDetail` (`AuditJobSummary` plus the fields below). `404` means there is
no such audit, or it is not visible in the current context.

```yaml
AuditJobDetail:
  allOf:
    - $ref: AuditJobSummary
    - type: object
      required: [stage_events]
      properties:
        poc_files_available: { type: boolean }   # whether PoC files exist (completed only)
        stage_events:
          type: array
          items: { $ref: JobStageEvent }
        report: { $ref: Report }                 # present when state = completed

AuditJobSummary:
  type: object
  required: [id, state, analysis_tier, source_name, estimated_cost, created_at, updated_at]
  properties:
    id:              { type: string, format: uuid }
    state:           { $ref: AuditJobState }
    analysis_tier:   { $ref: AnalysisTier }
    source_name:     { type: string, minLength: 1 }
    estimated_cost:  { $ref: MoneyAmount }
    finding_counts:  { $ref: FindingCounts }      # after completion
    progress:        { type: integer, minimum: 0, maximum: 100 }  # during analysis only
    agent_channel:   { type: string, enum: [stable, beta, alpha], nullable: true }
    agent_channel_degrade_reason:
      allOf: [{ $ref: AgentChannelDegradeReason }]
      nullable: true
    created_at:      { type: string, format: date-time }
    updated_at:      { type: string, format: date-time }

JobStageEvent:
  type: object
  required: [id, stage, status, progress, message, created_at]
  properties:
    id:         { type: string, format: uuid }
    stage:      { type: string }   # init | prepare | documents | triage | audit | finalize
    status:     { type: string, enum: [started, progress, finished, failed] }
    progress:   { type: integer, minimum: 0, maximum: 100 }
    message:    { type: string }
    created_at: { type: string, format: date-time }

FindingCounts:
  type: object
  required: [critical, high, medium, low, informational]
  properties:
    critical:      { type: integer, minimum: 0 }
    high:          { type: integer, minimum: 0 }
    medium:        { type: integer, minimum: 0 }
    low:           { type: integer, minimum: 0 }
    minor:         { type: integer, minimum: 0 }
    informational: { type: integer, minimum: 0 }
    theoretical:   { type: integer, minimum: 0 }

AgentChannelDegradeReason:
  type: string
  enum: [registry_unavailable, channel_unpublished]
```

`progress` on the summary is the latest percent of the `audit` stage. For finer
progress, read `stage_events`. The `failed` reason is the last event
with `status: failed` (`message`).

### 6.3 Audit list

```
GET /api/v1/audit-jobs?limit=50&cursor=<next_cursor>&status=<AuditJobState>
```

| Parameter | Type | Default |
| --- | --- | --- |
| `limit` | integer 1–100 | 50 |
| `cursor` | string — `next_cursor` from the previous page | — |
| `status` | `AuditJobState` | all |

```yaml
AuditJobListResponse:
  type: object
  required: [jobs]
  properties:
    jobs:
      type: array
      items: { $ref: AuditJobSummary }
    next_cursor: { type: string }   # absent on the last page
```

### 6.4 Recommended polling

- Poll every 30–60 seconds. On `429` or `503`, honor `Retry-After`.
- Stop on `completed`, `failed`, or `cancelled`.
- For a batch, one `GET /api/v1/audit-jobs?status=processing_audit` is cheaper
  than N requests by id.

---

## 7. Reading the result

### 7.1 Structured report

```
GET /api/v1/audit-jobs/{id}/report
```

`200` is a `Report`. `404` means the audit is not finished, there is no report, or the audit is not visible.
(The same object is the `report` field of `GET /audit-jobs/{id}`.)

```yaml
Report:
  type: object
  required: [schema_version, summary_markdown, findings, stats, generated_at]
  properties:
    schema_version:   { type: string }
    summary_markdown: { type: string }
    findings:
      type: array
      items: { $ref: ReportFinding }
    stats:            { $ref: ReportStats }
    generated_at:     { type: string, format: date-time }

ReportFinding:
  type: object
  required: [id, title, description_markdown, location]
  properties:
    id:                      { type: string }
    severity:                { $ref: FindingSeverity }
    verdict:                 { type: string, enum: [proved, partial, theoretical, unverified] }
    title:                   { type: string }
    description_markdown:    { type: string }
    code_snippet:            { type: array, items: { type: string } }
    recommendation_markdown: { type: string }
    location:                { $ref: ReportLocation }

FindingSeverity:
  type: string
  enum: [informational, minor, medium, high, critical, theoretical]

ReportLocation:
  type: object
  required: [file]
  properties:
    file:       { type: string }
    start_line: { type: integer, minimum: 1 }
    end_line:   { type: integer, minimum: 1 }

ReportStats:
  type: object
  required: [findings_count]
  properties:
    findings_count:          { type: integer, minimum: 0 }
    # The rest are measured counters, omitted when unknown (cap 1 000 000):
    files_analysed:          { type: integer }
    areas_examined:          { type: integer }
    areas_skipped:           { type: integer }
    candidates_screened:     { type: integer }
    candidates_discarded:    { type: integer }
    verified_with_poc:       { type: integer }
    theoretical:             { type: integer }
    could_not_reproduce:     { type: integer }
    false_positives_removed: { type: integer }
```

`verdict`: `proved` means confirmed by a PoC; `partial` means partly confirmed; `theoretical`
means a theoretical vulnerability; `unverified` means it was not checked.

### 7.2 Report file

```
GET /api/v1/audit-jobs/{id}/report/download?format=md|json|pdf|zip
```

| `format` | Contents |
| --- | --- |
| `md` (default) | Markdown report |
| `json` | JSON report |
| `pdf` | PDF |
| `zip` | Archive of every report format |

`200` is a binary stream (`application/octet-stream` or `application/zip`).
`404` means there is no report or it is not visible. `409` means that derived format was not generated
(for example, the PDF is not ready yet or was never created).

```bash
curl -sS -o report.pdf \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  "https://savant.chat/api/v1/audit-jobs/$JOB_ID/report/download?format=pdf"
```

### 7.3 Audited sources

```
GET /api/v1/audit-jobs/{id}/source/download
```

`200` is the original bundle, exactly what was audited. Use it to audit the same code again.
`404` means the audit is not visible or the bundle is no longer stored.

---

## 8. Full example (bash)

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=https://savant.chat
AUTH="Authorization: Bearer $SAVANT_API_KEY"

# 1. Estimate
curl -fsS "$BASE/api/v1/audit-jobs/estimate" -H "$AUTH" \
  -F tier=lite -F archive=@contracts.zip | jq '{estimated_cost, files: [.files[] | {path, cost}]}'

# 2. Create
JOB_ID=$(curl -fsS "$BASE/api/v1/audit-jobs" -H "$AUTH" \
  -F tier=lite -F archive=@contracts.zip | jq -r .job_id)
echo "job: $JOB_ID"

# 3. Wait
while :; do
  STATE=$(curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID" -H "$AUTH" | jq -r .state)
  echo "$(date +%T) $STATE"
  case "$STATE" in completed|failed|cancelled) break ;; esac
  sleep 60
done

# 4. Result
if [ "$STATE" = completed ]; then
  curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID/report" -H "$AUTH" \
    | jq '.findings[] | {severity, verdict, title, file: .location.file}'
  curl -fsS -o "report-$JOB_ID.pdf" -H "$AUTH" \
    "$BASE/api/v1/audit-jobs/$JOB_ID/report/download?format=pdf"
else
  curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID" -H "$AUTH" \
    | jq '.stage_events | map(select(.status=="failed")) | last'
fi
```

## 9. Example (Python)

```python
import time, requests

BASE = "https://savant.chat"
S = requests.Session()
S.headers["Authorization"] = f"Bearer {API_KEY}"

def check(r):
    if r.status_code >= 400:
        err = r.json().get("error", {})
        raise RuntimeError(f"{r.status_code} {err.get('code')}: {err.get('message')}")
    return r

with open("contracts.zip", "rb") as f:
    est = check(S.post(f"{BASE}/api/v1/audit-jobs/estimate",
                       data={"tier": "advanced"}, files={"archive": f})).json()
print("cost:", est["estimated_cost"])

with open("contracts.zip", "rb") as f:
    job = check(S.post(f"{BASE}/api/v1/audit-jobs",
                       data={"tier": "advanced"}, files={"archive": f})).json()
job_id = job["job_id"]

while True:
    r = S.get(f"{BASE}/api/v1/audit-jobs/{job_id}")
    if r.status_code in (429, 503):
        time.sleep(int(r.headers.get("Retry-After", "60"))); continue
    detail = check(r).json()
    if detail["state"] in ("completed", "failed", "cancelled"):
        break
    time.sleep(60)

if detail["state"] == "completed":
    for f in detail["report"]["findings"]:
        print(f.get("severity"), f.get("verdict"), f["title"], f["location"]["file"])
```

Several parts with the same name in `requests`: `files=[("file", open("A.sol","rb")), ("file", open("B.sol","rb"))]`,
`data=[("tier","lite"), ("scope","src/A.sol"), ("scope","src/B.sol")]`.

---

## 10. Testing the integration

There is no separate test mode for API keys right now. `agent_settings` with
`dry_run` is available only to an administrator in a browser session. A key gets `403`.

Options:

1. `POST /audit-jobs/estimate` and `GET /audit-jobs/plan-rates` are free.
   They check authentication, context, upload, and archive parsing.
2. A real `lite` audit of a minimal contract is the cheapest full
   create → poll → report run.
3. The `https://dev.savant.chat` stand uses a separate account and key. It may be
   configured with an idle worker (ask the Savant team).

---

## 11. Limits and known behavior

- There are no webhooks or completion notifications. Poll.
- The API cannot cancel an audit.
- Create has no idempotency key. A retry creates a second audit.
- GitHub import and import by contract address are not available to a key. Upload an archive
  (for example, `git archive --format=zip HEAD > src.zip`).
- A key inherits every permission of its owner, including admin permissions. Store
  administrator keys with extra care.
