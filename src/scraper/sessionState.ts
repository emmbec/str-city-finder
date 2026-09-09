import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserContext, BrowserContextOptions } from "playwright";
import type { BlobArtifactStore } from "../azure/index.js";

export type BrowserStorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

export interface SessionStateStore {
  load(): Promise<BrowserStorageState | undefined>;
  save(state: BrowserStorageState): Promise<void>;
}

export class FileSessionStateStore implements SessionStateStore {
  public constructor(private readonly path: string) {}

  public async load(): Promise<BrowserStorageState | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as BrowserStorageState;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw new Error("Unable to read the configured Creative Listing session state.", { cause: error });
    }
  }

  public async save(state: BrowserStorageState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") await chmod(this.path, 0o600);
  }
}

export class BlobSessionStateStore implements SessionStateStore {
  public constructor(
    private readonly blobs: BlobArtifactStore,
    private readonly blobName: string,
  ) {}

  public async load(): Promise<BrowserStorageState | undefined> {
    const value = await this.blobs.get(this.blobName);
    return value === undefined ? undefined : JSON.parse(Buffer.from(value).toString("utf8")) as BrowserStorageState;
  }

  public async save(state: BrowserStorageState): Promise<void> {
    await this.blobs.put(this.blobName, JSON.stringify(state), "application/json");
  }
}

export async function captureStorageState(context: BrowserContext): Promise<BrowserStorageState> {
  return context.storageState();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
