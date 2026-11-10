<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { bankApi } from '@/lib/bank'
import { useHouseholdStore } from '@/stores/household'

// The bank sent the person back (via bank-callback.html) with ?code&state, or ?error.
const { t } = useI18n()
const route = useRoute()
const household = useHouseholdStore()

const state = ref<'working' | 'done' | 'failed'>('working')
const message = ref('')

onMounted(async () => {
  const code = route.query.code as string | undefined
  const st = route.query.state as string | undefined
  const err = (route.query.error_description ?? route.query.error) as string | undefined
  if (err || !code || !st) {
    state.value = 'failed'
    message.value = err ?? t('banks.callback.missing')
    return
  }
  try {
    const r = await bankApi.complete(code, st)
    message.value = t('banks.callback.accounts', { n: r.accounts }, r.accounts)
    state.value = 'done'
    await household.reload()
  } catch (e) {
    state.value = 'failed'
    message.value = (e as Error).message
  }
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12 text-center">
    <p class="text-5xl">{{ state === 'working' ? '⏳' : state === 'done' ? '✅' : '⚠️' }}</p>
    <h1 class="mt-4 text-xl font-bold">{{ t(`banks.callback.${state}`) }}</h1>
    <p v-if="message" class="mt-2 text-slate-600" data-testid="callback-message">{{ message }}</p>
    <RouterLink
      v-if="state !== 'working'"
      :to="{ name: state === 'done' ? 'pocket' : 'banks' }"
      class="btn-primary mt-8"
    >
      {{ state === 'done' ? t('banks.callback.open') : t('banks.callback.back') }}
    </RouterLink>
  </main>
</template>
