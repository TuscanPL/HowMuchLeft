<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useHouseholdStore } from '@/stores/household'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const household = useHouseholdStore()
const auth = useAuthStore()

const name = ref(t('setup.defaultName'))
const startDay = ref(1)
const saving = ref(false)
const error = ref<string | null>(null)

async function create() {
  saving.value = true
  error.value = null
  try {
    await household.createHousehold(name.value.trim(), startDay.value)
    await router.replace({ name: 'banks' })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function signOut() {
  await auth.signOut()
  household.reset()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
    <h1 class="text-2xl font-bold">{{ t('setup.title') }}</h1>
    <p class="mt-2 text-slate-600">{{ t('setup.intro') }}</p>

    <form class="mt-6 space-y-4" @submit.prevent="create">
      <div>
        <label class="label" for="hh-name">{{ t('setup.name') }}</label>
        <input id="hh-name" v-model="name" required maxlength="100" class="input" />
      </div>
      <div>
        <label class="label" for="start-day">{{ t('settings.startDay') }}</label>
        <select id="start-day" v-model.number="startDay" class="input">
          <option v-for="d in 28" :key="d" :value="d">{{ d }}</option>
        </select>
        <p class="mt-1 text-xs text-slate-500">{{ t('settings.startDayHelp') }}</p>
      </div>
      <button type="submit" class="btn-primary w-full" :disabled="saving">
        {{ t('setup.create') }}
      </button>
      <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>
    </form>

    <p class="mt-8 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{{ t('setup.joinHint') }}</p>
    <button type="button" class="mt-6 text-sm text-slate-500 underline" @click="signOut">
      {{ t('auth.signOut') }}
    </button>
  </main>
</template>
