# Creative Listing verification history

## Current outcome ? September 14, 2026

The resumed implementation passed a capped live collection: two listing pages, three cards per page, six unique detail pages, and six populated raw/normalized results. No production Azure Table records were written. Investment rules and the scraper/normalization/evaluation boundaries remain unchanged.

### What was already implemented

- Discovery from `deal-<UUID>` containers, strict UUID validation, canonical `/deals/<UUID>` URLs, UUID deduplication, and `/deals/new` exclusion.
- Rendered sibling label/value extraction and preservation of source values and seller prose; conflicting structured occurrences remain arrays instead of being reconciled.
- Authentication based on rendered landmarks, with public forms, 404/error pages, and rate-limit responses rejected.
- `RATE_LIMITED` detection, `retryAfter` capture, a guard that blocks further requests for the execution, and no login/retry through a rate limit.
- `LOW` normalization confidence and `INSUFFICIENT_EXTRACTED_DATA` for empty or effectively empty extraction.
- Pagination signatures based on sorted UUID sets, plus absent/disabled Next, repeated-page, no-new-UUID, and page-ceiling termination.
- Fixtures for PITI, missing financing, 2.5 bathrooms, lease options, zero payments, conflicting notes, undisclosed addresses, empty extraction, invalid routes, 404, and rate limits.

### Remaining gaps finished in the resumed work

1. The detail-ready selector required `h3`, while the live Listing Highlights landmark is `h2`. This caused every detail to be skipped even though the extractor itself worked. Added `h2` support and a full-source integration test using that actual layout.
2. Location text extraction only accepted paragraph elements. Added support for the same exact city/state/ZIP text in rendered spans and divs, still outside seller descriptions; the existing normalizer performs the parsing.
3. Skipped detail errors could end as a successful zero-result collection. The collector now continues past individual malformed details but ends with `INCOMPLETE_COLLECTION` and a failed-listing count. Tests cover both all-failed and mixed-success collections. Detail logs preserve the specific source-page error code.
4. Completed the missing bounded live verification and updated documentation. The existing two-browser session integration test now has a 15-second timeout instead of five seconds; its assertions are unchanged.

### Limited live result

Run: `limited-live-2026-09-14`, completed at `2026-09-14T18:57:37.670Z`. Listings URL: `/deals?status=active&view=list&page=1&limit=3`, then Next to page 2. The page ceiling prevented a page-3 request. The first-party rate-limit guard remained enabled.

| UUID | Market / financing | Example observed raw values | Normalized example |
| --- | --- | --- | --- |
| `ec77d86e-5a9c-4712-8745-3cc162f90377` | Detroit, MI / Cash | Price `$105,000`; sqft `1,904` | purchasePrice 105000; squareFeet 1904 |
| `a0e5dad6-c9c7-4a62-bc00-5cc601a18003` | Columbus, GA / Cash | Price `$98,000`; bedrooms `3` | purchasePrice 98000; beds 3 |
| `3d55337d-01d0-4f86-a584-d626633ee51f` | Glendale, AZ / Cash | Price `$312,000`; bathrooms `3` | purchasePrice 312000; fullBaths 3 |
| `b8257923-6175-4ff0-8ec8-1123de99f384` | Midland, MD / Cash | Price `$99,900`; sqft `1,804` | purchasePrice 99900; squareFeet 1804 |
| `1bf32d61-59f5-479e-b1ed-4ebdf2ce4130` | Linwood, KS / Subject-To | PITI and Monthly Payment `$3,488.38`; loan balance `$470,000.00`; interest `4.6%` | piti/monthlyPayment 3488.38; loanBalance 470000; interestRate 4.6 |
| `4b9301b6-0cfc-4581-8610-6774bdb5c367` | Cape Coral, FL / Seller Financing | Monthly Payment `$2,400`; Down Payment `$36,500` | monthlyPayment 2400; downPayment 36500 |

All six had populated property/location fields, 28?44 raw keys, preserved raw descriptions, and no parsing issues. Cash listings retained absent financing values as missing. The seller-financing listing retained absent PITI as missing. All six had usable property/financial values and therefore HIGH normalization confidence; this describes parsing confidence, not investment suitability.

Both pages contained three distinct UUIDs; the collected set contained six UUIDs without duplicates. A duplicate-card placement is also covered by a fixture, and cross-page duplicates are covered by the source integration test. The live sample did not contain a naturally duplicated card.

Session validation logged `session_reused`; the verification credential provider recorded zero credential reads and did not perform a login. No CAPTCHA, MFA, or rate limit appeared in this capped run. Rate-limit behavior was exercised by fixtures using the previously observed response (including `retryAfter: 300`), not by deliberately exhausting the live limit.

### Remaining unverified cases

No full-site crawl or final-page live request was made. Final-page disabled/absent Next, repeated/no-new UUID pages, fresh-login/session refresh, 404, rate limits, empty extraction, and mixed detail failures are fixture-tested. Lease-option, zero-payment, 2.5-bath, and conflicting-evidence cases are fixture-tested but were not among the six newest live listings on this resumed pass. The original September 11 observations below provide earlier live evidence of those data shapes. Docker execution and Azure persistence were outside this scraper-only pass.

### Final validation ? September 14, 2026

`npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test` (86 tests across eight files), `npm.cmd run build`, and `git diff --check` all passed with exit code 0 after the resumed fixes.

## Initial verification ? September 11, 2026

The sections below preserve the initial failure findings and describe the implementation as it existed before the authorized fixes above.

Outcome: verification failed. The website was authenticated successfully, but the current scraper does not collect its live listing data correctly. No Azure Table records were written. Investment rules and architecture were unchanged.

## Confirmed routes and authentication

- Login: `https://www.creativelisting.com/auth`, with `#signin-email`, `#signin-password`, and the `Sign In` button.
- Successful credential login through the existing Key Vault provider redirected to `/dashboard`, displaying `Creative Listing Dashboard` and authenticated navigation.
- The authenticated Listings link targets `/deals`. List view was inspected at `/deals?status=active&view=list&page=1&limit=9`.
- `/listings` displays `404 Page Not Found` with public Login and Sign up links. It is not the listings route.
- Cards have stable container IDs of the form `deal-<UUID>`. Clicking their heading opens a new tab at `/deals/<UUID>`; cards are not anchor links.
- A private local Playwright state file was established through `FileSessionStateStore`. Subsequent independent browser contexts opened authenticated listings and details using that state without reading credentials or logging in again.
- No CAPTCHA or MFA appeared during successful login and listing inspection.
- The existing command was run repeatedly, including with corrected route overrides. It failed in discovery. Its `session_reused` log alone is not proof of authentication: `isAuthenticated` accepts the configured pathname even on a 404 or rate-limit response.

## Live sample and extraction comparison

The existing `extractRawListing` function was called on six rendered detail pages. Each produced the correct UUID and source URL, but `fields: {}`. Calling the existing normalizer on the five follow-up samples produced no property values and financials containing only the configured currency. Missing values were not fabricated, but present values were lost too. The normalizer also reported `HIGH` confidence and zero parsing issues for the empty input; this is not evidence of successful extraction.

| Listing UUID | Displayed source evidence |
| --- | --- |
| `0a9d8823-2688-4b4e-ba8e-212c0aa2689f` | Tracy: PITI and Monthly Payment `$5,741.10`; price `$695,000`; down payment `$0`; loan balance `$678,846.31`; interest `6.625%`; HOA `$98/month`; beds 4, baths 3, sqft 2,075, year 2022. Parking and lot size labels absent. |
| `75deb8df-bb0d-48aa-90ff-d6fb234c459f` | Manhattan cash listing: price `$5,400,000`; beds 8, baths 9, sqft 4,200, year 1899. No PITI, monthly payment, loan balance, rate, down payment, or HOA labels. |
| `4f7d991f-c989-4132-ac3f-a517f81c9627` | San Tan Valley Subject-To: PITI/payment `$2,256.21`; down payment `$35,000`; loan balance `$379,024.69`; displayed interest `6.75%`. Seller notes state a different current interest rate and a future payment reduction. These must remain separate source evidence, not silently reconciled. Baths 2.5. |
| `0ff44b22-5a5b-4351-a90f-d625b1e9c915` | Fort Worth lease option: address undisclosed; Option Fee `$39,500`; Option Sale Price `$355,500`; Option Term `2 Years`; Monthly Lease Payment `$2,800/month`; sidebar Monthly Payment `$2,800`. No PITI. |
| `8693c411-94d5-4332-a994-b66c82d9068d` | Statesville: address undisclosed; generic Creative Listing heading and traditional financing options, without specific creative loan terms. Down Payment and Monthly Payment explicitly `$0`. HOA amount absent despite seller notes mentioning low dues. |
| `d5c08517-ba29-4cf3-a028-2c3376f0518d` | Gerrardstown cash listing: address undisclosed; price `$139,000`; no payment/PITI or loan terms. Displayed sqft 982 conflicts with seller description's approximate 992 sqft. |

Observed labels include Bedrooms, Bathrooms, sqft, Lot Size, Price/SqFt, Property Type, Year Built, Parking, HOA Monthly Fee, Loan Type, Interest Rate (%), Loan Balance ($), Loan Maturity Date, PITI (Principal, Interest, Taxes, Insurance), About this Listing, Price, Earnest Money Deposit (EMD), Down Payment, Monthly Payment, Expected Close of Escrow, and Listed on, plus the lease-option labels above. Labels absent from these samples cannot be claimed verified across the site. No canonical property or financial field was successfully extracted by the current implementation.

## Pagination and deduplication

- The site showed 1,213 listings, nine per page, and 135 pages at inspection time.
- Two visible plain-text `Next` buttons were present, without ARIA labels or `rel=next`. Previous was disabled on page 1.
- Clicking Next changed the URL to page 2 and produced nine distinct UUIDs, all different from page 1. No loop occurred in this transition.
- Existing `discoverListingUrls` returned only `/deals/new`, deduplicating the two Create New Listing links but incorrectly treating that route as a listing. It returned none of the nine actual card URLs. Real-card URL deduplication therefore remains unverified.
- The existing page signature strips the query string and depends on discovered URLs. Without real card discovery, it cannot reliably detect page changes.
- Final-page requests encountered a site response: `Rate limit exceeded. Please slow down.`, with `retryAfter: 300`. Live requests stopped once this response was identified. Final-page Next disabling and full-run termination were not verified.

## Scoped corrections and remaining work

Updated only route defaults, centralized selectors/label aliases, example route configuration, and documentation. Corrections cover `/auth`, `/deals?view=list`, stable login IDs, the authenticated dashboard link, text-based Next, Listed on, the expanded PITI label, HOA Monthly Fee, and About this Listing.

The existing listing-container guard was retained: merely recognizing the live containers without teaching discovery how to obtain their URLs would risk reporting zero listings as a successful collection. No DOM mutation or synthetic anchor injection was used to conceal this incompatibility.

Completing the fix requires authorization to modify scraper implementation beyond configuration/selectors: discover clickable cards using their stable IDs and confirmed route, exclude non-listing routes, read the observed detail structure, wait for rendered authentication controls/landmarks, and reject HTTP/error pages as authentication evidence. Relevant fixture tests should cover these observed structures, conflicting source evidence, and false-success cases. Business rules must remain outside Playwright.

Local prerequisites were resolved by installing the repository's Playwright Chromium build. Existing `.env` route overrides should use the confirmed routes. Credentials remain in Key Vault and session state remains in ignored local storage. The command has no Azure Table persistence step.

## Local validation after corrections

`npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test` (58 tests across eight files), and `npm.cmd run build` all passed. `git diff --check` found no whitespace errors. These checks validate the scoped changes and existing fixtures, not successful live collection.
