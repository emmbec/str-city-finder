import { beforeEach, describe, expect, it } from "vitest";
import { createAzureRepositories, ensureCanonicalTables, TABLE_NAMES, type RepositorySet } from "../../src/azure/repositories.js";
import type { Listing, ListingEvaluation, MarketDailyStats } from "../../src/models/index.js";
import { InMemoryTableStore } from "../helpers/inMemoryTableStore.js";

const listing: Listing = {
  sourceListingId: "CL#123",
  sourceUrl: "https://example.test/listing/123",
  city: "St. Louis",
  state: "MO",
  financingType: "SELLER_FINANCING",
  financials: { currency: "USD", purchasePrice: 250_000 },
  sourceStatus: "ACTIVE",
  confidence: "HIGH",
  parsingIssues: [],
  rawFields: {},
  firstSeenAt: "2026-09-09T10:00:00.000Z",
  lastSeenAt: "2026-09-09T10:00:00.000Z",
  currentFilterStatus: "NOT_EVALUATED",
  currentManualStatus: "NOT_REVIEWED",
  contentHash: "abc123",
};

describe("Azure repositories", () => {
  let repositories: RepositorySet;
  let store: InMemoryTableStore;

  beforeEach(async () => {
    store = new InMemoryTableStore();
    await ensureCanonicalTables(store);
    repositories = createAzureRepositories(store);
  });

  it("creates exactly the seven canonical tables", async () => {
    expect(Object.values(TABLE_NAMES)).toHaveLength(7);
    await expect(Promise.all(Object.values(TABLE_NAMES).map((name) => store.list(name)))).resolves.toHaveLength(7);
  });

  it("upserts current listing state idempotently and isolates key composition", async () => {
    await repositories.listings.upsert(listing);
    await repositories.listings.upsert({ ...listing, lastSeenAt: "2026-09-10T10:00:00.000Z" });

    const found = await repositories.listings.listByMarket("MO", "St. Louis");
    expect(found).toHaveLength(1);
    expect(found[0]?.lastSeenAt).toBe("2026-09-10T10:00:00.000Z");
  });

  it("keeps evaluations append-oriented", async () => {
    const evaluation: ListingEvaluation = {
      evaluationId: "eval-1",
      listingId: listing.sourceListingId,
      evaluatedAt: "2026-09-09T11:00:00.000Z",
      rulesVersion: "1.2-abcdef123456",
      finalStatus: "REJECT",
      results: [],
      relevantFinancialSnapshot: listing.financials,
    };
    await repositories.evaluations.append(evaluation);
    await expect(repositories.evaluations.append(evaluation)).rejects.toThrow("EntityAlreadyExists");
    await repositories.evaluations.append({ ...evaluation, evaluationId: "eval-2", evaluatedAt: "2026-09-10T11:00:00.000Z" });

    expect(await repositories.evaluations.listForListing(listing.sourceListingId)).toHaveLength(2);
  });

  it("updates the same daily market snapshot on rerun", async () => {
    const stats: MarketDailyStats = {
      date: "2026-09-09", marketId: "MO#ST. LOUIS", city: "St. Louis", state: "MO",
      listingsSeen: 5, newListings: 2, filterPassed: 1, newFilterPassed: 1,
      needsVerification: 0, rejected: 4, activeQualifiedListings: 1,
      manuallyReviewed: 0, offersMade: 0,
    };
    await repositories.marketDailyStats.upsert(stats);
    await repositories.marketDailyStats.upsert({ ...stats, listingsSeen: 6 });

    expect(await repositories.marketDailyStats.listForMarket(stats.marketId)).toEqual([{ ...stats, listingsSeen: 6 }]);
  });
});
