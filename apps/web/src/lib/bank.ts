import type { Aspsp, BankRequest, CompleteResponse, StartResponse, SyncSummary } from '@hml/shared'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: body as object })
  if (error) {
    // Show the function's own message ("Bank sync is not set up…") rather than a generic one.
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      if (payload?.error) throw new Error(payload.error)
    }
    throw error
  }
  return data as T
}

export const bankApi = {
  aspsps: (country = 'PL') =>
    invoke<{ aspsps: Aspsp[] }>('bank', { action: 'aspsps', country } satisfies BankRequest).then(
      (r) => r.aspsps,
    ),
  start: (req: Omit<Extract<BankRequest, { action: 'start' }>, 'action'>) =>
    invoke<StartResponse>('bank', { action: 'start', ...req }),
  complete: (code: string, state: string) =>
    invoke<CompleteResponse>('bank', { action: 'complete', code, state }),
  disconnect: (connectionId: string) =>
    invoke<{ ok: true }>('bank', { action: 'disconnect', connectionId }),
  sync: (householdId: string) => invoke<SyncSummary>('bank-sync', { householdId }),
}

/** The banks we use, shown first in the picker. */
export const FAVOURITE_BANKS = [/millennium/i, /\bING\b/i]
