<script setup lang="ts">
/**
 * Skeleton - 骨架屏组件
 * - 复用 .skeleton shimmer 动画
 * - 支持 text/circle/rect/card 四种变体
 */
import { computed } from 'vue'

type Variant = 'text' | 'circle' | 'rect' | 'card'

const props = withDefaults(defineProps<{
  variant?: Variant
  width?: string
  height?: string
  rows?: number
  rounded?: string
}>(), {
  variant: 'text',
  rows: 1,
})

const style = computed(() => ({
  width: props.width || (props.variant === 'circle' ? '40px' : '100%'),
  height: props.height || (props.variant === 'text' ? '12px' : props.variant === 'circle' ? '40px' : '80px'),
  borderRadius: props.rounded || (props.variant === 'circle' ? '50%' : '0.5rem'),
}))

const rows = computed(() => Array.from({ length: props.rows }, (_, i) => i))
</script>

<template>
  <template v-if="variant === 'text' && rows > 1">
    <div class="space-y-2">
      <div
        v-for="i in rows"
        :key="i"
        class="skeleton"
        :style="{ ...style, width: i === rows - 1 ? '70%' : style.width }"
      />
    </div>
  </template>
  <template v-else>
    <div class="skeleton" :style="style" />
  </template>
</template>
