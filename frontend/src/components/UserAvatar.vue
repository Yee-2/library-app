<script setup lang="ts">
/**
 * UserAvatar - 通用用户头像组件
 * - 严格不读取 auth.user.email
 * - fallback: username 首字母 → 哈希到一组霓虹色
 * - 支持 xs/sm/md/lg/xl 五种尺寸
 */
import { computed } from 'vue'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const props = withDefaults(defineProps<{
  user?: { username?: string | null; avatar_url?: string | null } | null
  size?: Size
  ring?: boolean
  glow?: boolean
  /** 点击事件 */
  clickable?: boolean
}>(), {
  size: 'sm',
  ring: false,
  glow: false,
  clickable: false,
})

const emit = defineEmits<{ (e: 'click', evt: MouseEvent): void }>()

// 8 套霓虹渐变 - 根据 username 哈希挑选
const NEON_GRADIENTS = [
  'from-neon-purple to-neon-pink',       // 紫粉
  'from-neon-violet to-neon-fuchsia',    // 紫红
  'from-neon-pink to-rose-500',          // 粉红
  'from-neon-cyan to-neon-purple',       // 青紫
  'from-neon-fuchsia to-neon-violet',    // 品紫
  'from-violet-500 to-neon-cyan',        // 蓝紫
  'from-fuchsia-500 to-neon-pink',       // 玫红
  'from-indigo-500 to-neon-fuchsia',     // 靛紫
] as const

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

const gradientClass = computed(() => {
  const seed = props.user?.username || '匿名'
  return NEON_GRADIENTS[hashString(seed) % NEON_GRADIENTS.length]
})

const initial = computed(() => {
  const name = (props.user?.username || '?').trim()
  return name[0] ? name[0].toUpperCase() : '?'
})

const sizeClass = computed(() => ({
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-9 h-9 text-sm',
  md: 'w-11 h-11 text-base',
  lg: 'w-16 h-16 text-2xl',
  xl: 'w-20 h-20 text-3xl',
}[props.size]))

const sizePx = computed(() => ({
  xs: 24, sm: 36, md: 44, lg: 64, xl: 80,
}[props.size]))

function onClick(e: MouseEvent) {
  if (props.clickable) emit('click', e)
}
</script>

<template>
  <div
    :class="[
      'rounded-full overflow-hidden flex items-center justify-center text-white font-semibold flex-shrink-0 select-none',
      sizeClass,
      `bg-gradient-to-br ${gradientClass}`,
      ring ? 'ring-2 ring-white/15' : '',
      glow ? 'shadow-[0_0_18px_rgba(168,85,247,0.45)]' : 'shadow-md',
      clickable ? 'cursor-pointer hover:scale-105 transition-transform' : '',
    ]"
    @click="onClick"
  >
    <img
      v-if="user?.avatar_url"
      :src="user.avatar_url"
      :alt="user.username || 'avatar'"
      :width="sizePx"
      :height="sizePx"
      class="w-full h-full object-cover"
      loading="lazy"
    />
    <span v-else>{{ initial }}</span>
  </div>
</template>
