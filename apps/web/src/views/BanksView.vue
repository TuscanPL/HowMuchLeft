<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Aspsp } from '@hml/shared'
import { useHouseholdStore, type Account, type Connection } from '@/stores/household'
import { bankApi, FAVOURITE_BANKS } from '@/lib/bank'
import { bankRedirectUrl } from '@/lib/supabase'
import { money } from '@/lib/format'
import BottomSheet from '@/components/BottomSheet.vue'

const { t, d } = useI18n()
const household = useHouseholdStore()

const syncing = ref(false)
const syncResult = ref<string | null>(null)
const error = ref<string | null>(null)

const picking = ref(false)
const banks = ref<Aspsp[]>([])
const bankSearch = ref('')
const loadingBanks = ref(false)
const starting = ref<string | null>(null)
const editingAccount = ref<Account | null>(null)
const accountName = ref('')

const visibleConnections = computed(() =>
  household.connections.filter((c) => c.status !== 'revoked' && c.status !== 'pending'),
)
function accountsOf(c: Connection | null) {
  return household.accounts.filter((a) => (c ? a.connection_id === c.id : !a.connection_id))
}
/** Accounts whose bank connection is gone keep their history; list them with the manual ones. */
const otherAccounts = computed(() =>
  household.accounts.filter(
    (a) => !a.connection_id || !visibleConnections.value.some((c) => c.id === a.connection_id),
  ),
)
const totalBalance = computed(() =>
  household.accounts
    .filter((a) => a.include_in_pocket && a.balance != null)
    .reduce((s, a) => s + (a.balance ?? 0), 0),
)

const sortedBanks = computed(() => {
  const q = bankSearch.value.trim().toLowerCase()
  const list = banks.value.filter((b) => !q || b.name.toLowerCase().includes(q))
  const fav = (b: Aspsp) => (FAVOURITE_BANKS.some((re) => re.test(b.name)) ? 0 : 1)
  return [...list].sort((a, b) => fav(a) - fav(b) || a.name.localeCompare(b.name, 'pl'))
})

async function openPicker() {
  picking.value = true
  error.value = null
  if (banks.value.length) return
  loadingBanks.value = true
  try {
    banks.value = await bankApi.aspsps('PL')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loadingBanks.value = false
  }
}

async function connect(bank: { name: string; country: string }) {
  starting.value = bank.name
  error.value = null
  try {
    const { url } = await bankApi.start({
      householdId: household.household!.id,
      aspsp: { name: bank.name, country: bank.country },
      redirectUrl: bankRedirectUrl(),
    })
    // Off to the bank's own sign-in; it sends us back to bank-callback.html.
    window.location.href = url
  } catch (e) {
    error.value = (e as Error).message
    starting.value = null
  }
}

async function syncNow() {
  syncing.value = true
  syncResult.value = null
  error.value = null
  try {
    const r = await bankApi.sync(household.household!.id)
    syncResult.value = t('banks.synced', { n: r.inserted }, r.inserted)
    if (r.errors.length) error.value = r.errors.map((e) => e.message).join('; ')
    await Promise.all([
      household.loadConnections(),
      household.loadTable('accounts'),
      household.loadTransactions(household.loadedFrom ?? undefined),
    ])
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    syncing.value = false
  }
}

async function disconnect(c: Connection) {
  if (!confirm(t('banks.disconnectConfirm', { name: c.aspsp_name }))) return
  try {
    await bankApi.disconnect(c.id)
    await household.loadConnections()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function editAccount(a: Account) {
  editingAccount.value = a
  accountName.value = a.name
}

async function saveAccount() {
  if (!editingAccount.value) return
  await household.updateAccount(editingAccount.value.id, { name: accountName.value.trim() })
  editingAccount.value = null
}

async function removeAccount() {
  const a = editingAccount.value
  if (!a || !confirm(t('banks.deleteAccountConfirm', { name: a.name }))) return
  await household.remove('accounts', a.id)
  await household.loadTransactions(household.loadedFrom ?? undefined)
  editingAccount.value = null
}

function ownerName(a: Account) {
  return household.members.find((m) => m.user_id === a.owner_id)?.profile?.display_name
}

function daysLeft(c: Connection) {
  return c.valid_until
    ? Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86_400_000)
    : null
}
</script>

<template>
  <main class="px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('banks.title') }}</h1>
      <button
        v-if="visibleConnections.length"
        type="button"
        class="btn-secondary py-1.5"
        :disabled="syncing"
        data-testid="sync-now"
        @click="syncNow"
      >
        {{ syncing ? t('banks.syncing') : t('banks.syncNow') }}
      </button>
    </header>
    <p class="mt-1 text-sm text-slate-500">
      {{ t('banks.total') }}:
      <strong class="tabular-nums">{{ money(totalBalance, household.currency) }}</strong>
    </p>
    <p v-if="syncResult" class="mt-2 text-sm text-brand-700" role="status">{{ syncResult }}</p>
    <p v-if="error" class="mt-2 text-sm text-rose-700" role="alert">{{ error }}</p>

    <section v-for="c in visibleConnections" :key="c.id" class="card mt-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">🏦 {{ c.aspsp_name }}</h2>
          <p class="text-xs text-slate-500">
            <template v-if="c.last_synced_at">{{
              t('banks.lastSync', { date: d(new Date(c.last_synced_at), 'long') })
            }}</template>
            <template v-else>{{ t('banks.neverSynced') }}</template>
            <template v-if="c.status === 'active' && daysLeft(c) !== null">
              · {{ t('banks.consentDays', { n: daysLeft(c) }) }}
            </template>
          </p>
        </div>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="{
            'bg-brand-50 text-brand-800': c.status === 'active',
            'bg-amber-50 text-amber-800': c.status === 'expired',
            'bg-rose-50 text-rose-800': c.status === 'error',
          }"
        >
          {{ t(`banks.status.${c.status}`) }}
        </span>
      </div>
      <p v-if="c.last_error" class="mt-2 text-sm text-rose-700">{{ c.last_error }}</p>
      <ul class="mt-3 divide-y divide-slate-100">
        <li v-for="a in accountsOf(c)" :key="a.id" class="flex items-center gap-3 py-2">
          <button type="button" class="min-w-0 flex-1 text-left" @click="editAccount(a)">
            <span class="block truncate font-medium">{{ a.name }}</span>
            <span class="block truncate text-xs text-slate-500">
              {{ a.iban ? `…${a.iban.slice(-4)}` : '' }}
              <template v-if="ownerName(a)"> · {{ ownerName(a) }}</template>
            </span>
          </button>
          <span class="tabular-nums">{{ money(a.balance, a.currency) }}</span>
          <label
            class="flex items-center gap-1 text-xs text-slate-500"
            :title="t('banks.inPocketHelp')"
          >
            <input
              type="checkbox"
              :checked="a.include_in_pocket"
              @change="household.updateAccount(a.id, { include_in_pocket: !a.include_in_pocket })"
            />
            {{ t('banks.inPocket') }}
          </label>
        </li>
      </ul>
      <div class="mt-3 flex gap-2">
        <button
          v-if="c.status === 'expired' || c.status === 'error' || (daysLeft(c) ?? 99) < 14"
          type="button"
          class="btn-primary flex-1"
          :disabled="starting !== null"
          @click="connect({ name: c.aspsp_name, country: c.aspsp_country })"
        >
          {{ t('banks.reconnect') }}
        </button>
        <button type="button" class="btn-secondary flex-1" @click="disconnect(c)">
          {{ t('banks.disconnect') }}
        </button>
      </div>
    </section>

    <section v-if="otherAccounts.length" class="card mt-4">
      <h2 class="font-semibold">{{ t('banks.otherAccounts') }}</h2>
      <ul class="mt-2 divide-y divide-slate-100">
        <li v-for="a in otherAccounts" :key="a.id" class="flex items-center gap-3 py-2">
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left font-medium"
            @click="editAccount(a)"
          >
            {{ a.name }}
          </button>
          <span class="tabular-nums">{{ money(a.balance, a.currency) }}</span>
          <label class="flex items-center gap-1 text-xs text-slate-500">
            <input
              type="checkbox"
              :checked="a.include_in_pocket"
              @change="household.updateAccount(a.id, { include_in_pocket: !a.include_in_pocket })"
            />
            {{ t('banks.inPocket') }}
          </label>
        </li>
      </ul>
    </section>

    <button
      type="button"
      class="btn-primary mt-6 w-full"
      data-testid="connect-bank"
      @click="openPicker"
    >
      + {{ t('banks.connect') }}
    </button>
    <p class="mt-3 text-xs text-slate-500">{{ t('banks.privacy') }}</p>

    <BottomSheet v-if="picking" :title="t('banks.pick')" @close="picking = false">
      <input
        v-model="bankSearch"
        type="search"
        class="input"
        :placeholder="t('banks.searchBank')"
      />
      <p v-if="loadingBanks" class="mt-4 text-sm text-slate-500">{{ t('common.loading') }}</p>
      <p v-if="error" class="mt-4 text-sm text-rose-700" role="alert">{{ error }}</p>
      <ul class="mt-3 divide-y divide-slate-100">
        <li v-for="b in sortedBanks" :key="`${b.country}:${b.name}`">
          <button
            type="button"
            class="flex w-full items-center gap-3 py-3 text-left disabled:opacity-50"
            :disabled="starting !== null"
            @click="connect(b)"
          >
            <img v-if="b.logo" :src="b.logo" alt="" class="h-8 w-8 rounded object-contain" />
            <span v-else class="h-8 w-8 text-2xl">🏦</span>
            <span class="flex-1 font-medium">{{ b.name }}</span>
            <span v-if="starting === b.name" class="text-sm text-slate-500">{{
              t('common.loading')
            }}</span>
          </button>
        </li>
      </ul>
    </BottomSheet>

    <BottomSheet v-if="editingAccount" :title="t('banks.account')" @close="editingAccount = null">
      <form class="space-y-4" @submit.prevent="saveAccount">
        <div>
          <label class="label" for="acc-name">{{ t('plan.name') }}</label>
          <input id="acc-name" v-model="accountName" required maxlength="60" class="input" />
        </div>
        <p v-if="editingAccount.iban" class="text-sm break-all text-slate-500">
          {{ editingAccount.iban }}
        </p>
        <button type="submit" class="btn-primary w-full">{{ t('common.save') }}</button>
        <button type="button" class="btn-danger w-full" @click="removeAccount">
          {{ t('banks.deleteAccount') }}
        </button>
      </form>
    </BottomSheet>
  </main>
</template>
