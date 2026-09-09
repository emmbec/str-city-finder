import type { IsoDateTime } from "./common.js";

export type RunStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export interface RunRecord {
  runId: string;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime;
  status?: RunStatus;
  listingsFound: number;
  newListings: number;
  changedListings: number;
  evaluated: number;
  passed: number;
  rejected: number;
  needsVerification: number;
  promotedForMarketReview: number;
  marketsSeen: number;
  rulesVersion: string;
  gitCommit?: string;
  durationSeconds?: number;
}

export type ErrorSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type ErrorStage = "CONFIGURATION" | "AUTHENTICATION" | "NAVIGATION" | "EXTRACTION" | "NORMALIZATION" | "EVALUATION" | "PERSISTENCE" | "ORCHESTRATION";

export interface ErrorRecord {
  eventId: string;
  runId: string;
  listingId?: string;
  occurredAt: IsoDateTime;
  severity: ErrorSeverity;
  stage: ErrorStage;
  errorType: string;
  errorCode: string;
  message: string;
  page?: string;
  retryAttempt?: number;
  resolved: boolean;
  diagnosticArtifact?: string;
}
