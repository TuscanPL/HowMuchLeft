// Lists banks, starts and finishes a bank connection (Enable Banking), and disconnects.
// The logic lives in packages/edge and is bundled into ../_shared/edge.js.
import { createBankHandler } from '../_shared/edge.js'

Deno.serve(
  createBankHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    enableBankingAppId: Deno.env.get('ENABLE_BANKING_APP_ID') || undefined,
    enableBankingPrivateKey: Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') || undefined,
    allowedRedirects: (Deno.env.get('APP_URLS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }),
)
