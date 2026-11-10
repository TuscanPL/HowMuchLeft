<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const tabs = [
  { name: 'pocket', icon: '👛' },
  { name: 'activity', icon: '🧾' },
  { name: 'plan', icon: '🗓️' },
  { name: 'banks', icon: '🏦' },
  { name: 'settings', icon: '⚙️' },
] as const
</script>

<template>
  <div class="mx-auto min-h-dvh max-w-2xl pb-24">
    <RouterView />
    <nav
      class="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul class="mx-auto flex max-w-2xl">
        <li v-for="tab in tabs" :key="tab.name" class="flex-1">
          <RouterLink
            :to="{ name: tab.name }"
            class="flex flex-col items-center gap-0.5 py-2 text-xs text-slate-500"
            active-class="!text-brand-700 font-semibold"
            exact-active-class="!text-brand-700 font-semibold"
            :data-testid="`tab-${tab.name}`"
          >
            <span class="text-xl leading-none" aria-hidden="true">{{ tab.icon }}</span>
            {{ t(`nav.${tab.name}`) }}
          </RouterLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
