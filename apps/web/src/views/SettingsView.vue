<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase, type Tables } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useHouseholdStore } from '@/stores/household'
import AppVersion from '@/components/AppVersion.vue'

const { t, d } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const household = useHouseholdStore()

const hhName = ref('')
const startDay = ref(1)
const displayName = ref('')
const savedHousehold = ref(false)
const savedName = ref(false)
const error = ref<string | null>(null)
const invites = ref<Tables<'household_invites'>[]>([])
const copied = ref<string | null>(null)

watchEffect(() => {
  if (household.household) {
    hhName.value = household.household.name
    startDay.value = household.household.period_start_day
  }
  if (auth.profile) displayName.value = auth.profile.display_name
})

async function loadInvites() {
  const { data } = await supabase
    .from('household_invites')
    .select('*')
    .eq('household_id', household.household!.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at')
  invites.value = data ?? []
}
onMounted(loadInvites)

async function saveHousehold() {
  error.value = null
  try {
    await household.updateHousehold({ name: hhName.value.trim(), period_start_day: startDay.value })
    savedHousehold.value = true
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function saveName() {
  error.value = null
  try {
    await auth.updateDisplayName(displayName.value.trim())
    savedName.value = true
  } catch (e) {
    error.value = (e as Error).message
  }
}

function inviteUrl(token: string) {
  return new URL(`${import.meta.env.BASE_URL}#/join/${token}`, window.location.origin).toString()
}

async function createInvite() {
  const { error: err } = await supabase
    .from('household_invites')
    .insert({ household_id: household.household!.id, created_by: auth.userId! })
  if (err) error.value = err.message
  await loadInvites()
}

async function share(token: string) {
  const url = inviteUrl(token)
  if (navigator.share) {
    await navigator
      .share({ title: 'HowMuchLeft', text: t('settings.inviteText'), url })
      .catch(() => {})
    return
  }
  await navigator.clipboard.writeText(url)
  copied.value = token
}

async function revoke(id: string) {
  await supabase.from('household_invites').delete().eq('id', id)
  await loadInvites()
}

async function signOut() {
  await auth.signOut()
  household.reset()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="space-y-8 px-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
    <h1 class="text-2xl font-bold">{{ t('settings.title') }}</h1>
    <p v-if="error" class="text-sm text-rose-700" role="alert">{{ error }}</p>

    <form class="card space-y-4" @submit.prevent="saveHousehold">
      <h2 class="font-semibold">{{ t('settings.household') }}</h2>
      <div>
        <label class="label" for="s-name">{{ t('setup.name') }}</label>
        <input
          id="s-name"
          v-model="hhName"
          required
          maxlength="100"
          class="input"
          @input="savedHousehold = false"
        />
      </div>
      <div>
        <label class="label" for="s-day">{{ t('settings.startDay') }}</label>
        <select id="s-day" v-model.number="startDay" class="input" @change="savedHousehold = false">
          <option v-for="n in 28" :key="n" :value="n">{{ n }}</option>
        </select>
        <p class="mt-1 text-xs text-slate-500">{{ t('settings.startDayHelp') }}</p>
      </div>
      <button type="submit" class="btn-primary w-full">
        {{ savedHousehold ? '✓' : t('common.save') }}
      </button>
    </form>

    <section class="card space-y-3">
      <h2 class="font-semibold">{{ t('settings.members') }}</h2>
      <ul class="space-y-1 text-sm">
        <li v-for="m in household.members" :key="m.user_id">
          {{ m.profile?.display_name }}
          <span v-if="m.user_id === auth.userId" class="text-slate-400"
            >({{ t('settings.you') }})</span
          >
        </li>
      </ul>
      <p class="text-sm text-slate-500">{{ t('settings.invitesHelp') }}</p>
      <ul class="space-y-2">
        <li v-for="i in invites" :key="i.id" class="flex items-center gap-2 text-sm">
          <span class="flex-1 text-slate-500">{{
            t('settings.expires', { date: d(new Date(i.expires_at), 'long') })
          }}</span>
          <button type="button" class="btn-secondary py-1.5" @click="share(i.token)">
            {{ copied === i.token ? t('common.copied') : t('common.share') }}
          </button>
          <button type="button" class="text-rose-700 underline" @click="revoke(i.id)">
            {{ t('settings.revoke') }}
          </button>
        </li>
      </ul>
      <button type="button" class="btn-secondary w-full" @click="createInvite">
        {{ t('settings.createInvite') }}
      </button>
    </section>

    <form class="card space-y-4" @submit.prevent="saveName">
      <h2 class="font-semibold">{{ t('account.title') }}</h2>
      <p class="text-sm text-slate-500">{{ auth.session?.user.email }}</p>
      <div>
        <label class="label" for="s-display">{{ t('account.displayName') }}</label>
        <input
          id="s-display"
          v-model="displayName"
          required
          maxlength="60"
          class="input"
          @input="savedName = false"
        />
      </div>
      <button type="submit" class="btn-primary w-full">
        {{ savedName ? '✓' : t('common.save') }}
      </button>
    </form>

    <AppVersion />
    <button type="button" class="btn-secondary w-full" @click="signOut">
      {{ t('auth.signOut') }}
    </button>
  </main>
</template>
