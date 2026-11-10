// Mirrors the Postgres enums in supabase/migrations/20261110000000_init.sql.
export const CATEGORY_KINDS = ['expense', 'income', 'transfer', 'savings'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export const CONNECTION_STATUSES = ['pending', 'active', 'expired', 'error', 'revoked'] as const
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

export const TX_STATUSES = ['booked', 'pending'] as const
export type TxStatus = (typeof TX_STATUSES)[number]
