// What the web app and the `bank` / `bank-sync` edge functions send each other.

export interface Aspsp {
  name: string
  country: string
  logo?: string
  /** Longest consent the bank gives, in seconds. */
  maximum_consent_validity?: number
}

export type BankRequest =
  | { action: 'aspsps'; country?: string }
  | {
      action: 'start'
      householdId: string
      aspsp: { name: string; country: string }
      redirectUrl: string
    }
  | { action: 'complete'; code: string; state: string }
  | { action: 'disconnect'; connectionId: string }

export interface StartResponse {
  url: string
  connectionId: string
}

export interface CompleteResponse {
  connectionId: string
  accounts: number
}

export interface SyncSummary {
  connections: number
  accounts: number
  inserted: number
  updated: number
  errors: { connectionId: string; message: string }[]
}
