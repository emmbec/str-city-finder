import type { NormalizedListing, RawListingSnapshot } from "../models/index.js";

export interface ListingNormalizer {
  normalize(snapshot: RawListingSnapshot): NormalizedListing;
}
