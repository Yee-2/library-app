<script setup lang="ts">
/**
 * ToastHost - 全局通知展示
 * - 玻璃面板 + 紫粉边框 + 顶部彩色条
 * - 错落入场
 */
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-vue-next'
import { toast } from '@/lib/toast'
import type { Component } from 'vue'

const ICON: Record<string, Component> = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
  warn:    AlertTriangle,
}

const COLOR: Record<string, string> = {
  success: 'text-emerald-500',
  error:   'text-rose-500',
  info:    'text-sky-500',
  warn:    'text-amber-500',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      <TransitionGroup
        enter-active-class="transition duration-300"
        leave-active-class="transition duration-200"
        enter-from-class="opacity-0 -translate-y-2 scale-95"
        leave-to-class="opacity-0 scale-95"
        tag="div"
        class="flex flex-col items-center gap-2"
      >
        <div
          v-for="t in toast.items.value"
          :key="t.id"
          class="pointer-events-auto glass-panel rounded-2xl px-4 py-2.5 flex items-center gap-2
                 min-w-[200px] max-w-[420px] shadow-2xl
                 border border-primary-200"
        >
          <component :is="ICON[t.kind]" class="w-4 h-4 flex-shrink-0" :class="COLOR[t.kind]" :stroke-width="2" />
          <span class="text-sm text-ink-900-50 flex-1 leading-snug">{{ t.message }}</span>
          <button
            @click="toast.remove(t.id)"
            class="text-ink-300 hover:text-ink-900-50 transition -mr-1"
          >
            <X class="w-3.5 h-3.5" :stroke-width="1.75" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>