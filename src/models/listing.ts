import type { Confidence, IsoDateTime, MoneySnapshot, ParsingIssue } from "./common.js";

export type FinancingType = "SUBJECT_TO" | "SELLER_FINANCING" | "HYBRID" | "CASH" | "OTHER" | "UNKNOWN";
export type SourceListingStatus = "ACTIVE" | "INACTIVE" | "PENDING" | "SOLD" | "UNKNOWN";
export type FilterStatus = "NOT_EVALUATED" | "PASS" | "REJECT" | "NEEDS_VERIFICATION" | "NEEDS_MARKET_REVIEW" | "ERROR";
export type ManualStatus =
  | "NOT_REVIEWED"
  | "REVIEWING"
  | "REJECTED"
  | "OFFERED"
  | "OFFER_REJECTED"
  | "OFFER_ACCEPTED"
  | "UNDER_CONTRACT"
  | "LOST"
  | "NO_LONGER_AVAILABLE"
  | "PURCHASED";

export interface RawListingSnapshot {
  sourceListingId: string;
  sourceUrl: string;
  capturedAt: IsoDateTime;
  fields: Readonly<Record<string, unknown>>;
}

export interface NormalizedListing {
  sourceListingId: string;
  sourceUrl: string;
  address?: string;
  city: string;
  state: string;
  zipCode?: string;
  propertyType?: string;
  beds?: number;
  fullBaths?: number;
  halfBaths?: number;
  squareFeet?: number;
  yearBuilt?: number;
  financingType: FinancingType;
  occupancyStatus?: string;
  description?: string;
  financials: MoneySnapshot;
  sourcePostedAt?: IsoDateTime;
  sourceStatus: SourceListingStatus;
  confidence: Confidence;
  parsingIssues: ParsingIssue[];
}

export interface Listing extends NormalizedListing {
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  currentFilterStatus: FilterStatus;
  currentManualStatus: ManualStatus;
  lastEvaluationAt?: IsoDateTime;
  rulesVersion?: string;
  contentHash: string;
  rawSnapshotBlobName?: string;
}
