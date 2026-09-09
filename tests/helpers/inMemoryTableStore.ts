import type { StoredTableEntity, TableQuery, TableStore } from "../../src/azure/tableStorage.js";

export class InMemoryTableStore implements TableStore {
  private readonly tables = new Map<string, Map<string, StoredTableEntity>>();

  public async createTableIfNotExists(tableName: string): Promise<void> {
    if (!this.tables.has(tableName)) this.tables.set(tableName, new Map());
  }

  public async get(tableName: string, partitionKey: string, rowKey: string): Promise<StoredTableEntity | undefined> {
    return this.tables.get(tableName)?.get(this.key(partitionKey, rowKey));
  }

  public async add(tableName: string, entity: StoredTableEntity): Promise<void> {
    const table = this.getTable(tableName);
    const key = this.key(entity.partitionKey, entity.rowKey);
    if (table.has(key)) throw new Error("EntityAlreadyExists");
    table.set(key, structuredClone(entity));
  }

  public async upsert(tableName: string, entity: StoredTableEntity): Promise<void> {
    this.getTable(tableName).set(this.key(entity.partitionKey, entity.rowKey), structuredClone(entity));
  }

  public async list(tableName: string, query: TableQuery = {}): Promise<StoredTableEntity[]> {
    return [...this.getTable(tableName).values()]
      .filter((entity) => query.partitionKey === undefined || entity.partitionKey === query.partitionKey)
      .map((entity) => structuredClone(entity));
  }

  private getTable(tableName: string): Map<string, StoredTableEntity> {
    const table = this.tables.get(tableName);
    if (table === undefined) throw new Error(`Table '${tableName}' does not exist.`);
    return table;
  }

  private key(partitionKey: string, rowKey: string): string {
    return `${partitionKey}\u0000${rowKey}`;
  }
}
