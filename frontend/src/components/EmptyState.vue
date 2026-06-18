<script setup lang="ts">
/**
 * EmptyState - 空状态展示
 * - 居中布局
 * - icon 在霓虹圆背景里
 */
import { useRouter } from 'vue-router'
import type { Component } from 'vue'

const props = defineProps<{
  icon?: Component
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
  /** 留白大小 */
  size?: 'sm' | 'md' | 'lg'
}>()

const router = useRouter()

function onAction() {
  if (props.actionTo) router.push(props.actionTo)
}

const paddingClass = ({ sm: 'py-8', md: 'py-12', lg: 'py-16' } as const)[props.size ?? 'md']
</script>

<template>
  <div :class="['flex flex-col items-center justify-center text-center', paddingClass]">
    <div
      v-if="icon"
      class="w-20 h-20 rounded-3xl bg-gradient-to-br from-neon-purple/30 to-neon-pink/20
             border border-neon-purple/30 flex items-center justify-center mb-4
             shadow-[0_0_30px_rgba(168,85,247,0.3)]"
    >
      <component :is="icon" class="w-10 h-10 text-neon-purple/80" :stroke-width="1.5" />
    </div>
    <h3 class="text-base font-semibold text-ink-100">{{ title }}</h3>
    <p v-if="description" class="text-sm text-ink-300 mt-1.5 max-w-xs">{{ description }}</p>
    <button
      v-if="actionLabel"
      @click="onAction"
      class="mt-5 inline-flex items-center justify-center h-10 px-5 rounded-xl
             bg-gradient-to-r from-neon-purple to-neon-pink text-white text-sm font-medium
             shadow-lg hover:shadow-[0_0_24px_rgba(168,85,247,0.5)] transition-all"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>
