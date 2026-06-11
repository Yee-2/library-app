<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const tabs = [
  { to: '/',         label: '首页', icon: '🏠' },
  { to: '/library',  label: '书架', icon: '📚' },
  { to: '/community',label: '社区', icon: '🌐' },
  { to: '/me',       label: '我的', icon: '👤' },
]

const activeIndex = computed(() => {
  const i = tabs.findIndex(t => route.path === t.to || (t.to !== '/' && route.path.startsWith(t.to)))
  return i === -1 ? 0 : i
})
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
    <div class="max-w-3xl mx-auto grid grid-cols-4">
      <RouterLink
        v-for="(t, i) in tabs"
        :key="t.to"
        :to="t.to"
        class="flex flex-col items-center justify-center gap-0.5 py-2 text-xs transition"
        :class="activeIndex === i ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'"
      >
        <span class="text-xl leading-none">{{ t.icon }}</span>
        <span class="leading-none">{{ t.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>