import type {
  ErrorRecord,
  Listing,
  ListingEvaluation,
  ListingReview,
  Market,
  MarketDailyStats,
  RunRecord,
} from "../models/index.js";
import type { StoredTableEntity, TableStore } from "./tableStorage.js";

export const TABLE_NAMES = {
  listings: "Listings",
  evaluations: "Evaluations",
  listingReviews: "ListingReviews",
  markets: "Markets",
  marketDailyStats: "MarketDailyStats",
  runs: "Runs",
  errors: "Errors",
} as const;

export interface ListingsRepository {
  get(market: Pick<Listing, "state" | "city">, sourceListingId: string): Promise<Listing | undefined>;
  listByMarket(state: string, city: string): Promise<Listing[]>;
  upsert(listing: Listing): Promise<void>;
}

export interface EvaluationsRepository {
  append(evaluation: ListingEvaluation): Promise<void>;
  listForListing(listingId: string): Promise<ListingEvaluation[]>;
}

export interface ListingReviewsRepository {
  append(review: ListingReview): Promise<void>;
  listForListing(listingId: string): Promise<ListingReview[]>;
}

export interface MarketsRepository {
  get(state: string, city: string): Promise<Market | undefined>;
  upsert(market: Market): Promise<void>;
}

export interface MarketDailyStatsRepository {
  get(marketId: string, date: string): Promise<MarketDailyStats | undefined>;
  listForMarket(marketId: string): Promise<MarketDailyStats[]>;
  upsert(stats: MarketDailyStats): Promise<void>;
}

export interface RunsRepository {
  create(run: RunRecord): Promise<void>;
  update(run: RunRecord): Promise<void>;
  get(startedAt: string, runId: string): Promise<RunRecord | undefined>;
}

export interface ErrorsRepository {
  append(error: ErrorRecord): Promise<void>;
  listForRun(runId: string): Promise<ErrorRecord[]>;
}

// Azure Table keys reject '/', '\\', '#', and '?'. Components are encoded and
// joined with '!' so the repository retains the AGENTS.md logical grouping while
// keeping key composition out of business logic.
function keyPart(value: string): string {
  return encodeURIComponent(value.trim().toUpperCase()).replaceAll(".", "%2E");
}

function marketKey(state: string, city: string): string {
  return `${keyPart(state)}!${keyPart(city)}`;
}

function timestampKey(value: string): string {
  return value.replaceAll("-", "").replaceAll(":", "");
}

function monthKey(value: string): string {
  const match = /^(?<year>\d{4})-(?<month>\d{2})/.exec(value);
  const year = match?.groups?.year;
  const month = match?.groups?.month;
  if (year === undefined || month === undefined) throw new Error(`Expected an ISO timestamp, received '${value}'.`);
  return `${year}-${month}`;
}

abstract class JsonRepository<T> {
  protected constructor(
    protected readonly store: TableStore,
    protected readonly tableName: string,
  ) {}

  protected async getValue(partitionKey: string, rowKey: string): Promise<T | undefined> {
    const entity = await this.store.get(this.tableName, partitionKey, rowKey);
    return entity === undefined ? undefined : this.deserialize(entity);
  }

  protected async listValues(partitionKey: string): Promise<T[]> {
    return (await this.store.list(this.tableName, { partitionKey })).map((entity) => this.deserialize(entity));
  }

  protected async addValue(partitionKey: string, rowKey: string, value: T): Promise<void> {
    await this.store.add(this.tableName, this.serialize(partitionKey, rowKey, value));
  }

  protected async upsertValue(partitionKey: string, rowKey: string, value: T): Promise<void> {
    await this.store.upsert(this.tableName, this.serialize(partitionKey, rowKey, value));
  }

  private serialize(partitionKey: string, rowKey: string, value: T): StoredTableEntity {
    return { partitionKey, rowKey, payload: JSON.stringify(value), schemaVersion: 1 };
  }

  private deserialize(entity: StoredTableEntity): T {
    return JSON.parse(entity.payload) as T;
  }
}

export class AzureListingsRepository extends JsonRepository<Listing> implements ListingsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.listings); }
  public get(market: Pick<Listing, "state" | "city">, id: string): Promise<Listing | undefined> {
    return this.getValue(marketKey(market.state, market.city), keyPart(id));
  }
  public listByMarket(state: string, city: string): Promise<Listing[]> {
    return this.listValues(marketKey(state, city));
  }
  public upsert(value: Listing): Promise<void> {
    return this.upsertValue(marketKey(value.state, value.city), keyPart(value.sourceListingId), value);
  }
}

export class AzureEvaluationsRepository extends JsonRepository<ListingEvaluation> implements EvaluationsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.evaluations); }
  public append(value: ListingEvaluation): Promise<void> {
    return this.addValue(keyPart(value.listingId), `${timestampKey(value.evaluatedAt)}!${keyPart(value.rulesVersion)}!${keyPart(value.evaluationId)}`, value);
  }
  public listForListing(id: string): Promise<ListingEvaluation[]> { return this.listValues(keyPart(id)); }
}

export class AzureListingReviewsRepository extends JsonRepository<ListingReview> implements ListingReviewsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.listingReviews); }
  public append(value: ListingReview): Promise<void> {
    return this.addValue(keyPart(value.listingId), `${timestampKey(value.reviewedAt)}!${keyPart(value.eventId)}`, value);
  }
  public listForListing(id: string): Promise<ListingReview[]> { return this.listValues(keyPart(id)); }
}

export class AzureMarketsRepository extends JsonRepository<Market> implements MarketsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.markets); }
  public get(state: string, city: string): Promise<Market | undefined> { return this.getValue(keyPart(state), keyPart(city)); }
  public upsert(value: Market): Promise<void> { return this.upsertValue(keyPart(value.state), keyPart(value.city), value); }
}

export class AzureMarketDailyStatsRepository extends JsonRepository<MarketDailyStats> implements MarketDailyStatsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.marketDailyStats); }
  public get(id: string, date: string): Promise<MarketDailyStats | undefined> { return this.getValue(keyPart(id), date); }
  public listForMarket(id: string): Promise<MarketDailyStats[]> { return this.listValues(keyPart(id)); }
  public upsert(value: MarketDailyStats): Promise<void> { return this.upsertValue(keyPart(value.marketId), value.date, value); }
}

export class AzureRunsRepository extends JsonRepository<RunRecord> implements RunsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.runs); }
  public create(value: RunRecord): Promise<void> { return this.addValue(monthKey(value.startedAt), keyPart(value.runId), value); }
  public update(value: RunRecord): Promise<void> { return this.upsertValue(monthKey(value.startedAt), keyPart(value.runId), value); }
  public get(startedAt: string, id: string): Promise<RunRecord | undefined> { return this.getValue(monthKey(startedAt), keyPart(id)); }
}

export class AzureErrorsRepository extends JsonRepository<ErrorRecord> implements ErrorsRepository {
  public constructor(store: TableStore) { super(store, TABLE_NAMES.errors); }
  public append(value: ErrorRecord): Promise<void> {
    return this.addValue(keyPart(value.runId), `${timestampKey(value.occurredAt)}!${keyPart(value.eventId)}`, value);
  }
  public listForRun(id: string): Promise<ErrorRecord[]> { return this.listValues(keyPart(id)); }
}

export interface RepositorySet {
  listings: ListingsRepository;
  evaluations: EvaluationsRepository;
  listingReviews: ListingReviewsRepository;
  markets: MarketsRepository;
  marketDailyStats: MarketDailyStatsRepository;
  runs: RunsRepository;
  errors: ErrorsRepository;
}

export function createAzureRepositories(store: TableStore): RepositorySet {
  return {
    listings: new AzureListingsRepository(store),
    evaluations: new AzureEvaluationsRepository(store),
    listingReviews: new AzureListingReviewsRepository(store),
    markets: new AzureMarketsRepository(store),
    marketDailyStats: new AzureMarketDailyStatsRepository(store),
    runs: new AzureRunsRepository(store),
    errors: new AzureErrorsRepository(store),
  };
}

export async function ensureCanonicalTables(store: TableStore): Promise<void> {
  await Promise.all(Object.values(TABLE_NAMES).map((name) => store.createTableIfNotExists(name)));
}
