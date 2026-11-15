<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { eventSpan } from '@hml/shared'
import { useHouseholdStore } from '@/stores/household'
import { isoToDate, money } from '@/lib/format'
import CheckInSheet from '@/components/CheckInSheet.vue'
import EventSheet from '@/components/EventSheet.vue'

// Every event, newest first, with what each one cost.
const { t, d } = useI18n()
const household = useHouseholdStore()

const checkingIn = ref(false)
const showing = ref<string | null>(null)
const cur = computed(() => household.currency)

const rows = computed(() =>
  household.events.map((e) => ({
    event: e,
    span: eventSpan(e, household.today),
    total: household.eventTotals.get(e.id),
    who: household.members.find((m) => m.user_id === e.created_by)?.profile?.display_name ?? null,
  })),
)
</script>

<template>
  <main class="px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <header class="flex items-center justify-between gap-3">
      <RouterLink
        :to="{ name: 'pocket' }"
        class="text-xl text-slate-500"
        :aria-label="t('common.back')"
        >‹</RouterLink
      >
      <h1 class="flex-1 text-2xl font-bold">{{ t('events.title') }}</h1>
      <button
        v-if="!household.myOpenEvent"
        type="button"
        class="btn-secondary py-1.5"
        @click="checkingIn = true"
      >
        🎉 {{ t('events.checkIn') }}
      </button>
    </header>

    <p v-if="!rows.length" class="mt-10 text-center text-slate-500">{{ t('events.empty') }}</p>

    <ul v-else class="card mt-5 divide-y divide-slate-100 p-0">
      <li v-for="r in rows" :key="r.event.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-left"
          data-testid="event-row"
          @click="showing = r.event.id"
        >
          <span class="text-2xl" aria-hidden="true">{{ r.event.emoji }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ r.event.name }}</span>
            <span class="block truncate text-xs text-slate-500">
              <template v-if="r.span.open">{{ t('events.now') }}</template>
              <template v-else>{{ d(isoToDate(r.span.from), 'short') }}</template>
              <template v-if="r.who"> · {{ r.who }}</template>
              · {{ t('events.count', r.total?.count ?? 0) }}
            </span>
          </span>
          <span class="shrink-0 text-right tabular-nums">
            <span
              class="block font-semibold"
              :class="(r.total?.left ?? 0) < 0 ? 'text-rose-600' : ''"
              >{{ money(r.total?.spent ?? 0, cur) }}</span
            >
            <span v-if="r.event.budget !== null" class="block text-xs text-slate-400">
              / {{ money(r.event.budget, cur) }}
            </span>
          </span>
        </button>
      </li>
    </ul>

    <CheckInSheet v-if="checkingIn" @close="checkingIn = false" />
    <EventSheet v-if="showing" :event-id="showing" @close="showing = null" />
  </main>
</template>
