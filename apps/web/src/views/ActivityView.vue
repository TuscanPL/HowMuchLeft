<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore, type Transaction } from '@/stores/household'
import { isoToDate, money } from '@/lib/format'
import TransactionSheet from '@/components/TransactionSheet.vue'
import AddTransactionSheet from '@/components/AddTransactionSheet.vue'

const { t, d } = useI18n()
const route = useRoute()
const router = useRouter()
const household = useHouseholdStore()

type Filter = 'all' | 'uncategorised' | 'spending' | 'income'
const filter = ref<Filter>((route.query.filter as Filter) ?? 'all')
const accountId = ref<string>('')
const search = ref('')
const selected = ref<Transaction | null>(null)
const adding = ref(false)
const loadingOlder = ref(false)

watch(filter, (f) => void router.replace({ query: f === 'all' ? {} : { filter: f } }))

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return household.transactions.filter((tx) => {
    if (accountId.value && tx.account_id !== accountId.value) return false
    if (filter.value === 'uncategorised' && (tx.category_id || tx.ignored)) return false
    if (filter.value === 'spending' && tx.amount >= 0) return false
    if (filter.value === 'income' && tx.amount <= 0) return false
    if (q) {
      const text = `${tx.description} ${tx.counterparty ?? ''} ${tx.note ?? ''}`.toLowerCase()
      if (!text.includes(q)) return false
    }
    return true
  })
})

const days = computed(() => {
  const groups: { date: string; items: Transaction[]; total: number }[] = []
  for (const tx of visible.value) {
    let g = groups.at(-1)
    if (!g || g.date !== tx.booked_on) {
      g = { date: tx.booked_on, items: [], total: 0 }
      groups.push(g)
    }
    g.items.push(tx)
    if (!tx.ignored) g.total += tx.amount
  }
  return groups
})

function label(tx: Transaction) {
  return tx.counterparty || tx.description || t('activity.noDescription')
}

const eventById = computed(() => new Map(household.events.map((e) => [e.id, e])))

function eventTag(tx: Transaction) {
  const e = tx.event_id ? eventById.value.get(tx.event_id) : null
  return e ? ` · ${e.emoji} ${e.name}` : ''
}

function tag(tx: Transaction) {
  if (tx.bill_id) return `🧾 ${household.billById.get(tx.bill_id)?.name ?? ''}`
  if (tx.income_id) return `💰 ${household.incomeById.get(tx.income_id)?.name ?? ''}`
  const c = tx.category_id ? household.categoryById.get(tx.category_id) : null
  return c ? `${c.emoji} ${c.name}` : `❔ ${t('common.uncategorised')}`
}

async function older() {
  loadingOlder.value = true
  try {
    await household.loadOlder()
  } finally {
    loadingOlder.value = false
  }
}
</script>

<template>
  <main class="px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('activity.title') }}</h1>
      <div class="flex items-center gap-2">
        <RouterLink :to="{ name: 'events' }" class="btn-secondary py-1.5" data-testid="to-events">
          🎉 {{ t('events.title') }}
        </RouterLink>
        <button type="button" class="btn-secondary py-1.5" @click="adding = true">
          + {{ t('activity.addCash') }}
        </button>
      </div>
    </header>

    <div class="mt-4 space-y-2">
      <input
        v-model="search"
        type="search"
        class="input"
        :placeholder="t('activity.search')"
        data-testid="activity-search"
      />
      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="f in ['all', 'uncategorised', 'spending', 'income'] as const"
          :key="f"
          type="button"
          class="shrink-0 rounded-full border px-3 py-1 text-sm"
          :class="
            filter === f
              ? 'border-brand-700 bg-brand-700 text-white'
              : 'border-slate-300 bg-white text-slate-700'
          "
          @click="filter = f"
        >
          {{ t(`activity.filter.${f}`) }}
        </button>
        <select
          v-model="accountId"
          class="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm"
        >
          <option value="">{{ t('activity.allAccounts') }}</option>
          <option v-for="a in household.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
    </div>

    <p v-if="!days.length" class="mt-10 text-center text-slate-500">{{ t('activity.empty') }}</p>

    <section v-for="day in days" :key="day.date" class="mt-5">
      <h2
        class="mb-1 flex justify-between text-xs font-semibold tracking-wide text-slate-500 uppercase"
      >
        <span>{{ d(isoToDate(day.date), 'day') }}</span>
        <span class="tabular-nums">{{ money(day.total, household.currency) }}</span>
      </h2>
      <ul class="card divide-y divide-slate-100 p-0">
        <li v-for="tx in day.items" :key="tx.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left"
            :class="tx.ignored ? 'opacity-50' : ''"
            data-testid="tx-row"
            @click="selected = tx"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ label(tx) }}</span>
              <span class="block truncate text-xs text-slate-500">
                {{ tag(tx) }} · {{ household.accountById.get(tx.account_id)?.name
                }}{{ eventTag(tx) }}
                <template v-if="tx.status === 'pending'"> · {{ t('activity.pending') }}</template>
              </span>
            </span>
            <span
              class="shrink-0 font-semibold tabular-nums"
              :class="tx.amount > 0 ? 'text-brand-700' : ''"
            >
              {{ tx.amount > 0 ? '+' : '' }}{{ money(tx.amount, tx.currency) }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <button
      v-if="household.loadedFrom"
      type="button"
      class="btn-secondary mt-6 w-full"
      :disabled="loadingOlder"
      @click="older"
    >
      {{ loadingOlder ? t('common.loading') : t('activity.older') }}
    </button>

    <TransactionSheet v-if="selected" :transaction="selected" @close="selected = null" />
    <AddTransactionSheet v-if="adding" @close="adding = false" />
  </main>
</template>
