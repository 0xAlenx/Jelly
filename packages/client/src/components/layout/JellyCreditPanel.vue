<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fetchJellyAccountState, type JellyAccountState } from '@/api/jelly'

const account = ref<JellyAccountState | null>(null)
const unavailable = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const balance = computed(() => account.value ? account.value.creditsBalance.toLocaleString('zh-CN') : '--')
const today = computed(() => account.value ? account.value.creditsToday.toLocaleString('zh-CN') : '--')

async function refresh() {
  try {
    account.value = await fetchJellyAccountState()
    unavailable.value = false
  } catch {
    account.value = null
    unavailable.value = true
  }
}

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(refresh, 15_000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <section class="jelly-credit-panel" :class="{ unavailable }">
    <div>
      <span>剩余积分</span>
      <strong>{{ balance }}</strong>
    </div>
    <div>
      <span>今日消耗</span>
      <strong>{{ today }}</strong>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.jelly-credit-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 8px 0;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  div {
    min-width: 0;
  }

  span {
    display: block;
    color: $text-muted;
    font-size: 11px;
  }

  strong {
    display: block;
    margin-top: 4px;
    color: $text-primary;
    font-size: 16px;
  }

  &.unavailable strong {
    color: $text-muted;
  }
}
</style>
