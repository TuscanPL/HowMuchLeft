// Pulls balances and transactions: daily from GitHub Actions (x-cron-secret) or
// when a member taps "Sync now". The logic lives in packages/edge.
import { createBankSyncHandler } from '../_shared/edge.js'

Deno.serve(
  createBankSyncHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    enableBankingAppId: Deno.env.get('ENABLE_BANKING_APP_ID') || undefined,
    enableBankingPrivateKey: Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') || undefined,
    cronSecret: Deno.env.get('CRON_SECRET') || undefined,
  }),
)
