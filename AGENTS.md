# AGENTS.md — STR City Finder

## 1. Mission

STR City Finder is an automated real-estate opportunity screening system.

Its job is to:

1. Authenticate to Creative Listing.
2. Retrieve newly available or materially changed listings.
3. Normalize the source data into stable internal models.
4. Evaluate each listing using the project's YAML-based investment rules.
5. Persist raw facts, normalized facts, evaluation results, and run metadata in Azure.
6. Produce concise, decision-oriented outputs that help identify which deals are worth investigating further.

The system should minimize manual work while remaining transparent, testable, and safe to operate.

---

## 2. Core Engineering Principle

**Separate facts from judgment.**

Source data from Creative Listing must never be mixed with the project's investment evaluation.

A listing may contain facts such as:

- purchase price
- beds
- baths
- square footage
- year built
- PITI
- entry fee
- location
- property type
- occupancy status
- seller-provided notes
- financing terms

The evaluation layer may produce judgments such as:

- pass / fail
- needs payment verification
- candidate score
- rejection reasons
- STR-market-review required
- follow-up required
- confidence level

This separation is mandatory.

Raw/source facts must remain recoverable even if the evaluation logic changes later.

---

## 3. Source of Truth for Investment Rules

The project uses a YAML configuration file for investment rules.

**The YAML file is the authoritative source of truth.**

Do not hard-code buy-box rules inside scraper code, Azure code, orchestration code, or LLM prompts.

Expected location:

```text
config/buybox.yaml
```

### Required behavior

- Load the YAML at runtime.
- Validate it against a typed schema before evaluating any listing.
- Fail clearly if required configuration is invalid.
- Preserve rule names and reason codes in evaluation output.
- Keep deterministic rules deterministic.
- Do not silently reinterpret YAML values.
- Do not invent missing rules.
- Do not weaken or broaden a rule because a listing "looks interesting."
- If a required fact is missing, follow the YAML-defined missing-data behavior.
- If the YAML says a listing requires verification rather than rejection, return that verification state exactly.

### Rule changes

When the YAML changes:

- evaluation behavior should change without requiring scraper modifications;
- existing stored listing facts must remain valid;
- previously stored evaluations should not be overwritten without preserving evaluation version/history.

The code should make it possible to re-evaluate old listings against a newer rule set later.

---

## 4. Technology Stack

Default stack:

- Node.js
- TypeScript
- Playwright
- Chromium
- Azure Container Apps Jobs
- Azure Key Vault
- Azure Storage / Table Storage
- Azure Managed Identity
- Docker
- Git

Use Azure SDK packages rather than shelling out to Azure CLI from application code.

Prefer current stable library versions unless the repository pins a specific version.

---

## 5. Azure Architecture

The production execution model is a scheduled Azure Container Apps Job.

High-level flow:

```text
Azure Container Apps Job
        |
        +--> Managed Identity
        |       |
        |       +--> Azure Key Vault
        |
        +--> Playwright / Chromium
        |       |
        |       +--> Creative Listing
        |
        +--> Normalization
        |
        +--> YAML Rule Evaluation
        |
        +--> Azure Persistence
        |
        +--> Run Summary / downstream notification
```

Do not introduce ChatGPT Work, browser agents, or another interactive UI as a runtime dependency for scraping.

ChatGPT/Codex may help develop or analyze the system, but production collection must run independently in Azure.

---

## 6. Authentication and Secrets

Creative Listing credentials are stored in Azure Key Vault.

### Mandatory rules

- Never commit secrets.
- Never put passwords, tokens, cookies, or connection strings into source code.
- Never write secrets to logs.
- Never echo secrets in errors.
- Never place secrets in Azure Table Storage.
- Never put real secrets in `.env.example`.
- Prefer Managed Identity over Azure client secrets.
- Grant the smallest Azure permissions required.

The application should retrieve secrets from Key Vault at runtime.

Local development may use developer credentials or environment-based Azure authentication, but production must prefer Managed Identity.

---

## 7. Browser Session Handling

Use Playwright with Chromium.

Prefer reusing an authenticated browser session when practical instead of performing a full username/password login on every run.

Desired behavior:

```text
Load saved authenticated state
        |
        v
Is session still valid?
   |              |
  yes             no
   |              |
 scrape       retrieve credentials
                  |
                  v
                login
                  |
                  v
            refresh session state
                  |
                  v
                scrape
```

Authenticated browser state is sensitive.

If persisted:

- store it only in a private Azure location;
- treat it like a credential;
- do not commit it to Git;
- do not print it;
- do not store it in Table Storage;
- support session invalidation and refresh.

Do not assume cookies remain valid indefinitely.

---

## 8. Scraper Design

The scraper must be isolated from evaluation logic.

Recommended boundaries:

```text
src/
  scraper/
    creativeListing/
  models/
  normalization/
  rules/
  azure/
  orchestration/
  logging/
```

Exact names may evolve, but responsibilities must remain separated.

### Scraper responsibilities

The scraper may:

- authenticate;
- navigate;
- search;
- paginate;
- extract source fields;
- detect listing IDs;
- detect source timestamps when available;
- capture source URLs;
- identify whether a listing is new or changed.

The scraper must not:

- decide whether a deal is good;
- apply buy-box rules;
- calculate an investment score;
- reject listings based on business criteria;
- mutate YAML configuration.

### Selector strategy

Prefer selectors in this order:

1. stable IDs or test attributes;
2. stable semantic attributes;
3. labels / roles;
4. durable DOM structure;
5. text selectors only when necessary.

Avoid fragile selectors based on generated CSS classes or nth-child positions unless there is no better choice.

Centralize selectors where practical.

---

## 9. Source Data Preservation

Preserve the original values extracted from Creative Listing before normalization when practical.

Examples:

```text
"$250,000"            -> normalized purchasePrice = 250000
"$2,200 / month"      -> normalized piti = 2200
"3 beds and 2 baths"  -> normalized beds = 3, baths = 2
```

The normalized model should be typed.

Do not silently convert ambiguous values.

If parsing fails:

- retain the raw value;
- mark the normalized field as unavailable or uncertain;
- record a structured parsing issue.

Never fabricate a value to satisfy a schema.

---

## 10. Listing Identity and Idempotency

Every run must be safe to execute more than once.

Prefer Creative Listing's stable listing/deal ID as the canonical external identifier.

If no stable ID exists, derive identity conservatively using stable source attributes and document the strategy.

The system should distinguish between:

- new listing;
- unchanged listing;
- materially changed listing;
- previously seen listing;
- listing no longer available, when detectable.

Do not create duplicate records merely because the same listing appeared in multiple scraping runs.

Do not depend on address alone if a more reliable external ID exists.

---

## 11. Rule Engine

The rule engine consumes normalized listing data plus the validated YAML configuration.

It must be deterministic for deterministic rules.

Recommended result shape:

```ts
type EvaluationStatus =
  | "PASS"
  | "REJECT"
  | "NEEDS_VERIFICATION"
  | "NEEDS_MARKET_REVIEW"
  | "ERROR";

interface RuleResult {
  ruleId: string;
  status: "PASS" | "FAIL" | "VERIFY" | "NOT_APPLICABLE";
  reasonCode: string;
  message: string;
  observedValue?: unknown;
  expectedValue?: unknown;
}

interface ListingEvaluation {
  listingId: string;
  rulesVersion: string;
  evaluatedAt: string;
  status: EvaluationStatus;
  results: RuleResult[];
}
```

This is guidance, not an immutable API. Preserve the concepts even if implementation names differ.

### Evaluation requirements

- Explain every rejection with structured reasons.
- Explain every verification requirement.
- Preserve the rule/version used.
- Avoid opaque scores without supporting rule-level detail.
- A score must never override a hard rejection rule.
- Missing information must not be treated as passing information.

---

## 12. STR Market Analysis Boundary

Property-level screening and market-level STR analysis are separate stages.

The deterministic YAML rules should first eliminate obvious non-candidates.

Only viable or potentially viable candidates should advance to more expensive market analysis.

Example pipeline:

```text
Creative Listing
      |
      v
Normalize
      |
      v
Deterministic YAML screening
      |
      +--> REJECT ------------------> store result
      |
      +--> NEEDS VERIFICATION ------> store / surface
      |
      +--> CANDIDATE
               |
               v
          STR market review
               |
               v
          final recommendation
```

Do not make external market-research calls for every scraped listing when a deterministic rule already disqualifies it.

---

## 13. Storage

Azure Storage is the persistence layer.

The system uses Azure Table Storage for structured operational and business data, plus Azure Blob Storage for larger diagnostic or raw artifacts.

The canonical structured tables are:

```text
Listings
Evaluations
ListingReviews
Markets
MarketDailyStats
Runs
Errors
```

Azure Blob Storage is used for:

```text
raw normalized/source snapshots
Playwright screenshots
Playwright traces
sanitized debugging artifacts
other large diagnostic files
```

### Storage principles

The storage model must preserve the separation between:

1. source facts;
2. normalized facts;
3. deterministic evaluation results;
4. human review / deal actions;
5. market-level analysis;
6. operational execution data.

Do not collapse these concerns into a single record.

The system must preserve enough history to answer questions such as:

- When did we first see this listing?
- When was it last seen?
- What changed?
- Which rule set evaluated it?
- Why did it pass or fail at a given point in time?
- Did a human review it?
- Did we reject it, offer on it, lose it, put it under contract, or purchase it?
- Which markets repeatedly generate listings that satisfy the buy box?
- How many qualifying listings appeared in a market on a specific day?
- Did a run fail, partially complete, or return zero legitimate results?

### `Listings`

`Listings` stores the current known state of every Creative Listing deal the system has observed.

Do not store only listings that pass the buy box.

Rejected listings must also be retained so the system can detect later changes in price, PITI, financing terms, availability, or other material fields that may cause the listing to qualify later.

Typical data includes:

```text
SourceListingId
SourceUrl

Address
City
State
ZipCode

PropertyType
Beds
FullBaths
HalfBaths
SqFt
YearBuilt

PurchasePrice
EntryFee
LoanBalance
InterestRate
PITI
HOA

Description
FinancingType

FirstSeenAt
LastSeenAt
SourcePostedAt
SourceStatus

CurrentFilterStatus
CurrentManualStatus
LastEvaluationAt
RulesVersion
```

`Listings` represents the current state only. Historical evaluation decisions belong in `Evaluations`, and human actions belong in `ListingReviews`.

### `Evaluations`

`Evaluations` stores the history of deterministic YAML-based evaluations for each listing.

Never overwrite evaluation history merely because the listing was re-evaluated.

Each evaluation should preserve at minimum:

```text
ListingId
EvaluatedAt
RulesVersion
FinalStatus
RuleResults
RelevantFinancialSnapshot
```

This table must make it possible to explain why a listing passed, failed, or required verification under a particular version of the rules.

A listing may therefore have evaluation history such as:

```text
2026-09-09 -> REJECT
PITI = 3200

2026-09-12 -> PASS
PITI = 2850
seller terms changed
```

A hard rejection result must remain historically visible even if the listing qualifies later.

### `ListingReviews`

`ListingReviews` stores human deal-review activity and outcomes.

This is intentionally separate from deterministic automated evaluation.

Typical actions include:

```text
NOT_REVIEWED
REVIEWING
REJECTED
OFFERED
OFFER_REJECTED
OFFER_ACCEPTED
UNDER_CONTRACT
LOST
NO_LONGER_AVAILABLE
PURCHASED
```

Typical fields include:

```text
ListingId
ReviewedAt
Action
ReasonCode
Notes
OfferAmount
OfferDate
```

Human review history should be append-oriented so the lifecycle of a deal can be reconstructed later.

A machine `PASS` does not imply that a human approved the deal.

### `Markets`

`Markets` stores the current known analysis of a market.

Prefer a stable market identifier such as:

```text
STATE#CITY
```

or another documented canonical identifier if market boundaries require something more precise.

Typical fields may include:

```text
MarketId
City
State

FirstSeenAt
LastSeenAt
FirstAnalyzedAt
LastAnalyzedAt

STRBuyBoxStatus
OverallScore

RegulationStatus
DemandScore
RevenueScore
CompetitionScore

MedianHomePrice
ExpectedADR
ExpectedOccupancy
ExpectedAnnualRevenue

Notes
AnalysisVersion
```

This table represents the latest known market state.

Historical daily market opportunity counts belong in `MarketDailyStats`.

### `MarketDailyStats`

`MarketDailyStats` stores one daily market snapshot for reporting and trend analysis.

This table is critical because it allows the project to identify markets that consistently produce deals compatible with the investment strategy without rescanning the full listings history for every report.

Typical fields include:

```text
Date
MarketId

ListingsSeen
NewListings

FilterPassed
NewFilterPassed
NeedsVerification
Rejected

ActiveQualifiedListings

AveragePurchasePrice
AveragePITI

ManuallyReviewed
OffersMade
```

The exact metrics may evolve, but daily snapshots must remain reproducible and comparable over time.

This table should support reporting such as:

- qualifying listings per market per day;
- new qualifying listings per market;
- 7-day / 30-day opportunity trends;
- markets with the highest concentration of buy-box-compatible deals;
- pass-rate by market;
- offer activity by market.

### `Runs`

`Runs` stores one record for each automated execution.

Each run must have a unique `RunId`.

Track at minimum:

```text
RunId
StartedAt
FinishedAt
Status

ListingsFound
NewListings
ChangedListings
Evaluated
Passed
Rejected
NeedsVerification
MarketsSeen

RulesVersion
GitCommit
DurationSeconds
```

Suggested run statuses:

```text
SUCCESS
PARTIAL
FAILED
```

A successful run that legitimately finds zero listings must be distinguishable from a broken scraper that accidentally returns zero listings.

### `Errors`

`Errors` stores structured technical failures for debugging and operations.

Errors should normally be correlated to a `RunId` and, when relevant, a `ListingId`.

Typical fields include:

```text
RunId
ListingId
OccurredAt

Severity
Stage
ErrorType
ErrorCode
Message

Page
RetryAttempt
Resolved

DiagnosticArtifact
```

Do not store large screenshots, HTML documents, or Playwright traces directly in Table Storage.

Store large artifacts in Blob Storage and reference them from the error record.

### Blob Storage

Blob Storage should be used for large or semi-structured artifacts.

Examples:

```text
raw/YYYY/MM/DD/<listing-id>.json

errors/YYYY/MM/DD/<run-id>/<artifact>

playwright/YYYY/MM/DD/<run-id>/trace.zip
```

When practical, preserve a sanitized source snapshot for important listing changes so historical records can be reprocessed if parsing logic later changes.

Do not store browser session state alongside normal raw listing snapshots. Authenticated browser state is sensitive and must follow the security requirements in this document.

### Azure Table design constraints

Detailed `PartitionKey` and `RowKey` strategies are defined in Section 33.

Business logic must not directly depend on Table Storage key composition.

Keep storage access behind repository/service interfaces so key strategies may evolve without rewriting scraper, normalization, or rule-engine code.
## 14. Run Tracking

Each execution must have a unique run identifier.

Track at minimum:

- run ID;
- start time;
- finish time;
- status;
- scraper version / commit when practical;
- rules version;
- number of listings discovered;
- number of new listings;
- number of changed listings;
- number evaluated;
- number rejected;
- number requiring verification;
- number promoted for further analysis;
- structured errors.

A failed run must be distinguishable from a successful run containing zero results.

---

## 15. Incremental Processing

Prefer incremental processing.

The system should avoid reprocessing every historical listing on every daily execution unless explicitly running a backfill or re-evaluation job.

Use source IDs, timestamps, hashes, or normalized change detection to determine whether a listing needs to be processed again.

A changed listing should be re-evaluated.

Examples of material changes may include:

- purchase price;
- PITI;
- entry fee;
- financing terms;
- beds/baths;
- property type;
- occupancy;
- status;
- description or deal terms relevant to the YAML rules.

---

## 16. Logging

Use structured logging.

Logs should answer:

- Which run is this?
- Which listing was being processed?
- Which stage failed?
- Was the failure transient, parsing-related, authentication-related, or business-rule-related?

Recommended fields:

```text
runId
listingId
stage
event
status
durationMs
errorCode
```

Never log credentials, session state, authorization headers, or complete sensitive payloads.

Prefer concise structured logs over large browser dumps.

---

## 17. Error Handling

Classify failures.

Suggested categories:

- authentication failure;
- session expired;
- navigation failure;
- selector/DOM change;
- rate limiting;
- timeout;
- parsing failure;
- configuration validation failure;
- Azure dependency failure;
- persistence failure;
- evaluation failure.

Transient infrastructure or navigation errors may be retried with bounded retries and backoff.

Do not blindly retry deterministic failures such as invalid YAML indefinitely.

A single malformed listing should not necessarily abort the entire run.

Authentication failure or invalid configuration may justify stopping the run because subsequent results cannot be trusted.

---

## 18. Playwright Artifacts for Failures

For browser failures, support diagnostic artifacts such as:

- screenshot;
- Playwright trace;
- current URL;
- limited sanitized HTML fragment when necessary.

Only capture what is necessary for debugging.

Artifacts must not expose passwords, tokens, payment data, or sensitive session material.

Production diagnostic retention should be bounded.

---

## 19. Testing Strategy

Tests are required for meaningful business logic.

### Unit tests

Prioritize unit tests for:

- YAML validation;
- price parsing;
- currency parsing;
- bedroom/bathroom parsing;
- PITI parsing;
- financing-term parsing;
- normalization;
- rule evaluation;
- missing-data handling;
- change detection.

### Integration tests

Use integration tests for:

- Azure adapters where practical;
- serialization/deserialization;
- persistence behavior;
- idempotency.

### Playwright tests

Use browser tests selectively.

Do not make the entire unit-test suite depend on Creative Listing being online.

Where possible, test parsing and selectors against saved sanitized fixtures.

---

## 20. TypeScript Standards

Use TypeScript strictly.

Prefer:

- explicit domain models;
- discriminated unions;
- schema validation at external boundaries;
- small pure functions for parsing and rules;
- dependency injection where it materially improves testability;
- `async/await`;
- clear error types.

Avoid:

- pervasive `any`;
- giant utility files;
- hidden global state;
- business logic embedded in Playwright page code;
- stringly typed statuses when a union or enum-like type is appropriate.

External data is untrusted until validated.

---

## 21. Configuration

Configuration belongs outside business logic.

Examples:

- Key Vault secret names;
- Creative Listing base URL;
- browser timeout;
- retry count;
- Azure resource names;
- YAML rules path;
- schedule-related values when relevant;
- feature flags.

Use environment variables for deployment-specific configuration.

Use YAML for investment/business rules.

Do not use environment variables as a substitute for the buy-box YAML.

---

## 22. Repository Hygiene

Never commit:

```text
.env
.env.*
storageState.json
auth.json
cookies.json
playwright/.auth/
node_modules/
dist/
real credentials
Azure connection strings
browser traces containing sensitive session data
```

An `.env.example` may be committed, but it must contain names/placeholders only.

Before adding a new secret-like configuration value, assume it is sensitive until proven otherwise.

---

## 23. Docker

The production application must run consistently in a container.

The Docker image should:

- include required Playwright/Chromium dependencies;
- run as a non-root user when practical;
- avoid embedding credentials;
- use deterministic dependency installation;
- be reasonably small without making browser execution fragile;
- expose a clear application entrypoint.

Local success outside Docker is not sufficient if the production target is Azure Container Apps Jobs.

---

## 24. Azure Deployment Principles

Prefer infrastructure that is:

- repeatable;
- least-privileged;
- observable;
- inexpensive while idle;
- easy to recreate.

Avoid portal-only manual configuration for important infrastructure where practical.

Infrastructure as Code may use Bicep unless the repository adopts another standard.

Do not create cloud resources automatically from application runtime code.

---

## 25. Cost Discipline

This project should be inexpensive to operate.

Prefer:

- scheduled jobs rather than always-on compute;
- incremental scraping;
- deterministic filtering before expensive analysis;
- bounded logging and artifact retention;
- storage patterns appropriate for Azure Table Storage.

Do not introduce a database, queue, AI service, or always-on service unless it solves a demonstrated requirement.

---

## 26. LLM / AI Usage

Do not use an LLM for rules that can be expressed deterministically in YAML and TypeScript.

LLMs may be useful later for:

- summarizing listing descriptions;
- extracting difficult unstructured seller notes;
- explaining evaluation results;
- market research synthesis;
- final candidate summaries.

Any LLM-derived fact used in a decision must be distinguishable from directly sourced Creative Listing data.

Do not allow an LLM to silently override hard buy-box rules.

---

## 27. Security

Treat Creative Listing as an authenticated third-party system.

Requirements:

- least privilege;
- no credential leakage;
- no source-code secrets;
- safe logging;
- private session-state storage;
- dependency hygiene;
- bounded browser artifacts;
- secure Azure identities.

Do not add anti-detection, CAPTCHA-bypass, or credential-sharing mechanisms.

If Creative Listing presents a CAPTCHA, MFA requirement, explicit access restriction, or other barrier that prevents unattended automation, stop and surface the issue rather than attempting to bypass it.

---

## 28. Respect the Source System

Automation should behave conservatively.

- Avoid unnecessary page loads.
- Avoid aggressive concurrency.
- Avoid scraping the same pages repeatedly without need.
- Use incremental retrieval where possible.
- Add bounded waits/retries for normal transient failures.
- Do not intentionally circumvent rate limits or access controls.

Correctness and account safety matter more than shaving seconds off a daily run.

---

## 29. Codex Working Rules

When modifying this repository, Codex must:

1. Read this `AGENTS.md` before making architectural changes.
2. Inspect existing code before creating duplicate abstractions.
3. Use the existing YAML rules as the source of truth.
4. Preserve separation between scraping, normalization, evaluation, and persistence.
5. Prefer modifying existing modules over creating parallel implementations.
6. Keep changes scoped to the requested task.
7. Run relevant tests after changes.
8. Run TypeScript type checking after meaningful code changes.
9. Run linting if configured.
10. Report tests or checks that could not be executed.
11. Never invent secrets or production resource identifiers.
12. Never silently change investment rules.
13. Update documentation when architecture or configuration changes.
14. Avoid broad refactors unless they materially help the requested change.
15. Preserve backward compatibility with stored data unless a migration is explicitly part of the task.

---

## 30. Definition of Done

A code change is not complete merely because it compiles.

For normal changes, completion means:

- implementation is present;
- types are correct;
- relevant tests pass;
- lint/type-check pass when configured;
- secrets are not exposed;
- business rules remain YAML-driven;
- failure behavior is considered;
- logs remain useful and safe;
- documentation is updated when needed.

For scraper changes, additionally verify that:

- selectors are reasonably robust;
- extraction remains separate from evaluation;
- parsing failures are explicit;
- duplicate processing is avoided.

For Azure changes, additionally verify that:

- Managed Identity is preferred;
- least privilege is respected;
- production secrets are not introduced into configuration files.

---

## 31. Decision Philosophy

The system exists to reduce the number of deals a human must inspect, not to create false certainty.

Prefer:

```text
NEEDS_VERIFICATION
```

over guessing.

Prefer:

```text
UNKNOWN
```

over inventing a value.

Prefer an explicit rejection reason over a hidden score adjustment.

Prefer deterministic rules over LLM intuition.

Prefer preserving source evidence over overwriting it.

Prefer simple architecture over unnecessary infrastructure.

---

## 32. Current Development Priority

Initial implementation priority:

1. Stable Creative Listing authentication.
2. Reliable listing extraction.
3. Typed normalization.
4. YAML-driven deterministic rule evaluation.
5. Idempotent Azure persistence.
6. Run tracking and diagnostics.
7. Incremental daily execution.
8. Candidate summaries / notifications.
9. STR market-analysis enrichment.

Do not prematurely build downstream AI features before collection, normalization, rules, and persistence are reliable.

---

## 33. Canonical Azure Table Schema

The structured persistence layer uses seven Azure Tables:

```text
Listings
Evaluations
ListingReviews
Markets
MarketDailyStats
Runs
Errors
```

and Azure Blob Storage for large raw and diagnostic artifacts.

The following key strategies are the default design unless implementation testing identifies a concrete Azure Table limitation that requires adjustment.

### 33.1 `Listings`

Purpose:

Current known state of every listing observed by the system.

Recommended keys:

```text
PartitionKey: <STATE>#<CITY>
RowKey: <SourceListingId>
```

Example:

```text
PartitionKey: GA#AUGUSTA
RowKey: CL123456
```

Rationale:

- supports efficient market-level listing queries;
- keeps current listing records easy to locate;
- avoids duplicate rows across daily runs;
- works naturally with market-level reports.

If Creative Listing does not expose a stable listing ID, implement and document a conservative canonical ID strategy before production deployment.

Important:

`Listings` is the current-state table, not the historical audit log.

### 33.2 `Evaluations`

Purpose:

Immutable or append-oriented history of automated YAML-rule evaluations.

Recommended keys:

```text
PartitionKey: <SourceListingId>
RowKey: <EvaluationTimestamp>#<RulesVersion>
```

Example:

```text
PartitionKey: CL123456
RowKey: 20260909T143212.000Z#a84fd091
```

Requirements:

- preserve all meaningful historical evaluations;
- do not overwrite prior evaluation results;
- store `RulesVersion`;
- store structured rule-level results;
- store the relevant normalized financial snapshot used by the evaluation.

This allows the system to reconstruct why a listing changed from reject to pass or vice versa.

### 33.3 `ListingReviews`

Purpose:

Append-oriented human decision and deal lifecycle history.

Recommended keys:

```text
PartitionKey: <SourceListingId>
RowKey: <ReviewTimestamp>#<EventId>
```

Example:

```text
PartitionKey: CL123456
RowKey: 20260910T091500.000Z#01
```

Typical events:

```text
REVIEWING
REJECTED
OFFERED
OFFER_REJECTED
OFFER_ACCEPTED
UNDER_CONTRACT
LOST
NO_LONGER_AVAILABLE
PURCHASED
```

Do not overwrite historical review events.

If a fast current-status lookup is needed, mirror only the latest manual status into `Listings.CurrentManualStatus`.

### 33.4 `Markets`

Purpose:

Current market-level analysis.

Recommended keys:

```text
PartitionKey: <STATE>
RowKey: <CITY>
```

Example:

```text
PartitionKey: GA
RowKey: AUGUSTA
```

If multiple market definitions can exist for the same city, use a documented `MarketId` instead of assuming city boundaries are sufficient.

This is the latest-state market table.

Historical opportunity trends belong in `MarketDailyStats`.

### 33.5 `MarketDailyStats`

Purpose:

Daily market snapshots for trend reporting.

Recommended keys:

```text
PartitionKey: <STATE>#<CITY>
RowKey: <YYYY-MM-DD>
```

Example:

```text
PartitionKey: GA#AUGUSTA
RowKey: 2026-09-09
```

This supports efficient queries such as:

```text
Give me Augusta daily stats for the last 30 days.
```

and downstream comparisons across markets.

The system should calculate daily metrics from authoritative listing/evaluation data and store one final snapshot per market per day.

Daily writes should be idempotent.

Re-running the same day's aggregation should update the same row rather than create duplicate daily snapshots.

### 33.6 `Runs`

Purpose:

Operational execution history.

Recommended keys:

```text
PartitionKey: <YYYY-MM>
RowKey: <RunId>
```

Example:

```text
PartitionKey: 2026-09
RowKey: 20260909T060000.000Z
```

This keeps operational history naturally grouped by month while maintaining chronological identifiers.

`RunId` must be globally unique enough for the project's execution model.

### 33.7 `Errors`

Purpose:

Structured technical/debugging events.

Recommended keys:

```text
PartitionKey: <RunId>
RowKey: <OccurredAt>#<EventId>
```

Example:

```text
PartitionKey: 20260909T060000.000Z
RowKey: 20260909T060143.129Z#8f7c
```

Errors should reference Blob Storage artifacts when additional diagnostic material exists.

Do not store large diagnostic payloads directly in the table.

### 33.8 Blob Storage

Recommended logical paths:

```text
raw/
  YYYY/MM/DD/<listing-id>/<timestamp>.json

errors/
  YYYY/MM/DD/<run-id>/<artifact-name>

playwright/
  YYYY/MM/DD/<run-id>/<artifact-name>
```

Raw snapshots should be immutable when practical.

Diagnostic retention may be shorter than raw business-data retention.

Authenticated Playwright session state must be stored separately from normal raw/debug artifacts and treated as a credential.

### 33.9 Current state vs history

The design intentionally separates current state from history.

```text
Listings
  -> current listing state

Markets
  -> current market state

Evaluations
  -> automated decision history

ListingReviews
  -> human decision / deal lifecycle history

MarketDailyStats
  -> daily market trend history

Runs
  -> execution history

Errors
  -> technical failure history
```

Do not turn `Listings` into an event log.

Do not turn `Evaluations` into a current-state-only table.

Do not mix human actions into automated rule results.

### 33.10 Idempotency

Writes must be designed so that rerunning the same logical work does not create accidental duplicates.

Examples:

- a listing with the same canonical source ID updates its current `Listings` row;
- a daily market snapshot for the same market/date updates the same `MarketDailyStats` row;
- a new evaluation creates a new historical evaluation row only when a meaningful evaluation event occurs;
- a human action creates one deliberate review event;
- a retry of the same persistence operation should not create a second logical event.

Where necessary, use deterministic event IDs or operation IDs.

### 33.11 Versioning

Store version metadata where it affects interpretation.

At minimum:

```text
RulesVersion
AnalysisVersion
GitCommit
```

when applicable.

`RulesVersion` should preferably be a stable hash or explicit version associated with the exact YAML configuration used for evaluation.

This is required for historical reproducibility.

### 33.12 Reporting goals

The schema must support future reports including:

```text
Which markets produced the most qualifying deals in the last 7 / 30 / 90 days?

What percentage of listings pass the buy box in each market?

How many new qualifying deals appear per market per day?

Which markets repeatedly generate viable inventory?

Which listings changed from reject to pass after seller term changes?

How many qualified deals were manually reviewed?

How many received offers?

How many became unavailable before review?

What are our most common rejection reasons?

Are scraper failures or data-quality issues increasing?
```

If a future storage change materially improves these query patterns, update this section before changing production key strategy.
