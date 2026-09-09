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

export interface StrLegalityFacts {
  explicitStrProhibitionConfirmed?: boolean;
  strIsAllowed?: boolean;
  permitOrRegistrationRequired?: boolean;
  legalityIsUncertain?: boolean;
  propertySpecificVerificationRequired?: boolean;
  zoningSpecificVerificationRequired?: boolean;
  evidenceSourceTypes: string[];
}

export interface AttractionFacts {
  name: string;
  annualVisitors?: number;
  drivingDistanceMinutes?: number;
}

export interface DestinationCityFacts {
  cityItselfIsPrimaryAttraction?: boolean;
  annualVisitors?: number;
  evidenceOfSignificantTourismDemand?: boolean;
}

export interface MilitaryBaseFacts {
  name: string;
  drivingDistanceMinutes?: number;
}

export interface FeederCityFacts {
  city: string;
  metroAreaId?: string;
  metropolitanPopulation?: number;
  drivingTimeMinutes?: number;
  isSubjectPropertyMetro?: boolean;
}

export interface MarketScreeningFacts {
  attractions: AttractionFacts[];
  destinationCity?: DestinationCityFacts;
  militaryBases: MilitaryBaseFacts[];
  feederCities: FeederCityFacts[];
}

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
  city?: string;
  state?: string;
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
  strLegality?: StrLegalityFacts;
  marketScreening?: MarketScreeningFacts;
  sourcePostedAt?: IsoDateTime;
  sourceStatus: SourceListingStatus;
  confidence: Confidence;
  parsingIssues: ParsingIssue[];
  rawFields: Readonly<Record<string, unknown>>;
}

export interface Listing extends Omit<NormalizedListing, "city" | "state"> {
  city: string;
  state: string;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  currentFilterStatus: FilterStatus;
  currentManualStatus: ManualStatus;
  lastEvaluationAt?: IsoDateTime;
  rulesVersion?: string;
  contentHash: string;
  rawSnapshotBlobName?: string;
}
