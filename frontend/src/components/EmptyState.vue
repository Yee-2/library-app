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
      class="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary-200 to-accent-200
             border border-primary-200 flex items-center justify-center mb-4
             shadow-lg"
    >
      <component :is="icon" class="w-10 h-10 text-primary-600/80" :stroke-width="1.5" />
    </div>
    <h3 class="text-base font-semibold text-ink-600">{{ title }}</h3>
    <p v-if="description" class="text-sm text-ink-300 mt-1.5 max-w-xs">{{ description }}</p>
    <button
      v-if="actionLabel"
      @click="onAction"
      class="mt-5 inline-flex items-center justify-center h-10 px-5 rounded-xl
             bg-gradient-to-r from-primary-600 to-accent-600 text-white text-sm font-medium
             shadow-lg hover:shadow-md transition-all"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>
