<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { monthlyCost, parseAmount, type CategoryKind } from '@hml/shared'
import { useHouseholdStore, type Bill, type Category } from '@/stores/household'
import { isoToDate, money } from '@/lib/format'
import BottomSheet from '@/components/BottomSheet.vue'
import BillForm from '@/components/BillForm.vue'
import ProgressBar from '@/components/ProgressBar.vue'

// Everything the pocket number is built from: expected income, bills,
// goals, category budgets, and the "always" rules for sorting transactions.
const { t, d } = useI18n()
const household = useHouseholdStore()
const cur = computed(() => household.currency)
const pocket = computed(() => household.pocket)

type Kind = 'income' | 'bill' | 'goal' | 'category' | 'rule'
const editing = ref<Kind | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)
const form = reactive({
  id: '' as string,
  name: '',
  emoji: '',
  amount: '',
  day: 1,
  match: '',
  categoryId: '' as string,
  target: '',
  saved: '',
  monthly: '',
  targetDate: '',
  kind: 'expense' as CategoryKind,
  limit: '',
  startsMonth: true,
})
/** The bill being edited (the bill form is its own component). */
const editingBill = ref<Bill | null>(null)

/** Bills per month on average: a yearly 600 zł counts as 50 zł. */
const totalBills = computed(() =>
  household.bills.filter((b) => b.active).reduce((s, b) => s + monthlyCost(b), 0),
)

/** Bills grouped by their category (Subscriptions, Home, …), biggest first; ones without a category last. */
const billGroups = computed(() => {
  const groups = new Map<string, { category: Category | null; bills: Bill[]; monthly: number }>()
  for (const b of household.bills) {
    const key = b.category_id ?? ''
    const g = groups.get(key) ?? {
      category: (b.category_id && household.categoryById.get(b.category_id)) || null,
      bills: [],
      monthly: 0,
    }
    g.bills.push(b)
    if (b.active) g.monthly += monthlyCost(b)
    groups.set(key, g)
  }
  return [...groups.values()].sort(
    (a, b) => Number(!a.category) - Number(!b.category) || b.monthly - a.monthly,
  )
})

const billStatusById = computed(() => new Map(pocket.value.billStatuses.map((s) => [s.bill.id, s])))

function monthName(m: number) {
  return d(new Date(Date.UTC(2026, m - 1, 1)), 'monthName')
}

/** "on day 5", "yearly, in March", "every 3 months, next in January". */
function billSchedule(b: Bill) {
  if (b.every_months === 1) return t('plan.onDay', { day: b.due_day })
  const next = billStatusById.value.get(b.id)?.nextDue
  const when = next ? d(isoToDate(`${next}-01`), 'month') : monthName(b.due_month ?? 1)
  return b.every_months === 12
    ? t('plan.yearlyIn', { month: when, day: b.due_day })
    : t('plan.everyIn', { n: b.every_months, month: when })
}
const totalIncome = computed(() =>
  household.incomes.filter((i) => i.active).reduce((s, i) => s + i.amount, 0),
)
const budgeted = computed(() =>
  household.categories.reduce((s, c) => s + (c.kind === 'expense' ? (c.monthly_limit ?? 0) : 0), 0),
)
const spentByCategory = computed(
  () => new Map(pocket.value.categories.map((c) => [c.category?.id ?? '', c.spent])),
)
const paidBills = computed(
  () => new Set(pocket.value.billStatuses.filter((b) => b.paid).map((b) => b.bill.id)),
)
const receivedIncomes = computed(
  () => new Set(pocket.value.incomeStatuses.filter((i) => i.received).map((i) => i.income.id)),
)

function str(n: number | null | undefined) {
  return n == null ? '' : String(n).replace('.', ',')
}

function open(kind: Kind, row?: Record<string, unknown>) {
  error.value = null
  const r = (row ?? {}) as Record<string, never>
  Object.assign(form, {
    id: r.id ?? '',
    name: r.name ?? '',
    emoji: r.emoji ?? (kind === 'goal' ? '🎯' : '💸'),
    amount: str(r.amount),
    day: r.due_day ?? r.pay_day ?? 1,
    startsMonth: r.starts_month ?? true,
    match: r.match ?? '',
    categoryId: r.category_id ?? '',
    target: str(r.target),
    saved: str(r.saved ?? 0),
    monthly: str(r.monthly_contribution ?? 0),
    targetDate: r.target_date ?? '',
    kind: r.kind ?? 'expense',
    limit: str(r.monthly_limit),
  })
  editingBill.value = kind === 'bill' ? ((row as Bill | undefined) ?? null) : null
  editing.value = kind
}

function amountOrThrow(s: string, allowZero = false): number {
  const v = parseAmount(s)
  if (v === null || v < 0 || (!allowZero && v === 0)) throw new Error(t('common.badAmount'))
  return v
}

async function submit() {
  saving.value = true
  error.value = null
  const id = form.id || undefined
  const match = form.match.trim().toLowerCase() || null
  try {
    switch (editing.value) {
      case 'income':
        await household.save('incomes', {
          id,
          name: form.name.trim(),
          amount: amountOrThrow(form.amount),
          pay_day: form.day,
          match,
          starts_month: form.startsMonth,
        })
        break
      case 'goal':
        await household.save('goals', {
          id,
          name: form.name.trim(),
          emoji: form.emoji || '🎯',
          target: amountOrThrow(form.target),
          saved: amountOrThrow(form.saved || '0', true),
          monthly_contribution: amountOrThrow(form.monthly || '0', true),
          target_date: form.targetDate || null,
        })
        break
      case 'category':
        await household.save('categories', {
          id,
          name: form.name.trim(),
          emoji: form.emoji || '💸',
          kind: form.kind,
          monthly_limit: form.limit.trim() ? amountOrThrow(form.limit, true) : null,
          ...(id ? {} : { position: (household.categories.at(-1)?.position ?? 0) + 10 }),
        })
        break
      case 'rule':
        if (!match || !form.categoryId) throw new Error(t('plan.ruleIncomplete'))
        await household.save('rules', { id, match, category_id: form.categoryId })
        break
    }
    // New match texts and rules apply to what's already there too.
    if (editing.value !== 'goal' && editing.value !== 'category') await household.recategorize()
    editing.value = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

const tableFor = {
  income: 'incomes',
  bill: 'bills',
  goal: 'goals',
  category: 'categories',
  rule: 'rules',
} as const

async function remove() {
  if (
    !editing.value ||
    !form.id ||
    !confirm(t('plan.deleteConfirm', { name: form.name || form.match }))
  )
    return
  saving.value = true
  try {
    await household.remove(tableFor[editing.value], form.id)
    editing.value = null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function toggleActive(table: 'bills' | 'incomes', row: { id: string; active: boolean }) {
  await household.save(table, { id: row.id, active: !row.active })
}
</script>

<template>
  <main class="space-y-8 px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <h1 class="text-2xl font-bold">{{ t('plan.title') }}</h1>

    <!-- Income -->
    <section id="income">
      <div class="mb-2 flex items-baseline justify-between">
        <h2 class="font-semibold">💰 {{ t('plan.income') }}</h2>
        <span class="text-sm text-slate-500 tabular-nums"
          >{{ money(totalIncome, cur) }} / {{ t('plan.month') }}</span
        >
      </div>
      <p class="mb-2 text-sm text-slate-500">{{ t('plan.incomeHelp') }}</p>
      <ul class="card divide-y divide-slate-100 p-0">
        <li v-for="i in household.incomes" :key="i.id" class="flex items-center gap-3 px-4 py-3">
          <button type="button" class="min-w-0 flex-1 text-left" @click="open('income', i)">
            <span class="block font-medium" :class="!i.active && 'text-slate-400 line-through'">{{
              i.name
            }}</span>
            <span class="block text-xs text-slate-500">
              {{ t('plan.onDay', { day: i.pay_day }) }}
              <template v-if="i.starts_month"> · 💸 {{ t('plan.payday') }}</template>
              <template v-if="receivedIncomes.has(i.id)"> · ✓ {{ t('plan.received') }}</template>
            </span>
          </button>
          <span class="tabular-nums">{{ money(i.amount, cur) }}</span>
          <input
            type="checkbox"
            :checked="i.active"
            :aria-label="t('plan.active')"
            @change="toggleActive('incomes', i)"
          />
        </li>
        <li class="px-4 py-2">
          <button type="button" class="text-sm font-medium text-brand-700" @click="open('income')">
            + {{ t('plan.addIncome') }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Bills -->
    <section id="bills">
      <div class="mb-2 flex items-baseline justify-between">
        <h2 class="font-semibold">🧾 {{ t('plan.bills') }}</h2>
        <span class="text-sm text-slate-500 tabular-nums"
          >{{ money(totalBills, cur) }} / {{ t('plan.month') }}</span
        >
      </div>
      <p class="mb-2 text-sm text-slate-500">{{ t('plan.billsHelp') }}</p>
      <div v-for="g in billGroups" :key="g.category?.id ?? 'none'" class="mb-3">
        <h3 class="mb-1 flex justify-between px-1 text-sm font-medium text-slate-600">
          <span>{{
            g.category ? `${g.category.emoji} ${g.category.name}` : t('plan.otherBills')
          }}</span>
          <span class="tabular-nums" data-testid="bill-group-total">
            {{ money(g.monthly, cur) }} / {{ t('plan.month') }}
          </span>
        </h3>
        <ul class="card divide-y divide-slate-100 p-0">
          <li v-for="b in g.bills" :key="b.id" class="flex items-center gap-3 px-4 py-3">
            <button type="button" class="min-w-0 flex-1 text-left" @click="open('bill', b)">
              <span class="block font-medium" :class="!b.active && 'text-slate-400 line-through'">{{
                b.name
              }}</span>
              <span class="block text-xs text-slate-500">
                {{ billSchedule(b) }}
                <template v-if="paidBills.has(b.id)"> · ✓ {{ t('plan.paid') }}</template>
                <template v-else-if="!b.match"> · {{ t('plan.noMatch') }}</template>
              </span>
            </button>
            <span class="text-right tabular-nums">
              {{ money(b.amount, cur) }}
              <span v-if="b.every_months > 1" class="block text-xs text-slate-500">
                {{
                  b.spread
                    ? t('plan.perMonthShort', { amount: money(monthlyCost(b), cur) })
                    : t('plan.allAtOnce')
                }}
              </span>
            </span>
            <input
              type="checkbox"
              :checked="b.active"
              :aria-label="t('plan.active')"
              @change="toggleActive('bills', b)"
            />
          </li>
        </ul>
      </div>
      <button type="button" class="text-sm font-medium text-brand-700" @click="open('bill')">
        + {{ t('plan.addBill') }}
      </button>
    </section>

    <!-- Goals -->
    <section id="goals">
      <h2 class="mb-2 font-semibold">🎯 {{ t('plan.goals') }}</h2>
      <p class="mb-2 text-sm text-slate-500">{{ t('plan.goalsHelp') }}</p>
      <ul class="space-y-3">
        <li v-for="g in household.goals" :key="g.id">
          <button type="button" class="card block w-full text-left" @click="open('goal', g)">
            <span class="flex justify-between font-medium">
              <span>{{ g.emoji }} {{ g.name }}</span>
              <span class="tabular-nums"
                >{{ money(g.saved, cur) }} / {{ money(g.target, cur) }}</span
              >
            </span>
            <ProgressBar class="mt-2" :value="g.saved" :max="g.target" />
            <span class="mt-1 block text-xs text-slate-500">
              {{
                g.saved >= g.target
                  ? t('plan.goalReached')
                  : t('plan.perMonth', { amount: money(g.monthly_contribution, cur) })
              }}
            </span>
          </button>
        </li>
      </ul>
      <button type="button" class="mt-2 text-sm font-medium text-brand-700" @click="open('goal')">
        + {{ t('plan.addGoal') }}
      </button>
    </section>

    <!-- Budgets / categories -->
    <section id="budgets">
      <div class="mb-2 flex items-baseline justify-between">
        <h2 class="font-semibold">📊 {{ t('plan.budgets') }}</h2>
        <span class="text-sm text-slate-500 tabular-nums">{{ money(budgeted, cur) }}</span>
      </div>
      <p class="mb-2 text-sm text-slate-500">{{ t('plan.budgetsHelp') }}</p>
      <ul class="card divide-y divide-slate-100 p-0">
        <li v-for="c in household.categories" :key="c.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-3 text-left"
            @click="open('category', c)"
          >
            <span class="text-lg">{{ c.emoji }}</span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{{ c.name }}</span>
              <span class="block text-xs text-slate-500">{{ t(`kinds.${c.kind}`) }}</span>
            </span>
            <span v-if="c.kind === 'expense'" class="text-sm tabular-nums">
              {{ money(spentByCategory.get(c.id) ?? 0, cur) }}
              <span class="text-slate-400"
                >/ {{ c.monthly_limit == null ? '–' : money(c.monthly_limit, cur) }}</span
              >
            </span>
          </button>
        </li>
        <li class="px-4 py-2">
          <button
            type="button"
            class="text-sm font-medium text-brand-700"
            @click="open('category')"
          >
            + {{ t('plan.addCategory') }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Rules -->
    <section id="rules">
      <h2 class="mb-2 font-semibold">🪄 {{ t('plan.rules') }}</h2>
      <p class="mb-2 text-sm text-slate-500">{{ t('plan.rulesHelp') }}</p>
      <ul class="card divide-y divide-slate-100 p-0">
        <li v-for="r in household.rules" :key="r.id">
          <button
            type="button"
            class="flex w-full justify-between gap-3 px-4 py-3 text-left text-sm"
            @click="open('rule', r)"
          >
            <span class="truncate">“{{ r.match }}”</span>
            <span class="shrink-0 text-slate-600">
              → {{ household.categoryById.get(r.category_id)?.emoji }}
              {{ household.categoryById.get(r.category_id)?.name }}
            </span>
          </button>
        </li>
        <li class="px-4 py-2">
          <button type="button" class="text-sm font-medium text-brand-700" @click="open('rule')">
            + {{ t('plan.addRule') }}
          </button>
        </li>
      </ul>
    </section>

    <BottomSheet v-if="editing" :title="t(`plan.edit.${editing}`)" @close="editing = null">
      <BillForm v-if="editing === 'bill'" :bill="editingBill" @done="editing = null" />
      <form v-else class="space-y-4" @submit.prevent="submit">
        <template v-if="editing !== 'rule'">
          <div class="flex gap-3">
            <div v-if="editing === 'goal' || editing === 'category'" class="w-20">
              <label class="label" for="f-emoji">{{ t('plan.emoji') }}</label>
              <input id="f-emoji" v-model="form.emoji" maxlength="4" class="input text-center" />
            </div>
            <div class="flex-1">
              <label class="label" for="f-name">{{ t('plan.name') }}</label>
              <input id="f-name" v-model="form.name" required maxlength="80" class="input" />
            </div>
          </div>
        </template>

        <template v-if="editing === 'income'">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="f-amount">{{ t('common.amount') }}</label>
              <input
                id="f-amount"
                v-model="form.amount"
                required
                inputmode="decimal"
                class="input"
              />
            </div>
            <div>
              <label class="label" for="f-day">{{ t('plan.payDay') }}</label>
              <select id="f-day" v-model.number="form.day" class="input">
                <option v-for="d in 31" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="label" for="f-match">{{ t('plan.match') }}</label>
            <input
              id="f-match"
              v-model="form.match"
              minlength="3"
              class="input"
              :placeholder="'wynagrodzenie, acme…'"
            />
            <p class="mt-1 text-xs text-slate-500">{{ t('plan.matchHelp') }}</p>
          </div>
          <label v-if="editing === 'income'" class="flex items-start gap-2 text-sm">
            <input v-model="form.startsMonth" type="checkbox" class="mt-1" />
            <span>
              {{ t('plan.startsMonth') }}
              <span class="block text-xs text-slate-500">{{ t('plan.startsMonthHelp') }}</span>
            </span>
          </label>
        </template>

        <template v-if="editing === 'goal'">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="f-target">{{ t('plan.target') }}</label>
              <input
                id="f-target"
                v-model="form.target"
                required
                inputmode="decimal"
                class="input"
              />
            </div>
            <div>
              <label class="label" for="f-saved">{{ t('plan.saved') }}</label>
              <input id="f-saved" v-model="form.saved" inputmode="decimal" class="input" />
            </div>
            <div>
              <label class="label" for="f-monthly">{{ t('plan.monthly') }}</label>
              <input id="f-monthly" v-model="form.monthly" inputmode="decimal" class="input" />
            </div>
            <div>
              <label class="label" for="f-date">{{ t('plan.by') }}</label>
              <input id="f-date" v-model="form.targetDate" type="date" class="input" />
            </div>
          </div>
        </template>

        <template v-if="editing === 'category'">
          <div>
            <label class="label" for="f-kind">{{ t('plan.kind') }}</label>
            <select id="f-kind" v-model="form.kind" class="input">
              <option
                v-for="k in ['expense', 'income', 'transfer', 'savings'] as const"
                :key="k"
                :value="k"
              >
                {{ t(`kinds.${k}`) }}
              </option>
            </select>
            <p class="mt-1 text-xs text-slate-500">{{ t(`kindHelp.${form.kind}`) }}</p>
          </div>
          <div v-if="form.kind === 'expense'">
            <label class="label" for="f-limit">{{ t('plan.limit') }}</label>
            <input
              id="f-limit"
              v-model="form.limit"
              inputmode="decimal"
              class="input"
              :placeholder="t('plan.noLimit')"
            />
          </div>
        </template>

        <template v-if="editing === 'rule'">
          <div>
            <label class="label" for="f-rmatch">{{ t('plan.ruleMatch') }}</label>
            <input
              id="f-rmatch"
              v-model="form.match"
              required
              minlength="2"
              class="input"
              placeholder="biedronka"
            />
          </div>
          <div>
            <label class="label" for="f-rcat">{{ t('activity.category') }}</label>
            <select id="f-rcat" v-model="form.categoryId" required class="input">
              <option v-for="c in household.categories" :key="c.id" :value="c.id">
                {{ c.emoji }} {{ c.name }}
              </option>
            </select>
          </div>
        </template>

        <button type="submit" class="btn-primary w-full" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
        <button
          v-if="form.id"
          type="button"
          class="btn-danger w-full"
          :disabled="saving"
          @click="remove"
        >
          {{ t('common.delete') }}
        </button>
        <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      </form>
    </BottomSheet>
  </main>
</template>
