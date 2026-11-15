<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore } from '@/stores/household'
import { money } from '@/lib/format'
import CheckInSheet from './CheckInSheet.vue'
import EventSheet from './EventSheet.vue'

// On the Pocket screen: check in to an event, or see the one I'm at and check out.
const { t, d } = useI18n()
const household = useHouseholdStore()

const open = computed(() => household.myOpenEvent)
const total = computed(() => (open.value ? household.eventTotals.get(open.value.id) : undefined))
const checkingIn = ref(false)
const showing = ref<string | null>(null)

/** Check out, then show the event so its charges can be picked. */
async function checkOut(id: string) {
  await household.checkOut(id)
  showing.value = id
}
</script>

<template>
  <section class="card mt-4" data-testid="event-card">
    <template v-if="open">
      <button
        type="button"
        class="flex w-full items-center gap-3 text-left"
        @click="showing = open.id"
      >
        <span class="text-2xl" aria-hidden="true">{{ open.emoji }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-semibold">{{
            t('events.at', { name: open.name })
          }}</span>
          <span class="block text-xs text-slate-500">
            {{ t('events.since', { time: d(new Date(open.started_at), 'time') }) }} ·
            {{ money(total?.spent ?? 0, household.currency) }}
            <template v-if="open.budget !== null">
              / {{ money(open.budget, household.currency) }}</template
            >
          </span>
        </span>
        <span class="text-slate-400" aria-hidden="true">›</span>
      </button>
      <button
        type="button"
        class="btn-secondary mt-3 w-full"
        data-testid="card-check-out"
        @click="checkOut(open.id)"
      >
        {{ t('events.checkOut') }}
      </button>
    </template>
    <div v-else class="flex items-center gap-3">
      <button
        type="button"
        class="btn-secondary flex-1"
        data-testid="card-check-in"
        @click="checkingIn = true"
      >
        🎉 {{ t('events.checkIn') }}
      </button>
      <RouterLink :to="{ name: 'events' }" class="text-sm text-brand-700">
        {{ t('events.all') }}
      </RouterLink>
    </div>

    <CheckInSheet v-if="checkingIn" @close="checkingIn = false" />
    <EventSheet v-if="showing" :event-id="showing" @close="showing = null" />
  </section>
</template>
