<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { budgetPeriod, paydayNear } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import { useAuthStore } from '@/stores/auth'
import { isoToDate } from '@/lib/format'
import BottomSheet from './BottomSheet.vue'

// "Payday!": the salary came early or late, so start the new budget month that
// day. It replaces the usual start day of that month (within 15 days of it).
// There's one payday per month for the whole budget: if the other person
// already pressed it, this shows their day and offers to move it instead.
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()
const household = useHouseholdStore()
const auth = useAuthStore()

const date = ref(household.today)
const saving = ref(false)
const error = ref<string | null>(null)

/** A payday already marked for the month this date falls in. */
const existing = computed(() =>
  date.value ? paydayNear(household.paydays, date.value) : undefined,
)
const existingBy = computed(() => {
  if (!existing.value) return null
  const row = household.paydays.includes(existing.value) ? household.paydayBy(existing.value) : null
  return row === auth.profile?.display_name ? t('payday.you') : row
})

const others = computed(() => household.paydays.filter((p) => p !== existing.value))

/** The month as it would run with this payday (replacing the existing one, if any). */
const preview = computed(() => {
  if (!date.value) return null
  return budgetPeriod(date.value, { ...household.plan, paydays: [...others.value, date.value] })
})

/** The same month without this payday: when it would start otherwise, and why. */
const without = computed(() =>
  preview.value
    ? budgetPeriod(preview.value.end, { ...household.plan, paydays: others.value })
    : null,
)
const usual = computed(() => without.value?.start ?? null)

/** A salary already arrived and started this month on or before that day: pressing changes nothing. */
const salaryStart = computed(() => {
  const w = without.value
  if (!w || !date.value || w.start > date.value) return null
  const reason = household.startReason(w)
  return reason?.kind === 'salary' ? { date: w.start, income: reason.income } : null
})

/** Recent paydays, which can be taken back. */
const recent = computed(() => household.paydays.slice(-3).reverse())

async function save(move: boolean) {
  saving.value = true
  error.value = null
  try {
    const r = await household.markPayday(date.value, move)
    // Not created: the other person pressed it at the same moment; the sheet
    // now shows their day, so let this person decide again.
    if (r.created || r.starts_on === date.value) emit('close')
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
    <form class="space-y-4" @submit.prevent="save(false)">
      <p class="text-sm text-slate-600">{{ t('payday.intro') }}</p>
      <div>
        <label class="label" for="payday-date">{{ t('payday.date') }}</label>
        <input id="payday-date" v-model="date" type="date" required class="input" />
      </div>

      <template v-if="salaryStart">
        <p class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" data-testid="payday-already">
          {{
            t('payday.alreadySalary', {
              date: d(isoToDate(salaryStart.date), 'day'),
              income: salaryStart.income,
            })
          }}
        </p>
        <button type="button" class="btn-primary w-full" @click="emit('close')">
          {{ t('payday.ok') }}
        </button>
      </template>

      <template v-else-if="existing && existing === date">
        <p class="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" data-testid="payday-already">
          {{ t('payday.alreadyThatDay', { by: existingBy ?? '?' }) }}
        </p>
        <button type="button" class="btn-primary w-full" @click="emit('close')">
          {{ t('payday.ok') }}
        </button>
      </template>

      <template v-else-if="existing">
        <p class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="payday-already">
          {{
            t('payday.already', {
              date: d(isoToDate(existing), 'day'),
              by: existingBy ?? '?',
            })
          }}
        </p>
        <button type="button" class="btn-primary w-full" @click="emit('close')">
          {{ t('payday.keep', { date: d(isoToDate(existing), 'short') }) }}
        </button>
        <button
          type="button"
          class="btn-secondary w-full"
          :disabled="saving || !date"
          data-testid="payday-move"
          @click="save(true)"
        >
          {{ t('payday.move', { date: d(isoToDate(date), 'short') }) }}
        </button>
        <p v-if="preview" class="text-xs text-slate-500">
          {{
            t('payday.movePreview', {
              start: d(isoToDate(preview.start), 'short'),
              end: d(isoToDate(preview.end), 'short'),
            })
          }}
        </p>
      </template>

      <template v-else>
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
      </template>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>

    <section v-if="recent.length" class="mt-6">
      <h3 class="mb-1 text-sm font-semibold text-slate-700">{{ t('payday.marked') }}</h3>
      <ul class="divide-y divide-slate-100 text-sm">
        <li v-for="p in recent" :key="p" class="flex items-center justify-between py-2">
          <span>
            {{ d(isoToDate(p), 'day') }}
            <span v-if="household.paydayBy(p)" class="text-slate-400"
              >· {{ household.paydayBy(p) }}</span
            >
          </span>
          <button type="button" class="text-rose-700 underline" @click="undo(p)">
            {{ t('payday.undo') }}
          </button>
        </li>
      </ul>
    </section>
  </BottomSheet>
</template>
