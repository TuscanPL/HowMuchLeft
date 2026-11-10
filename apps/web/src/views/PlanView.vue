<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAmount, type CategoryKind } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import { money } from '@/lib/format'
import BottomSheet from '@/components/BottomSheet.vue'
import ProgressBar from '@/components/ProgressBar.vue'

// Everything the pocket number is built from: expected income, bills,
// goals, category budgets, and the "always" rules for sorting transactions.
const { t } = useI18n()
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
})

const totalBills = computed(() =>
  household.bills.filter((b) => b.active).reduce((s, b) => s + b.amount, 0),
)
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
    match: r.match ?? '',
    categoryId: r.category_id ?? '',
    target: str(r.target),
    saved: str(r.saved ?? 0),
    monthly: str(r.monthly_contribution ?? 0),
    targetDate: r.target_date ?? '',
    kind: r.kind ?? 'expense',
    limit: str(r.monthly_limit),
  })
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
        })
        break
      case 'bill':
        await household.save('bills', {
          id,
          name: form.name.trim(),
          amount: amountOrThrow(form.amount),
          due_day: form.day,
          match,
          category_id: form.categoryId || null,
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

const expenseCategories = computed(() => household.categories.filter((c) => c.kind === 'expense'))
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
      <ul class="card divide-y divide-slate-100 p-0">
        <li v-for="b in household.bills" :key="b.id" class="flex items-center gap-3 px-4 py-3">
          <button type="button" class="min-w-0 flex-1 text-left" @click="open('bill', b)">
            <span class="block font-medium" :class="!b.active && 'text-slate-400 line-through'">{{
              b.name
            }}</span>
            <span class="block text-xs text-slate-500">
              {{ t('plan.onDay', { day: b.due_day }) }}
              <template v-if="paidBills.has(b.id)"> · ✓ {{ t('plan.paid') }}</template>
              <template v-else-if="!b.match"> · {{ t('plan.noMatch') }}</template>
            </span>
          </button>
          <span class="tabular-nums">{{ money(b.amount, cur) }}</span>
          <input
            type="checkbox"
            :checked="b.active"
            :aria-label="t('plan.active')"
            @change="toggleActive('bills', b)"
          />
        </li>
        <li class="px-4 py-2">
          <button type="button" class="text-sm font-medium text-brand-700" @click="open('bill')">
            + {{ t('plan.addBill') }}
          </button>
        </li>
      </ul>
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
      <form class="space-y-4" @submit.prevent="submit">
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

        <template v-if="editing === 'income' || editing === 'bill'">
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
              <label class="label" for="f-day">{{
                editing === 'bill' ? t('plan.dueDay') : t('plan.payDay')
              }}</label>
              <select id="f-day" v-model.number="form.day" class="input">
                <option v-for="d in 31" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
          </div>
          <div v-if="editing === 'bill'">
            <label class="label" for="f-cat">{{ t('activity.category') }}</label>
            <select id="f-cat" v-model="form.categoryId" class="input">
              <option value="">–</option>
              <option v-for="c in expenseCategories" :key="c.id" :value="c.id">
                {{ c.emoji }} {{ c.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="label" for="f-match">{{ t('plan.match') }}</label>
            <input
              id="f-match"
              v-model="form.match"
              minlength="3"
              class="input"
              :placeholder="editing === 'bill' ? 'orange, netflix…' : 'wynagrodzenie, acme…'"
            />
            <p class="mt-1 text-xs text-slate-500">{{ t('plan.matchHelp') }}</p>
          </div>
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
