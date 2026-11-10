<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number; max: number }>()
const pct = computed(() =>
  props.max > 0 ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0,
)
const tone = computed(() =>
  props.value > props.max ? 'bg-rose-500' : pct.value >= 85 ? 'bg-amber-500' : 'bg-brand-500',
)
</script>

<template>
  <div class="h-2 overflow-hidden rounded-full bg-slate-100">
    <div class="h-full rounded-full transition-all" :class="tone" :style="{ width: `${pct}%` }" />
  </div>
</template>
