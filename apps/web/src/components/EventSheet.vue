<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { eventSpan, parseAmount } from '@hml/shared'
import { useAuthStore } from '@/stores/auth'
import { useHouseholdStore, type Transaction } from '@/stores/household'
import { fromLocalInput, isoToDate, money, toLocalInput } from '@/lib/format'
import BottomSheet from './BottomSheet.vue'
import ProgressBar from './ProgressBar.vue'

// One event: what's in it, charges from its days to add, and its details.
const props = defineProps<{ eventId: string }>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()
const auth = useAuthStore()
const household = useHouseholdStore()

const event = computed(() => household.events.find((e) => e.id === props.eventId) ?? null)
const span = computed(() => (event.value ? eventSpan(event.value, household.today) : null))
const total = computed(() => household.eventTotals.get(props.eventId))
const mine = computed(() => event.value?.created_by === auth.userId)
const who = computed(
  () =>
    household.members.find((m) => m.user_id === event.value?.created_by)?.profile?.display_name ??
    null,
)
const cur = computed(() => household.currency)

const inEvent = ref<Transaction[]>([])
const suggestions = ref<Transaction[]>([])
const picked = ref<Set<string>>(new Set())
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const editing = ref(false)

async function refresh() {
  if (!event.value) return
  const [tagged, candidates] = await Promise.all([
    household.eventTransactions(props.eventId),
    household.eventSuggestions(event.value),
  ])
  inEvent.value = tagged
  suggestions.value = candidates
  picked.value = new Set([...picked.value].filter((id) => candidates.some((c) => c.id === id)))
  loading.value = false
}
onMounted(refresh)
// A sync or the other person's change can bring new charges in.
watch(
  () => [household.transactions, event.value?.started_at, event.value?.ended_at],
  () => void refresh(),
)

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await fn()
    await refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function toggle(id: string) {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}
const allPicked = computed(
  () => suggestions.value.length > 0 && picked.value.size === suggestions.value.length,
)
function toggleAll() {
  picked.value = allPicked.value ? new Set() : new Set(suggestions.value.map((s) => s.id))
}

const addPicked = () =>
  run(async () => {
    await household.setEvent([...picked.value], props.eventId)
    picked.value = new Set()
  })
const takeOut = (id: string) => run(() => household.setEvent([id], null))
const checkOut = () => run(() => household.checkOut(props.eventId))

function label(tx: Transaction) {
  return tx.counterparty || tx.description || t('activity.noDescription')
}

// ---- details ----
const name = ref('')
const emoji = ref('')
const budget = ref('')
const startedAt = ref('')
const endedAt = ref('')
function startEdit() {
  const e = event.value!
  name.value = e.name
  emoji.value = e.emoji
  budget.value = e.budget === null ? '' : String(e.budget).replace('.', ',')
  startedAt.value = toLocalInput(e.started_at)
  endedAt.value = e.ended_at ? toLocalInput(e.ended_at) : ''
  editing.value = true
}

const saveEdit = () =>
  run(async () => {
    let value: number | null = null
    if (budget.value.trim()) {
      value = parseAmount(budget.value)
      if (value === null || value < 0) throw new Error(t('common.badAmount'))
    }
    if (endedAt.value && endedAt.value < startedAt.value)
      throw new Error(t('events.endBeforeStart'))
    await household.updateEvent(props.eventId, {
      name: name.value.trim(),
      emoji: emoji.value.trim() || '🎉',
      budget: value,
      started_at: fromLocalInput(startedAt.value),
      ended_at: endedAt.value ? fromLocalInput(endedAt.value) : null,
    })
    editing.value = false
  })

async function remove() {
  if (!confirm(t('events.deleteConfirm'))) return
  await household.deleteEvent(props.eventId)
  emit('close')
}
</script>

<template>
  <BottomSheet
    :title="event ? `${event.emoji} ${event.name}` : t('events.title')"
    @close="emit('close')"
  >
    <template v-if="event && span">
      <p class="text-sm text-slate-500" data-testid="event-when">
        <template v-if="span.open">
          {{ t('events.since', { time: d(new Date(event.started_at), 'dayTime') }) }}
        </template>
        <template v-else-if="span.from === span.to">
          {{ d(isoToDate(span.from), 'day') }}
        </template>
        <template v-else>
          {{ d(isoToDate(span.from), 'short') }} – {{ d(isoToDate(span.to), 'short') }}
        </template>
        <template v-if="who"> · {{ who }}</template>
      </p>
      <p v-if="span.autoClosed" class="mt-1 text-xs text-amber-700">
        {{ t('events.autoClosed') }}
      </p>

      <p class="mt-3 text-3xl font-bold tabular-nums" data-testid="event-total">
        {{ money(total?.spent ?? 0, cur) }}
        <span v-if="event.budget !== null" class="text-base font-normal text-slate-400">
          / {{ money(event.budget, cur) }}
        </span>
      </p>
      <template v-if="event.budget !== null && total">
        <ProgressBar class="mt-2" :value="total.spent" :max="event.budget" />
        <p class="mt-1 text-xs" :class="(total.left ?? 0) < 0 ? 'text-rose-600' : 'text-slate-500'">
          {{
            (total.left ?? 0) < 0
              ? t('pocket.over', { amount: money(-(total.left ?? 0), cur) })
              : t('pocket.left', { amount: money(total.left ?? 0, cur) })
          }}
        </p>
      </template>

      <button
        v-if="span.open && mine"
        type="button"
        class="btn-primary mt-4 w-full"
        :disabled="busy"
        data-testid="event-check-out"
        @click="checkOut"
      >
        {{ t('events.checkOut') }}
      </button>

      <p v-if="loading" class="mt-6 text-sm text-slate-500">{{ t('common.loading') }}</p>
      <template v-else>
        <section class="mt-6">
          <h3 class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {{ t('events.inEvent', { n: inEvent.length }) }}
          </h3>
          <p v-if="!inEvent.length" class="text-sm text-slate-500">{{ t('events.nothingYet') }}</p>
          <ul v-else class="card divide-y divide-slate-100 p-0">
            <li v-for="tx in inEvent" :key="tx.id" class="flex items-center gap-3 px-4 py-2.5">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ label(tx) }}</span>
                <span class="block text-xs text-slate-500">
                  {{ d(isoToDate(tx.booked_on), 'short') }} ·
                  {{ household.accountById.get(tx.account_id)?.name }}
                </span>
              </span>
              <span class="shrink-0 text-sm font-semibold tabular-nums">
                {{ tx.amount > 0 ? '+' : '' }}{{ money(tx.amount, tx.currency) }}
              </span>
              <button
                type="button"
                class="shrink-0 px-1 text-lg leading-none text-slate-400 hover:text-rose-600"
                :aria-label="t('events.takeOut')"
                :disabled="busy"
                @click="takeOut(tx.id)"
              >
                ×
              </button>
            </li>
          </ul>
        </section>

        <section class="mt-6" data-testid="event-suggestions">
          <div class="mb-1 flex items-center justify-between">
            <h3 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {{ t('events.suggestions') }}
            </h3>
            <button
              v-if="suggestions.length > 1"
              type="button"
              class="text-xs text-brand-700"
              @click="toggleAll"
            >
              {{ allPicked ? t('events.pickNone') : t('events.pickAll') }}
            </button>
          </div>
          <p class="mb-2 text-xs text-slate-500">
            {{
              who ? t('events.suggestionsHelp', { name: who }) : t('events.suggestionsHelpNoOne')
            }}
          </p>
          <p v-if="!suggestions.length" class="text-sm text-slate-500">
            {{ t('events.noSuggestions') }}
          </p>
          <ul v-else class="card divide-y divide-slate-100 p-0">
            <li v-for="tx in suggestions" :key="tx.id">
              <label class="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  :checked="picked.has(tx.id)"
                  data-testid="event-suggestion"
                  @change="toggle(tx.id)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ label(tx) }}</span>
                  <span class="block text-xs text-slate-500">
                    {{ d(isoToDate(tx.booked_on), 'short') }} ·
                    {{ household.accountById.get(tx.account_id)?.name }}
                    <template v-if="tx.status === 'pending'">
                      · {{ t('activity.pending') }}</template
                    >
                  </span>
                </span>
                <span class="shrink-0 text-sm tabular-nums">
                  {{ tx.amount > 0 ? '+' : '' }}{{ money(tx.amount, tx.currency) }}
                </span>
              </label>
            </li>
          </ul>
          <button
            v-if="picked.size"
            type="button"
            class="btn-primary mt-3 w-full"
            :disabled="busy"
            data-testid="event-add-picked"
            @click="addPicked"
          >
            {{ t('events.addPicked', picked.size) }}
          </button>
        </section>
      </template>

      <section class="mt-8">
        <button
          v-if="!editing"
          type="button"
          class="text-sm text-slate-500 underline"
          @click="startEdit"
        >
          {{ t('events.edit') }}
        </button>
        <form v-else class="space-y-4" @submit.prevent="saveEdit">
          <div class="grid grid-cols-[4rem_1fr] gap-3">
            <div>
              <label class="label" for="ev-emoji">{{ t('events.emoji') }}</label>
              <input id="ev-emoji" v-model="emoji" maxlength="8" class="input text-center" />
            </div>
            <div>
              <label class="label" for="ev-name">{{ t('events.name') }}</label>
              <input id="ev-name" v-model="name" required maxlength="80" class="input" />
            </div>
          </div>
          <div>
            <label class="label" for="ev-budget">{{ t('events.budget') }}</label>
            <input id="ev-budget" v-model="budget" inputmode="decimal" class="input" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="ev-start">{{ t('events.checkedIn') }}</label>
              <input
                id="ev-start"
                v-model="startedAt"
                type="datetime-local"
                required
                class="input"
              />
            </div>
            <div>
              <label class="label" for="ev-end">{{ t('events.checkedOut') }}</label>
              <input id="ev-end" v-model="endedAt" type="datetime-local" class="input" />
            </div>
          </div>
          <button type="submit" class="btn-primary w-full" :disabled="busy">
            {{ busy ? t('common.saving') : t('common.save') }}
          </button>
          <div class="flex justify-between text-sm">
            <button type="button" class="text-slate-500 underline" @click="editing = false">
              {{ t('common.cancel') }}
            </button>
            <button type="button" class="text-rose-700 underline" @click="remove">
              {{ t('events.delete') }}
            </button>
          </div>
        </form>
      </section>
      <p v-if="error" class="mt-3 text-sm text-rose-700" role="alert">{{ error }}</p>
    </template>
  </BottomSheet>
</template>
