# STR City Finder

STR City Finder is a TypeScript service for collecting Creative Listing deals, preserving source facts, applying deterministic YAML-based investment rules, and storing current state plus history in Azure. Phases 1 and 2 establish the typed architecture, raw-preserving normalization, YAML-driven deterministic rules, and persistence boundaries. Creative Listing browser automation is intentionally not implemented yet.

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
- `src/normalization`, `src/logging`, and `src/orchestration` define dependency boundaries without prematurely implementing the future pipeline.
- `src/scraper` is reserved for the future Creative Listing/Playwright implementation. No scraper is included yet.

Normalization supports currency and monthly-payment text, PITI, entry fee, down payment, purchase price, loan balance, HOA, interest rate, bedrooms, combined or separate full/half bathrooms, square footage, year built, property type, financing type, status, and core location text. The normalizer retains a copy of all raw fields and records structured issues instead of fabricating malformed or conflicting values. When an explicit monthly payment is absent, a successfully parsed PITI value supplies the monthly-payment fact because PITI is itself a monthly payment; an explicit monthly-payment value always takes precedence.

Deterministic evaluation covers the source status and financing-type constraints, cash-only exclusion, STR prohibition/evidence and verification states, down-payment and monthly-payment limits, attraction or destination-city demand, optional military-base proximity, and unique feeder-metro population/travel requirements. Thresholds and enabled behavior are always read from `config/buybox.yaml` at evaluation time.

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

Copy `.env.example` to `.env` for local deployment configuration and replace placeholders locally. Never commit `.env` or real secrets. Investment rules must remain in `config/buybox.yaml`; environment variables are not a substitute for business rules.

The default credential chain is `DefaultAzureCredential`. In production, configure Managed Identity with least-privilege access to the required Key Vault secrets and Storage resources. Relevant environment names are documented in `.env.example`; Phase 1 does not instantiate production services from those values yet.

To verify configuration loading without scraping:

```bash
npm run build
npm start
```

Startup logs only configuration metadata and the derived rules version. It never prints YAML contents or secrets.

## Docker

The multi-stage Docker build uses a Playwright runtime image with Chromium dependencies and runs the application as the non-root `pwuser`:

```bash
docker build -t str-city-finder .
docker run --rm str-city-finder
```

No credentials are embedded in the image. Supply deployment configuration and Managed Identity at runtime.

## Current limitations

- Creative Listing authentication, browser extraction, change detection, and Playwright selectors are not implemented.
- Browser extraction is not implemented. Normalization currently consumes canonical raw field names supplied through `RawListingSnapshot`.
- STR legality, attractions, destination demand, military-base proximity, and feeder-city population/travel facts must be supplied as evidence. The deterministic engine evaluates them but does not research or infer them.
- Deduplication state-file behavior is deferred with scraper/orchestration work; notification settings control future output behavior and do not alter evaluation outcomes.
- Azure adapter integration tests against a live account or Azurite are not included; repository behavior is unit-tested through the storage abstraction.
- Infrastructure-as-code and Azure Container Apps Job deployment are future phases.
