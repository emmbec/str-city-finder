import type { RawListingSnapshot } from "../models/index.js";

export interface ListingSource {
  collect(runId: string): AsyncIterable<RawListingSnapshot>;
}

// This is a Phase 1 boundary only. No Creative Listing selectors,
// authentication flow, or browser behavior is implemented here.
