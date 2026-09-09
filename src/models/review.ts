import type { IsoDateTime } from "./common.js";
import type { ManualStatus } from "./listing.js";

export interface ListingReview {
  eventId: string;
  listingId: string;
  reviewedAt: IsoDateTime;
  action: ManualStatus;
  reasonCode?: string;
  notes?: string;
  offerAmount?: number;
  offerDate?: IsoDateTime;
}
