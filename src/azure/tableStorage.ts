import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { TableClient, type TableEntity } from "@azure/data-tables";

export interface StoredTableEntity {
  partitionKey: string;
  rowKey: string;
  payload: string;
  schemaVersion: number;
}

export interface TableQuery {
  partitionKey?: string;
}

export interface TableStore {
  createTableIfNotExists(tableName: string): Promise<void>;
  get(tableName: string, partitionKey: string, rowKey: string): Promise<StoredTableEntity | undefined>;
  add(tableName: string, entity: StoredTableEntity): Promise<void>;
  upsert(tableName: string, entity: StoredTableEntity): Promise<void>;
  list(tableName: string, query?: TableQuery): Promise<StoredTableEntity[]>;
}

interface RestErrorLike {
  statusCode?: number;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as RestErrorLike).statusCode === 404;
}

export class AzureTableStore implements TableStore {
  public constructor(
    private readonly endpoint: string,
    private readonly credential: TokenCredential = new DefaultAzureCredential(),
  ) {}

  private client(tableName: string): TableClient {
    return new TableClient(this.endpoint, tableName, this.credential);
  }

  public async createTableIfNotExists(tableName: string): Promise<void> {
    await this.client(tableName).createTable();
  }

  public async get(tableName: string, partitionKey: string, rowKey: string): Promise<StoredTableEntity | undefined> {
    try {
      const entity = await this.client(tableName).getEntity<StoredTableEntity>(partitionKey, rowKey);
      return {
        partitionKey: entity.partitionKey,
        rowKey: entity.rowKey,
        payload: entity.payload,
        schemaVersion: entity.schemaVersion,
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  public async add(tableName: string, entity: StoredTableEntity): Promise<void> {
    await this.client(tableName).createEntity(entity as TableEntity<StoredTableEntity>);
  }

  public async upsert(tableName: string, entity: StoredTableEntity): Promise<void> {
    await this.client(tableName).upsertEntity(entity as TableEntity<StoredTableEntity>, "Replace");
  }

  public async list(tableName: string, query: TableQuery = {}): Promise<StoredTableEntity[]> {
    const filter = query.partitionKey === undefined
      ? undefined
      : `PartitionKey eq '${query.partitionKey.replaceAll("'", "''")}'`;
    const entities: StoredTableEntity[] = [];
    for await (const entity of this.client(tableName).listEntities<StoredTableEntity>({ queryOptions: { filter } })) {
      entities.push({
        partitionKey: entity.partitionKey,
        rowKey: entity.rowKey,
        payload: entity.payload,
        schemaVersion: entity.schemaVersion,
      });
    }
    return entities;
  }
}
