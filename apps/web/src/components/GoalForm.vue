<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAmount } from '@hml/shared'
import { useAuthStore } from '@/stores/auth'
import { useHouseholdStore, type Goal } from '@/stores/household'

// Add or edit a goal. A secret goal is only visible to whoever made it.
const props = defineProps<{ goal: Goal | null }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const auth = useAuthStore()
const household = useHouseholdStore()

const str = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const g = props.goal
const form = reactive({
  name: g?.name ?? '',
  emoji: g?.emoji ?? '🎯',
  target: str(g?.target),
  saved: str(g?.saved ?? 0),
  monthly: str(g?.monthly_contribution ?? 0),
  targetDate: g?.target_date ?? '',
  secret: Boolean(g?.private_to),
})
const saving = ref(false)
const error = ref<string | null>(null)

/** The other person's name, to say exactly what they will and won't see. */
const partner = computed(
  () =>
    household.members.find((m) => m.user_id !== auth.userId)?.profile?.display_name ??
    t('goals.yourPartner'),
)

function amount(s: string, allowZero = false): number {
  const v = parseAmount(s)
  if (v === null || v < 0 || (!allowZero && v === 0)) throw new Error(t('common.badAmount'))
  return v
}

async function save() {
  saving.value = true
  error.value = null
  try {
    await household.save('goals', {
      ...(g ? { id: g.id } : {}),
      name: form.name.trim(),
      emoji: form.emoji || '🎯',
      target: amount(form.target),
      saved: amount(form.saved || '0', true),
      monthly_contribution: amount(form.monthly || '0', true),
      target_date: form.targetDate || null,
      private_to: form.secret ? auth.userId : null,
    })
    emit('done')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!g || !confirm(t('plan.deleteConfirm', { name: g.name }))) return
  saving.value = true
  try {
    await household.remove('goals', g.id)
    emit('done')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <div class="flex gap-3">
      <div class="w-20">
        <label class="label" for="g-emoji">{{ t('plan.emoji') }}</label>
        <input id="g-emoji" v-model="form.emoji" maxlength="4" class="input text-center" />
      </div>
      <div class="flex-1">
        <label class="label" for="g-name">{{ t('plan.name') }}</label>
        <input id="g-name" v-model="form.name" required maxlength="80" class="input" />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label" for="g-target">{{ t('plan.target') }}</label>
        <input id="g-target" v-model="form.target" required inputmode="decimal" class="input" />
      </div>
      <div>
        <label class="label" for="g-saved">{{ t('plan.saved') }}</label>
        <input id="g-saved" v-model="form.saved" inputmode="decimal" class="input" />
      </div>
      <div>
        <label class="label" for="g-monthly">{{ t('plan.monthly') }}</label>
        <input id="g-monthly" v-model="form.monthly" inputmode="decimal" class="input" />
      </div>
      <div>
        <label class="label" for="g-date">{{ t('plan.by') }}</label>
        <input id="g-date" v-model="form.targetDate" type="date" class="input" />
      </div>
    </div>

    <label class="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
      <input v-model="form.secret" type="checkbox" class="mt-1" data-testid="goal-secret" />
      <span>
        🔒 {{ t('goals.secret') }}
        <span class="block text-xs text-slate-500">
          {{ t('goals.secretHelp', { name: partner }) }}
        </span>
      </span>
    </label>

    <button type="submit" class="btn-primary w-full" :disabled="saving" data-testid="goal-save">
      {{ saving ? t('common.saving') : t('common.save') }}
    </button>
    <button v-if="g" type="button" class="btn-danger w-full" :disabled="saving" @click="remove">
      {{ t('common.delete') }}
    </button>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
  </form>
</template>
