<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore } from '@/stores/household'
import { isoToDate, money, moneyRound } from '@/lib/format'
import ProgressBar from '@/components/ProgressBar.vue'
import PaydaySheet from '@/components/PaydaySheet.vue'

const { t, d } = useI18n()
const household = useHouseholdStore()

/** 0 = this budget month, -1 = the one before, … */
const offset = ref(0)
const pocket = computed(() => household.pocketFor(offset.value))
const cur = computed(() => household.currency)
const isCurrent = computed(() => offset.value === 0)
const paydayOpen = ref(false)
/** This month began with a "Payday" press (so it can be undone). */
const startedOnPayday = computed(() => household.paydays.includes(pocket.value.period.start))

const lastSync = computed(() => {
  const times = household.connections
    .map((c) => c.last_synced_at)
    .filter((s): s is string => Boolean(s))
    .sort()
  return times.at(-1) ?? null
})
const needsAttention = computed(() =>
  household.connections.some((c) => c.status === 'expired' || c.status === 'error'),
)

const uncategorised = computed(() => {
  const p = pocket.value.period
  return household.transactions.filter(
    (tx) => !tx.category_id && !tx.ignored && tx.booked_on >= p.start && tx.booked_on <= p.end,
  ).length
})

const spendingCategories = computed(() =>
  pocket.value.categories
    .filter((c) => c.spent !== 0 || c.limit !== null)
    .sort((a, b) => b.spent - a.spent),
)

const upcomingBills = computed(() => pocket.value.billStatuses.filter((b) => !b.paid))
const pendingIncome = computed(() => pocket.value.incomeStatuses.filter((i) => !i.received))
</script>

<template>
  <main class="px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <header class="flex items-center justify-between">
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xl text-slate-500"
        :aria-label="t('pocket.previous')"
        @click="offset--"
      >
        ‹
      </button>
      <div class="text-center">
        <p class="text-sm font-medium text-slate-500" data-testid="period">
          {{ d(isoToDate(pocket.period.start), 'short') }} –
          {{ d(isoToDate(pocket.period.end), 'short') }}
        </p>
        <p v-if="startedOnPayday" class="text-xs text-slate-400">
          {{
            household.paydayBy(pocket.period.start)
              ? t('payday.startedOnBy', { name: household.paydayBy(pocket.period.start) })
              : t('payday.startedOn')
          }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xl text-slate-500 disabled:opacity-30"
        :disabled="offset >= 0"
        :aria-label="t('pocket.next')"
        @click="offset++"
      >
        ›
      </button>
    </header>

    <section class="mt-4 rounded-3xl bg-brand-700 p-6 text-center text-white shadow-lg">
      <p class="text-sm tracking-wide text-brand-100 uppercase">
        {{ isCurrent ? t('pocket.inMyPocket') : t('pocket.leftAtEnd') }}
      </p>
      <p
        class="mt-1 text-5xl font-bold tabular-nums"
        :class="pocket.inPocket < 0 ? 'text-rose-200' : ''"
        data-testid="in-pocket"
      >
        {{ moneyRound(pocket.inPocket, cur) }}
      </p>
      <p v-if="isCurrent" class="mt-2 text-brand-100">
        {{
          t('pocket.perDay', {
            amount: moneyRound(pocket.perDay, cur),
            days: pocket.daysLeft,
          })
        }}
      </p>
    </section>

    <button
      v-if="isCurrent"
      type="button"
      class="mt-3 w-full rounded-xl border border-brand-100 bg-brand-50 py-2 text-sm font-semibold text-brand-800"
      data-testid="payday"
      @click="paydayOpen = true"
    >
      💸 {{ t('payday.button') }}
    </button>

    <p
      v-if="needsAttention"
      class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
      role="status"
    >
      {{ t('pocket.bankNeedsAttention') }}
      <RouterLink :to="{ name: 'banks' }" class="font-semibold underline">{{
        t('nav.banks')
      }}</RouterLink>
    </p>
    <p v-else-if="isCurrent && lastSync" class="mt-2 text-center text-xs text-slate-400">
      {{ t('pocket.lastSync', { date: d(new Date(lastSync), 'long') }) }}
    </p>
    <p
      v-else-if="isCurrent && !household.connections.length"
      class="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-600"
    >
      {{ t('pocket.noBanks') }}
      <RouterLink :to="{ name: 'banks' }" class="font-semibold text-brand-700 underline">{{
        t('banks.connect')
      }}</RouterLink>
    </p>

    <section class="card mt-4" data-testid="breakdown">
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between">
          <dt>💰 {{ t('pocket.income') }}</dt>
          <dd class="font-medium tabular-nums">{{ money(pocket.income, cur) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt>🧾 {{ t('pocket.bills') }}</dt>
          <dd class="font-medium tabular-nums">− {{ money(pocket.bills, cur) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt>🎯 {{ t('pocket.goals') }}</dt>
          <dd class="font-medium tabular-nums">− {{ money(pocket.goals, cur) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt>🛒 {{ t('pocket.spent') }}</dt>
          <dd class="font-medium tabular-nums">− {{ money(pocket.spent, cur) }}</dd>
        </div>
        <div class="flex justify-between border-t border-slate-100 pt-2 font-semibold">
          <dt>{{ t('pocket.inMyPocket') }}</dt>
          <dd class="tabular-nums">{{ money(pocket.inPocket, cur) }}</dd>
        </div>
      </dl>
      <p v-if="pendingIncome.length" class="mt-3 text-xs text-slate-500">
        {{
          t('pocket.incomeExpected', {
            list: pendingIncome.map((i) => i.income.name).join(', '),
          })
        }}
      </p>
    </section>

    <RouterLink
      v-if="uncategorised"
      :to="{ name: 'activity', query: { filter: 'uncategorised' } }"
      class="mt-3 block rounded-xl bg-sky-50 p-3 text-sm text-sky-800"
    >
      {{ t('pocket.uncategorised', { n: uncategorised }, uncategorised) }} ›
    </RouterLink>

    <section v-if="upcomingBills.length && isCurrent" class="mt-6">
      <h2 class="mb-2 font-semibold">{{ t('pocket.upcomingBills') }}</h2>
      <ul class="card divide-y divide-slate-100 p-0">
        <li
          v-for="b in upcomingBills"
          :key="b.bill.id"
          class="flex items-center justify-between px-4 py-3 text-sm"
        >
          <span>
            {{ b.bill.name }}
            <span class="text-slate-400">· {{ d(isoToDate(b.due), 'short') }}</span>
          </span>
          <span class="tabular-nums">{{ money(b.amount, cur) }}</span>
        </li>
      </ul>
    </section>

    <section class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold">{{ t('pocket.categories') }}</h2>
        <RouterLink :to="{ name: 'plan', hash: '#budgets' }" class="text-sm text-brand-700">
          {{ t('pocket.setBudgets') }}
        </RouterLink>
      </div>
      <p v-if="!spendingCategories.length" class="text-sm text-slate-500">
        {{ t('pocket.nothingSpent') }}
      </p>
      <ul class="space-y-3">
        <li v-for="c in spendingCategories" :key="c.category?.id ?? 'none'" class="card py-3">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium">
              {{ c.category?.emoji ?? '❔' }} {{ c.category?.name ?? t('common.uncategorised') }}
            </span>
            <span class="tabular-nums">
              {{ money(c.spent, cur) }}
              <span v-if="c.limit !== null" class="text-slate-400"
                >/ {{ money(c.limit, cur) }}</span
              >
            </span>
          </div>
          <template v-if="c.limit !== null">
            <ProgressBar class="mt-2" :value="c.spent" :max="c.limit" />
            <p class="mt-1 text-xs" :class="(c.left ?? 0) < 0 ? 'text-rose-600' : 'text-slate-500'">
              {{
                (c.left ?? 0) < 0
                  ? t('pocket.over', { amount: money(-(c.left ?? 0), cur) })
                  : t('pocket.left', { amount: money(c.left ?? 0, cur) })
              }}
            </p>
          </template>
        </li>
      </ul>
    </section>
    <PaydaySheet v-if="paydayOpen" @close="paydayOpen = false" />
  </main>
</template>
