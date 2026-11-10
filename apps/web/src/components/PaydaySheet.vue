<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { budgetPeriod, dayInMonth, fromIso } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import { isoToDate } from '@/lib/format'
import BottomSheet from './BottomSheet.vue'

// "Payday!": the salary came early or late, so start the new budget month that
// day. It replaces the usual start day of that month (within 15 days of it).
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()
const household = useHouseholdStore()

const date = ref(household.today)
const saving = ref(false)
const error = ref<string | null>(null)
const startDay = computed(() => household.household?.period_start_day ?? 1)

/** The month as it would run with this payday. */
const preview = computed(() => {
  if (!date.value) return null
  return budgetPeriod(date.value, startDay.value, 0, [...household.paydays, date.value])
})

/** The usual start day this payday replaces. */
const usual = computed(() => {
  if (!date.value) return null
  const p = fromIso(date.value)
  const candidates = [-1, 0, 1].map((m) =>
    dayInMonth(p.getUTCFullYear(), p.getUTCMonth() + m, startDay.value),
  )
  return candidates.reduce((best, c) =>
    Math.abs(fromIso(c).getTime() - p.getTime()) < Math.abs(fromIso(best).getTime() - p.getTime())
      ? c
      : best,
  )
})

/** Paydays pressed for the current month or recently, which can be taken back. */
const recent = computed(() => household.paydays.slice(-3).reverse())

async function save() {
  saving.value = true
  error.value = null
  try {
    await household.markPayday(date.value)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function undo(day: string) {
  error.value = null
  try {
    await household.unmarkPayday(day)
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <BottomSheet :title="t('payday.title')" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <p class="text-sm text-slate-600">{{ t('payday.intro') }}</p>
      <div>
        <label class="label" for="payday-date">{{ t('payday.date') }}</label>
        <input id="payday-date" v-model="date" type="date" required class="input" />
      </div>
      <p
        v-if="preview && usual"
        class="rounded-xl bg-slate-100 p-3 text-sm text-slate-700"
        data-testid="payday-preview"
      >
        {{
          t('payday.preview', {
            start: d(isoToDate(preview.start), 'short'),
            end: d(isoToDate(preview.end), 'short'),
            usual: d(isoToDate(usual), 'short'),
          })
        }}
      </p>
      <button type="submit" class="btn-primary w-full" :disabled="saving || !date">
        {{ t('payday.confirm') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>

    <section v-if="recent.length" class="mt-6">
      <h3 class="mb-1 text-sm font-semibold text-slate-700">{{ t('payday.marked') }}</h3>
      <ul class="divide-y divide-slate-100 text-sm">
        <li v-for="p in recent" :key="p" class="flex items-center justify-between py-2">
          <span>{{ d(isoToDate(p), 'day') }}</span>
          <button type="button" class="text-rose-700 underline" @click="undo(p)">
            {{ t('payday.undo') }}
          </button>
        </li>
      </ul>
    </section>
  </BottomSheet>
</template>
