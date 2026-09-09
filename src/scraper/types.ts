import type { RawListingSnapshot } from "../models/index.js";

export interface ListingSource {
  collect(runId: string): AsyncIterable<RawListingSnapshot>;
}

export interface CreativeListingCredentials {
  username: string;
  password: string;
}

export interface CredentialProvider {
  getCredentials(): Promise<CreativeListingCredentials>;
}
