<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'
import { Home, BookOpen, Users, User } from 'lucide-vue-next'

const route = useRoute()

const tabs = [
  { to: '/',          label: '首页', icon: Home },
  { to: '/library',   label: '书架', icon: BookOpen },
  { to: '/community', label: '社区', icon: Users },
  { to: '/me',        label: '我的', icon: User },
]

const activeIndex = computed(() => {
  const i = tabs.findIndex(t => route.path === t.to || (t.to !== '/' && route.path.startsWith(t.to)))
  return i === -1 ? 0 : i
})
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-30 glass-panel border-t border-neon-purple/25 pb-[env(safe-area-inset-bottom)]">
    <div class="max-w-3xl mx-auto grid grid-cols-4 px-2">
      <RouterLink
        v-for="(t, i) in tabs"
        :key="t.to"
        :to="t.to"
        class="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-all duration-200"
        :class="activeIndex === i
          ? 'text-neon-purple'
          : 'text-ink-300 hover:text-ink-100'"
      >
        <span
          class="w-9 h-9 flex items-center justify-center rounded-2xl transition-all duration-200"
          :class="activeIndex === i
            ? 'bg-neon-purple/20 shadow-[0_0_18px_rgba(168,85,247,0.45)]'
            : ''"
        >
          <component :is="t.icon" :stroke-width="activeIndex === i ? 2.25 : 1.75" class="w-5 h-5" />
        </span>
        <span class="leading-none">{{ t.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
