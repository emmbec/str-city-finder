export type IsoDateTime = string;
export type IsoDate = string;

export interface MoneySnapshot {
  purchasePrice?: number;
  downPayment?: number;
  entryFee?: number;
  loanBalance?: number;
  interestRate?: number;
  monthlyPayment?: number;
  piti?: number;
  hoa?: number;
  currency: string;
}

export interface ParsingIssue {
  field: string;
  rawValue: unknown;
  code: string;
  message: string;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
