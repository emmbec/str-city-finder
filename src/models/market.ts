import type { IsoDate, IsoDateTime } from "./common.js";

export type MarketBuyBoxStatus = "UNKNOWN" | "QUALIFIES" | "DOES_NOT_QUALIFY" | "NEEDS_REVIEW";

export interface Market {
  marketId: string;
  city: string;
  state: string;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  firstAnalyzedAt?: IsoDateTime;
  lastAnalyzedAt?: IsoDateTime;
  strBuyBoxStatus: MarketBuyBoxStatus;
  overallScore?: number;
  regulationStatus?: string;
  demandScore?: number;
  revenueScore?: number;
  competitionScore?: number;
  medianHomePrice?: number;
  expectedAdr?: number;
  expectedOccupancy?: number;
  expectedAnnualRevenue?: number;
  notes?: string;
  analysisVersion?: string;
}

export interface MarketDailyStats {
  date: IsoDate;
  marketId: string;
  city: string;
  state: string;
  listingsSeen: number;
  newListings: number;
  filterPassed: number;
  newFilterPassed: number;
  needsVerification: number;
  rejected: number;
  activeQualifiedListings: number;
  averagePurchasePrice?: number;
  averagePiti?: number;
  manuallyReviewed: number;
  offersMade: number;
}
