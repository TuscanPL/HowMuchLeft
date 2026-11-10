<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BILL_INTERVALS, monthlyCost, parseAmount } from '@hml/shared'
import { useHouseholdStore, type Bill, type Transaction } from '@/stores/household'
import { money } from '@/lib/format'

// The one form for a bill: in Plan (new or edit), and from a transaction
// ("Make this a bill"), where it starts filled in from that payment.
const props = defineProps<{
  /** Editing an existing bill. */
  bill?: Bill | null
  /** Creating a bill from this payment: prefilled from it, and linked to it on save. */
  fromTransaction?: Transaction | null
}>()
const emit = defineEmits<{ done: [bill: Bill | null] }>()
const { t, d } = useI18n()
const household = useHouseholdStore()
const cur = computed(() => household.currency)

function str(n: number | null | undefined) {
  return n == null ? '' : String(n).replace('.', ',')
}

/** A short, matchable piece of the bank text: the recipient, else the first words. */
function matchFrom(tx: Transaction): string {
  const text = (tx.counterparty || tx.description.split(/\s+/).slice(0, 2).join(' ')).trim()
  return text.toLowerCase().slice(0, 40)
}

const tx = props.fromTransaction
const b = props.bill
const form = reactive({
  name: b?.name ?? tx?.counterparty ?? tx?.description.slice(0, 80) ?? '',
  amount: str(b?.amount ?? (tx ? Math.abs(tx.amount) : null)),
  day: b?.due_day ?? (tx ? Number(tx.booked_on.slice(8, 10)) : 1),
  every: b?.every_months ?? 1,
  dueMonth: b?.due_month ?? (tx ? Number(tx.booked_on.slice(5, 7)) : new Date().getMonth() + 1),
  spread: b?.spread ?? true,
  categoryId:
    b?.category_id ??
    (tx?.category_id && household.categoryById.get(tx.category_id)?.kind === 'expense'
      ? tx.category_id
      : '') ??
    '',
  match: b?.match ?? (tx ? matchFrom(tx) : ''),
})
const saving = ref(false)
const error = ref<string | null>(null)

const expenseCategories = computed(() => household.categories.filter((c) => c.kind === 'expense'))
const spreadPreview = computed(() => {
  const v = parseAmount(form.amount)
  return v ? money(monthlyCost({ amount: v, every_months: form.every }), cur.value) : '…'
})
function monthName(m: number) {
  return d(new Date(Date.UTC(2026, m - 1, 1)), 'monthName')
}

/** Other payments out (already loaded, not sorted by hand) that the match text will link to this bill. */
const matches = computed(() => {
  const m = form.match.trim().toLowerCase()
  if (m.length < 3) return []
  return household.transactions.filter(
    (x) =>
      x.amount < 0 &&
      x.id !== tx?.id &&
      // Payments sorted by hand are left alone by the automatic linking.
      !x.manual &&
      `${x.description} ${x.counterparty ?? ''}`.toLowerCase().includes(m),
  )
})

async function save() {
  const amount = parseAmount(form.amount)
  if (amount === null || amount <= 0) {
    error.value = t('common.badAmount')
    return
  }
  saving.value = true
  error.value = null
  try {
    const saved = await household.save('bills', {
      ...(b ? { id: b.id } : {}),
      name: form.name.trim(),
      amount,
      due_day: form.day,
      match: form.match.trim().toLowerCase() || null,
      category_id: form.categoryId || null,
      every_months: form.every,
      due_month: form.every === 1 ? null : form.dueMonth,
      spread: form.every === 1 ? false : form.spread,
    })
    if (tx) {
      await household.updateTransaction(tx.id, {
        bill_id: saved.id,
        category_id: saved.category_id ?? tx.category_id,
        manual: true,
      })
    }
    // Earlier (and later) payments with the same text get linked too.
    await household.recategorize()
    emit('done', saved)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!b || !confirm(t('plan.deleteConfirm', { name: b.name }))) return
  saving.value = true
  try {
    await household.remove('bills', b.id)
    emit('done', null)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="space-y-4" data-testid="bill-form" @submit.prevent="save">
    <div>
      <label class="label" for="f-name">{{ t('plan.name') }}</label>
      <input id="f-name" v-model="form.name" required maxlength="80" class="input" />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="f-amount">{{ t('common.amount') }}</label>
        <input id="f-amount" v-model="form.amount" required inputmode="decimal" class="input" />
      </div>
      <div>
        <label class="label" for="f-day">{{ t('plan.dueDay') }}</label>
        <select id="f-day" v-model.number="form.day" class="input">
          <option v-for="n in 31" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="f-every">{{ t('plan.howOften') }}</label>
        <select id="f-every" v-model.number="form.every" class="input">
          <option v-for="n in BILL_INTERVALS" :key="n" :value="n">
            {{ t(`plan.every.${n}`) }}
          </option>
        </select>
      </div>
      <div v-if="form.every > 1">
        <label class="label" for="f-month">{{
          form.every === 12 ? t('plan.paidIn') : t('plan.nextIn')
        }}</label>
        <select id="f-month" v-model.number="form.dueMonth" class="input">
          <option v-for="m in 12" :key="m" :value="m">{{ monthName(m) }}</option>
        </select>
      </div>
    </div>
    <fieldset v-if="form.every > 1" class="space-y-2 text-sm">
      <legend class="label">{{ t('plan.setAside') }}</legend>
      <label class="flex items-start gap-2">
        <input v-model="form.spread" type="radio" :value="true" class="mt-1" />
        <span>
          {{ t('plan.spread', { amount: spreadPreview }) }}
          <span class="block text-xs text-slate-500">{{ t('plan.spreadHelp') }}</span>
        </span>
      </label>
      <label class="flex items-start gap-2">
        <input v-model="form.spread" type="radio" :value="false" class="mt-1" />
        <span>{{ t('plan.atOnce', { month: monthName(form.dueMonth) }) }}</span>
      </label>
    </fieldset>
    <div>
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
        placeholder="orange, netflix…"
      />
      <p class="mt-1 text-xs text-slate-500" data-testid="bill-matches">
        {{
          form.match.trim().length >= 3
            ? t('plan.matchFound', { n: matches.length }, matches.length)
            : t('plan.matchHelp')
        }}
      </p>
    </div>
    <button type="submit" class="btn-primary w-full" :disabled="saving">
      {{ saving ? t('common.saving') : t('common.save') }}
    </button>
    <button v-if="b" type="button" class="btn-danger w-full" :disabled="saving" @click="remove">
      {{ t('common.delete') }}
    </button>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </form>
</template>
