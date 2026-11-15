<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore, type Goal } from '@/stores/household'
import { isoToDate, money } from '@/lib/format'
import BottomSheet from '@/components/BottomSheet.vue'
import GoalForm from '@/components/GoalForm.vue'
import ProgressBar from '@/components/ProgressBar.vue'

// Savings goals. Shared ones both of you see; secret ones only whoever made them
// (the database hides them from the other person, see the secret_goals migration).
const { t, d } = useI18n()
const household = useHouseholdStore()
const cur = computed(() => household.currency)

/** null = closed, 'new' = adding, otherwise the goal being edited. */
const editing = ref<Goal | 'new' | null>(null)

const shared = computed(() => household.goals.filter((g) => !g.private_to))
const secret = computed(() => household.goals.filter((g) => g.private_to))
/** What this month sets aside: the same sum as the pocket's goals line. */
const thisMonth = computed(() => household.pocket.goals + household.pocket.privateGoals)

function monthsLeft(g: Goal): number | null {
  if (g.saved >= g.target || g.monthly_contribution <= 0) return null
  return Math.ceil((g.target - g.saved) / g.monthly_contribution)
}
</script>

<template>
  <main class="px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('goals.title') }}</h1>
      <button
        type="button"
        class="btn-secondary py-1.5"
        data-testid="goal-add"
        @click="editing = 'new'"
      >
        + {{ t('plan.addGoal') }}
      </button>
    </header>

    <section class="card mt-4 text-sm" data-testid="goals-summary">
      <p class="flex justify-between font-semibold">
        <span>{{ t('goals.thisMonth') }}</span>
        <span class="tabular-nums">{{ money(thisMonth, cur) }}</span>
      </p>
      <p
        v-if="household.pocket.privateGoals"
        class="mt-1 flex justify-between text-slate-500"
        data-testid="goals-private-line"
      >
        <span>🔒 {{ t('pocket.privateGoals') }}</span>
        <span class="tabular-nums">{{ money(household.pocket.privateGoals, cur) }}</span>
      </p>
      <p class="mt-2 text-xs text-slate-500">{{ t('plan.goalsHelp') }}</p>
    </section>

    <p v-if="!household.goals.length" class="mt-10 text-center text-slate-500">
      {{ t('goals.empty') }}
    </p>

    <template
      v-for="group in [
        { key: 'shared', goals: shared, title: t('goals.shared') },
        { key: 'secret', goals: secret, title: t('goals.onlyYou') },
      ]"
      :key="group.key"
    >
      <section v-if="group.goals.length" class="mt-6" :data-testid="`goals-${group.key}`">
        <h2 class="mb-2 font-semibold">
          <template v-if="group.key === 'secret'">🔒 </template>{{ group.title }}
        </h2>
        <ul class="space-y-3">
          <li v-for="g in group.goals" :key="g.id">
            <button
              type="button"
              class="card block w-full text-left"
              data-testid="goal-row"
              @click="editing = g"
            >
              <span class="flex justify-between gap-3 font-medium">
                <span class="truncate">{{ g.emoji }} {{ g.name }}</span>
                <span class="shrink-0 tabular-nums"
                  >{{ money(g.saved, cur) }} / {{ money(g.target, cur) }}</span
                >
              </span>
              <ProgressBar class="mt-2" :value="g.saved" :max="g.target" />
              <span class="mt-1 block text-xs text-slate-500">
                <template v-if="g.saved >= g.target">{{ t('plan.goalReached') }}</template>
                <template v-else>
                  {{ t('plan.perMonth', { amount: money(g.monthly_contribution, cur) }) }}
                  <template v-if="monthsLeft(g)">
                    · {{ t('goals.monthsLeft', monthsLeft(g)!) }}</template
                  >
                  <template v-if="g.target_date">
                    · {{ t('goals.by', { date: d(isoToDate(g.target_date), 'short') }) }}</template
                  >
                </template>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </template>

    <BottomSheet
      v-if="editing"
      :title="editing === 'new' ? t('plan.addGoal') : t('plan.edit.goal')"
      @close="editing = null"
    >
      <GoalForm :goal="editing === 'new' ? null : editing" @done="editing = null" />
    </BottomSheet>
  </main>
</template>
