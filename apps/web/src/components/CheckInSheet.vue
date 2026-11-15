<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAmount } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import BottomSheet from './BottomSheet.vue'

// Check in to an event: from now on until check-out, my charges can be added to it.
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const household = useHouseholdStore()

const EMOJIS = ['🎉', '🍺', '🍽️', '🏠', '🎬', '🎵', '⚽', '✈️', '🛍️', '🎂']

const name = ref('')
const emoji = ref('🎉')
const budget = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

/** Names used before, for a one-tap check-in to the usual places. */
const recent = computed(() => {
  const seen = new Map<string, string>()
  for (const e of household.events) if (!seen.has(e.name)) seen.set(e.name, e.emoji)
  return [...seen].slice(0, 6).map(([n, em]) => ({ name: n, emoji: em }))
})

async function save() {
  let value: number | null = null
  if (budget.value.trim()) {
    value = parseAmount(budget.value)
    if (value === null || value < 0) {
      error.value = t('common.badAmount')
      return
    }
  }
  saving.value = true
  error.value = null
  try {
    await household.checkIn({ name: name.value.trim(), emoji: emoji.value, budget: value })
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BottomSheet :title="t('events.checkIn')" @close="emit('close')">
    <p class="mb-4 text-sm text-slate-600">{{ t('events.checkInHelp') }}</p>
    <form class="space-y-4" @submit.prevent="save">
      <div v-if="recent.length" class="flex flex-wrap gap-2">
        <button
          v-for="r in recent"
          :key="r.name"
          type="button"
          class="rounded-full border border-slate-300 px-3 py-1 text-sm"
          @click="((name = r.name), (emoji = r.emoji))"
        >
          {{ r.emoji }} {{ r.name }}
        </button>
      </div>
      <div>
        <label class="label" for="event-name">{{ t('events.name') }}</label>
        <input
          id="event-name"
          v-model="name"
          required
          maxlength="80"
          class="input"
          :placeholder="t('events.namePlaceholder')"
          data-testid="event-name"
        />
      </div>
      <fieldset>
        <legend class="label">{{ t('events.emoji') }}</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="e in EMOJIS"
            :key="e"
            type="button"
            class="h-10 w-10 rounded-xl border text-xl"
            :class="emoji === e ? 'border-brand-700 bg-brand-50' : 'border-slate-200'"
            @click="emoji = e"
          >
            {{ e }}
          </button>
        </div>
      </fieldset>
      <div>
        <label class="label" for="event-budget">{{ t('events.budget') }}</label>
        <input
          id="event-budget"
          v-model="budget"
          inputmode="decimal"
          class="input"
          :placeholder="t('events.budgetPlaceholder')"
        />
      </div>
      <p v-if="household.myOpenEvent" class="text-sm text-amber-700">
        {{ t('events.closesOpen', { name: household.myOpenEvent.name }) }}
      </p>
      <button
        type="submit"
        class="btn-primary w-full"
        :disabled="saving || !name.trim()"
        data-testid="event-check-in"
      >
        {{ saving ? t('common.saving') : t('events.checkInNow') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>
  </BottomSheet>
</template>
