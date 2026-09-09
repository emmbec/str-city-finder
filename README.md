# STR City Finder

STR City Finder is a TypeScript service for collecting Creative Listing deals, preserving source facts, applying deterministic YAML-based investment rules, and storing current state plus history in Azure. Phase 1 establishes the typed architecture, configuration boundary, rule-engine contracts, and persistence layer. Creative Listing browser automation is intentionally not implemented yet.

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
- `src/rules` defines rule contracts and deterministic result aggregation. Phase 1 does not implement the individual investment rules. If required enabled rules are not registered, evaluation fails closed.
- `src/azure` exposes testable abstractions and Azure SDK adapters for Key Vault secrets, Table Storage, and Blob Storage.
- `src/normalization`, `src/logging`, and `src/orchestration` define dependency boundaries without prematurely implementing the future pipeline.
- `src/scraper` is reserved for the future Creative Listing/Playwright implementation. No scraper is included in Phase 1.

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

## Phase 1 limitations

- Creative Listing authentication, extraction, normalization functions, change detection, and Playwright selectors are not implemented.
- The four YAML rule implementations (`str_legality`, `financing`, `market`, and `feeder_cities`) are not implemented. Only their validated configuration and execution contracts exist.
- Azure adapter integration tests against a live account or Azurite are not included; repository behavior is unit-tested through the storage abstraction.
- Infrastructure-as-code and Azure Container Apps Job deployment are future phases.
