<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAmount } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import BottomSheet from './BottomSheet.vue'

// Cash spending (or anything the banks don't show) typed in by hand.
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const household = useHouseholdStore()

const manualAccounts = computed(() => household.accounts.filter((a) => !a.external_uid))
const accountId = ref(manualAccounts.value[0]?.id ?? '')
const amount = ref('')
const direction = ref<'out' | 'in'>('out')
const description = ref('')
const bookedOn = ref(household.today)
const categoryId = ref<string | null>(null)
// Cash paid while checked in goes to that event unless changed.
const eventId = ref<string>(household.myOpenEvent?.id ?? '')
const saving = ref(false)
const error = ref<string | null>(null)

async function save() {
  const value = parseAmount(amount.value)
  if (value === null || value === 0) {
    error.value = t('common.badAmount')
    return
  }
  saving.value = true
  error.value = null
  try {
    const account = accountId.value || (await household.cashAccount()).id
    await household.addManualTransaction({
      accountId: account,
      bookedOn: bookedOn.value,
      amount: direction.value === 'out' ? -Math.abs(value) : Math.abs(value),
      description: description.value.trim(),
      categoryId: categoryId.value,
      eventId: eventId.value || null,
    })
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BottomSheet :title="t('activity.addCash')" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <div class="flex gap-2">
        <button
          v-for="dir in ['out', 'in'] as const"
          :key="dir"
          type="button"
          class="flex-1 rounded-xl border py-2 text-sm"
          :class="
            direction === dir ? 'border-brand-700 bg-brand-50 font-semibold' : 'border-slate-200'
          "
          @click="direction = dir"
        >
          {{ t(`activity.direction.${dir}`) }}
        </button>
      </div>
      <div>
        <label class="label" for="add-amount">{{ t('common.amount') }}</label>
        <input
          id="add-amount"
          v-model="amount"
          inputmode="decimal"
          required
          class="input"
          placeholder="25,50"
        />
      </div>
      <div>
        <label class="label" for="add-desc">{{ t('activity.what') }}</label>
        <input id="add-desc" v-model="description" required maxlength="120" class="input" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="add-date">{{ t('common.date') }}</label>
          <input id="add-date" v-model="bookedOn" type="date" required class="input" />
        </div>
        <div>
          <label class="label" for="add-account">{{ t('activity.account') }}</label>
          <select id="add-account" v-model="accountId" class="input">
            <option v-if="!manualAccounts.some((a) => a.name === 'Cash')" value="">Cash</option>
            <option v-for="a in manualAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="label" for="add-cat">{{ t('activity.category') }}</label>
        <select id="add-cat" v-model="categoryId" class="input">
          <option :value="null">{{ t('common.uncategorised') }}</option>
          <option v-for="c in household.categories" :key="c.id" :value="c.id">
            {{ c.emoji }} {{ c.name }}
          </option>
        </select>
      </div>
      <div v-if="household.events.length">
        <label class="label" for="add-event">{{ t('events.event') }}</label>
        <select id="add-event" v-model="eventId" class="input">
          <option value="">{{ t('events.noEvent') }}</option>
          <option v-for="e in household.events" :key="e.id" :value="e.id">
            {{ e.emoji }} {{ e.name }}
          </option>
        </select>
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>
  </BottomSheet>
</template>
