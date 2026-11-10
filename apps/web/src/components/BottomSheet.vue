<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

// A panel that slides up from the bottom on phones and sits centred on wide screens.
defineProps<{ title?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center">
      <div class="absolute inset-0 bg-slate-900/40" @click="emit('close')" />
      <section
        role="dialog"
        aria-modal="true"
        class="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
      >
        <header class="mb-4 flex items-center gap-3">
          <h2 class="flex-1 text-lg font-semibold">{{ title }}</h2>
          <button
            type="button"
            class="rounded-full px-2 text-2xl leading-none text-slate-400 hover:text-slate-600"
            aria-label="Close"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
