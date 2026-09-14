# STR City Finder

STR City Finder is a TypeScript service for collecting Creative Listing deals, preserving source facts, applying deterministic YAML-based investment rules, and storing current state plus history in Azure. Phase 3 adds Playwright/Chromium collection, reusable authentication state, defensive pagination, fixture-tested extraction, and orchestration into normalization and deterministic evaluation.

## Architecture

```text
config/buybox.yaml         authoritative investment rules
        |
        v
src/config/                strict runtime validation + content-derived rules version
        |
        v
src/rules/                 deterministic rule contracts and fail-closed orchestration
        |
        +--> src/models/   source facts, normalized facts, evaluations, reviews,
        |                  markets, runs, and errors
        |
        v
src/azure/                 Key Vault, Table Storage, Blob Storage, repositories
```

Responsibilities are deliberately separate:

- `src/models` contains strongly typed domain data. `RawListingSnapshot` preserves source fields, while `NormalizedListing` contains parsed facts and explicit parsing issues.
- `src/config` loads `config/buybox.yaml`, validates its exact structure with Zod, and derives `rulesVersion` from the declared version plus a SHA-256 content hash.
- `src/rules` implements source eligibility, STR legality, financing, market demand-driver, optional military-base, and feeder-city behavior directly from the validated YAML. If required enabled rules are not registered, evaluation fails closed.
- `src/azure` exposes testable abstractions and Azure SDK adapters for Key Vault secrets, Table Storage, and Blob Storage.
- `src/normalization`, `src/logging`, and `src/orchestration` keep parsing and deterministic evaluation outside the browser layer.
- `src/scraper` owns Creative Listing authentication, browser navigation, raw extraction, session-state stores, selectors, bounded retries, and sanitized browser diagnostics. It returns `RawListingSnapshot` values and has no evaluation, persistence, or market-research dependency.

## Creative Listing collection

The collector first opens the configured listings route with saved Playwright storage state. A session requires a rendered authenticated landmark with no public login/signup controls or error response; the pathname alone is never sufficient. Expired state causes a fresh browser context, a single credential-based login, and replacement of the saved state. CAPTCHA and one-time-code controls stop the run instead of being bypassed.

Credentials always come through `SecretProvider` via `KeyVaultCredentialProvider`. Production uses `DefaultAzureCredential` and therefore Managed Identity when deployed in Azure. Production storage state uses a separately configured private Blob container; the local command writes mode-0600 state beneath the ignored `.local/` directory. Storage state, passwords, and usernames are never logged.

Configured routes default to `/auth` and `/deals?view=list`. Live verification on September 11, 2026 confirmed that login redirects to `/dashboard` and its Listings link targets `/deals`; `/listings` renders a 404. Existing local environment overrides must be updated separately. Selectors are centralized in `src/scraper/selectors.ts`. Detail readiness recognizes the live `h2` Listing Highlights landmark. Extraction reads rendered sibling label/value pairs as well as supported semantic markup. It preserves value text, whitespace, and seller descriptions separately; conflicting structured occurrences are retained as arrays rather than silently choosing a value. See [the verification report](docs/creative-listing-live-verification.md).

Discovery reads `deal-<UUID>` card containers and constructs canonical `/deals/<UUID>` URLs, deduplicating by UUID. Anchors are not required, and `/deals/new` or other non-UUID routes cannot become listings. Pagination uses sorted UUID sets and stops on absent/disabled Next, repeated pages, no new UUIDs, or the configured page ceiling. A Next click is never retried blindly. `CREATIVE_LISTING_MAXIMUM_PAGES` is a safety ceiling, not an assumed page count.

Navigation, transient page errors, and temporary selector failures use bounded retries. Authentication and deterministic extraction errors are not blindly retried. Failures record a query-free current URL and a screenshot with every input, textarea, and editable region masked. Optional post-auth Playwright traces disable DOM snapshots and source capture, are ignored by Git, and must be stored privately.

Normalization supports currency and monthly-payment text, PITI, entry fee, down payment, purchase price, loan balance, HOA, interest rate, bedrooms, combined or separate full/half bathrooms, square footage, year built, property type, financing type, status, and core location text. The normalizer retains a copy of all raw fields and records structured issues instead of fabricating malformed or conflicting values. When an explicit monthly payment is absent, a successfully parsed PITI value supplies the monthly-payment fact because PITI is itself a monthly payment; an explicit monthly-payment value always takes precedence.

Deterministic evaluation covers the source status and financing-type constraints, cash-only exclusion, STR prohibition/evidence and verification states, down-payment and monthly-payment limits, attraction or destination-city demand, optional military-base proximity, and unique feeder-metro population/travel requirements. Thresholds and enabled behavior are always read from `config/buybox.yaml` at evaluation time.

HTTP 429 and standalone rate-limit error pages produce `RATE_LIMITED`, retaining `retryAfter` when available. The execution stops and its request guard blocks further requests; it does not log in again or retry through the limit. Skipped detail failures produce `INCOMPLETE_COLLECTION` at the end, even if other listings succeeded, so the local command cannot report a broken crawl as successful zero results.

Empty or effectively empty extraction produces `LOW` confidence and `INSUFFICIENT_EXTRACTED_DATA`. Explicit zero payments remain zero, undisclosed addresses remain unavailable after normalization, and lease-option terms stay in raw evidence without being reclassified as down payments or PITI. Fields outside the typed normalized model remain available in `rawFields`.

## Storage model

The repository layer exposes the seven canonical tables from `AGENTS.md`:

| Table | Behavior |
| --- | --- |
| `Listings` | Idempotent current listing state by market and source listing ID |
| `Evaluations` | Append-oriented deterministic evaluation history |
| `ListingReviews` | Append-oriented human review history |
| `Markets` | Current market analysis |
| `MarketDailyStats` | Idempotent market/date snapshots |
| `Runs` | Monthly-partitioned execution records |
| `Errors` | Append-oriented errors correlated by run |

Business logic never composes Azure keys. Azure Table Storage does not permit `#` in partition or row keys, so the physical implementation percent-encodes key components and uses `!` as its composite separator. This preserves the logical grouping in `AGENTS.md` while conforming to the Azure service constraint.

Blob Storage is the boundary for raw snapshots and large diagnostic artifacts. Authenticated browser state must be kept separately and treated as a credential when session support is implemented.

## Local development

Requirements:

- Node.js 22 or newer
- npm
- Azure developer credentials only when exercising live Azure adapters

Install and verify:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

For local browser runs, install the Playwright Chromium build once if it is not already present:

```bash
npm exec playwright install chromium
```

Copy `.env.example` to `.env` for local deployment configuration and replace placeholders locally. Never commit `.env` or real secrets. Investment rules must remain in `config/buybox.yaml`; environment variables are not a substitute for business rules.

The default credential chain is `DefaultAzureCredential`. In production, configure Managed Identity with least-privilege access to the required Key Vault secrets and private session-state Blob container. Relevant environment names are documented in `.env.example`.

Run a live local collection through normalization and deterministic evaluation:

```bash
npm run scrape:creative-listing
```

This command loads non-secret settings from `.env` when the file exists and requires `AZURE_KEY_VAULT_URL` plus the two configured secret names. Authenticate locally with a supported `DefaultAzureCredential` developer identity (for example Azure CLI credentials) that has read access to only those secrets. Set `CREATIVE_LISTING_HEADLESS=false` when visually verifying selectors. No Creative Listing credential belongs in `.env`; `.env.example` contains names and placeholders only.

Production `npm start` additionally requires `AZURE_BLOB_SERVICE_URL`, `CREATIVE_LISTING_SESSION_BLOB_CONTAINER`, and `CREATIVE_LISTING_SESSION_BLOB_NAME`. The session container must be private and separate from ordinary raw/diagnostic artifacts.

## Docker

The multi-stage Docker build uses a Playwright runtime image with Chromium dependencies and runs the application as the non-root `pwuser`:

```bash
docker build -t str-city-finder .
docker run --rm str-city-finder
```

No credentials are embedded in the image. Supply deployment configuration and Managed Identity at runtime.

## Current limitations

- Live verification is deliberately capped; a complete site crawl, every financing variation, and final-page termination have not been exercised live. See [the verification report](docs/creative-listing-live-verification.md) for verified cases and fixture coverage.
- Cross-run material-change detection and persistence of collection results remain separate from this Phase 3 collection pipeline. The production entry point currently collects, normalizes, evaluates, and logs structured outcomes; the scraper never saves directly to Azure.
- STR legality, attractions, destination demand, military-base proximity, and feeder-city population/travel facts must be supplied as evidence. The deterministic engine evaluates them but does not research or infer them.
- URL/ID deduplication occurs within a collection run. Notification settings do not alter evaluation outcomes.
- Azure adapter integration tests against a live account or Azurite are not included; repository behavior is unit-tested through the storage abstraction.
- Infrastructure-as-code and Azure Container Apps Job deployment are future phases.
