<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore, type Transaction } from '@/stores/household'
import { isoToDate, money } from '@/lib/format'
import BottomSheet from './BottomSheet.vue'

const props = defineProps<{ transaction: Transaction }>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()
const household = useHouseholdStore()

const tx = computed(
  () => household.transactions.find((x) => x.id === props.transaction.id) ?? props.transaction,
)
const account = computed(() => household.accountById.get(tx.value.account_id))
const isManualAccount = computed(() => account.value && !account.value.external_uid)

const categoryId = ref<string | null>(tx.value.category_id)
const billId = ref<string>(tx.value.bill_id ?? '')
const incomeId = ref<string>(tx.value.income_id ?? '')
const note = ref(tx.value.note ?? '')
const ignored = ref(tx.value.ignored)
// "Always put X in this category": prefilled with the counterparty (or the start of the text).
const makeRule = ref(false)
const ruleText = ref(
  (tx.value.counterparty || tx.value.description.split(/\s+/).slice(0, 3).join(' ')).toLowerCase(),
)
const saving = ref(false)
const error = ref<string | null>(null)

// Money out is never income; money in can be income, a refund (a spending category) or a transfer.
const categories = computed(() =>
  household.categories.filter((c) => tx.value.amount > 0 || c.kind !== 'income'),
)

async function save() {
  saving.value = true
  error.value = null
  try {
    await household.updateTransaction(tx.value.id, {
      category_id: categoryId.value,
      bill_id: billId.value || null,
      income_id: incomeId.value || null,
      note: note.value.trim() || null,
      ignored: ignored.value,
      manual: true,
    })
    if (makeRule.value && categoryId.value && ruleText.value.trim().length >= 2) {
      const match = ruleText.value.trim().toLowerCase()
      const existing = household.rules.find((r) => r.match === match)
      await household.save('rules', {
        ...(existing ? { id: existing.id } : {}),
        match,
        category_id: categoryId.value,
      })
      await household.recategorize()
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm(t('activity.deleteConfirm'))) return
  await household.deleteTransaction(tx.value.id)
  emit('close')
}

/** Hand back to the automatic rules (bills, incomes, "always" rules). */
async function auto() {
  await household.updateTransaction(tx.value.id, { manual: false })
  await household.recategorize()
  emit('close')
}
</script>

<template>
  <BottomSheet :title="tx.counterparty || tx.description" @close="emit('close')">
    <p class="text-3xl font-bold tabular-nums" :class="tx.amount > 0 ? 'text-brand-700' : ''">
      {{ tx.amount > 0 ? '+' : '' }}{{ money(tx.amount, tx.currency) }}
    </p>
    <p class="mt-1 text-sm text-slate-500">
      {{ d(isoToDate(tx.booked_on), 'day') }} · {{ account?.name }}
      <template v-if="tx.status === 'pending'"> · {{ t('activity.pending') }}</template>
    </p>
    <p v-if="tx.description" class="mt-2 text-sm break-words text-slate-600">
      {{ tx.description }}
    </p>

    <form class="mt-5 space-y-5" @submit.prevent="save">
      <fieldset>
        <legend class="label">{{ t('activity.category') }}</legend>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="c in categories"
            :key="c.id"
            type="button"
            class="rounded-xl border px-2 py-2 text-sm"
            :class="
              categoryId === c.id
                ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800'
                : 'border-slate-200'
            "
            :data-testid="`cat-${c.name}`"
            @click="categoryId = categoryId === c.id ? null : c.id"
          >
            <span class="block text-lg">{{ c.emoji }}</span>
            <span class="block truncate">{{ c.name }}</span>
          </button>
        </div>
      </fieldset>

      <label v-if="categoryId" class="flex items-start gap-2 text-sm">
        <input v-model="makeRule" type="checkbox" class="mt-1" />
        <span class="flex-1">
          {{ t('activity.always') }}
          <input
            v-if="makeRule"
            v-model="ruleText"
            class="input mt-2"
            :aria-label="t('activity.ruleText')"
          />
        </span>
      </label>

      <div v-if="tx.amount < 0 && household.bills.length">
        <label class="label" for="tx-bill">{{ t('activity.isBill') }}</label>
        <select id="tx-bill" v-model="billId" class="input">
          <option value="">{{ t('activity.notABill') }}</option>
          <option v-for="b in household.bills" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </div>
      <div v-if="tx.amount > 0 && household.incomes.length">
        <label class="label" for="tx-income">{{ t('activity.isIncome') }}</label>
        <select id="tx-income" v-model="incomeId" class="input">
          <option value="">{{ t('activity.notIncome') }}</option>
          <option v-for="i in household.incomes" :key="i.id" :value="i.id">{{ i.name }}</option>
        </select>
      </div>

      <div>
        <label class="label" for="tx-note">{{ t('activity.note') }}</label>
        <input id="tx-note" v-model="note" class="input" maxlength="200" />
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input v-model="ignored" type="checkbox" />
        {{ t('activity.ignore') }}
      </label>

      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
      <div class="flex justify-between text-sm">
        <button
          v-if="tx.manual && !isManualAccount"
          type="button"
          class="text-slate-500 underline"
          @click="auto"
        >
          {{ t('activity.backToAuto') }}
        </button>
        <button
          v-if="isManualAccount"
          type="button"
          class="text-rose-700 underline"
          @click="remove"
        >
          {{ t('common.delete') }}
        </button>
      </div>
    </form>
  </BottomSheet>
</template>
