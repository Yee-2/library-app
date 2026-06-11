<script setup lang="ts">
import { BookOpen, Globe, Lock } from 'lucide-vue-next'
import { formatBytes } from '@/lib/utils'

const props = defineProps<{
  book: {
    id: string
    title: string
    author?: string | null
    cover_url?: string | null
    file_format?: string
    file_size?: number | null
    is_public?: boolean
    progress?: number
  }
  showFormat?: boolean
  showMeta?: boolean
}>()

const emit = defineEmits<{ (e: 'open', id: string): void }>()
</script>

<template>
  <div
    class="group card-hover overflow-hidden flex flex-col cursor-pointer"
    @click="emit('open', book.id)"
  >
    <div class="relative aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden">
      <img
        v-if="book.cover_url"
        :src="book.cover_url"
        :alt="book.title"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <BookOpen v-else class="w-10 h-10 text-slate-300" :stroke-width="1.5" />

      <!-- 公开/私密 角标 -->
      <span
        v-if="book.is_public === true"
        class="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
               bg-emerald-500/90 text-white text-[10px] font-medium backdrop-blur-sm"
      >
        <Globe class="w-3 h-3" :stroke-width="2.5" />公开
      </span>
      <span
        v-else-if="book.is_public === false"
        class="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
               bg-slate-700/70 text-white text-[10px] font-medium backdrop-blur-sm"
      >
        <Lock class="w-3 h-3" :stroke-width="2.5" />私密
      </span>

      <!-- 格式 角标 -->
      <span
        v-if="showFormat !== false && book.file_format"
        class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md
               bg-black/40 text-white text-[10px] font-mono uppercase tracking-wider backdrop-blur-sm"
      >
        {{ book.file_format }}
      </span>

      <!-- 进度条 -->
      <div
        v-if="typeof book.progress === 'number' && book.progress > 0"
        class="absolute bottom-0 left-0 right-0 h-1 bg-black/20"
      >
        <div class="h-full bg-brand-500" :style="{ width: book.progress + '%' }"></div>
      </div>

      <!-- hover 浮层 -->
      <div
        class="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent
                opacity-0 group-hover:opacity-100 transition-all duration-200
                flex items-end justify-center pb-3"
      >
        <span class="px-3 py-1.5 rounded-full bg-white/95 text-slate-900 text-xs font-medium shadow">
          打开
        </span>
      </div>
    </div>

    <div class="p-2.5 flex-1 flex flex-col">
      <h3 class="font-medium text-sm line-clamp-2 leading-snug" :title="book.title">{{ book.title }}</h3>
      <p class="text-xs text-slate-500 line-clamp-1 mt-0.5">{{ book.author || '佚名' }}</p>
      <p v-if="showMeta !== false && book.file_size" class="text-[10px] text-slate-400 mt-1.5">
        {{ formatBytes(book.file_size) }}
      </p>
      <!-- 父页面可注入操作按钮 -->
      <div v-if="$slots.actions" class="mt-auto pt-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
