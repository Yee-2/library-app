<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listMyFavorites } from '@/lib/books'
import { useAuthStore } from '@/stores/auth'
import { ArrowLeft, Star, BookOpen } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'

const auth = useAuthStore()
const router = useRouter()
const items = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  if (!auth.isLoggedIn) return
  loading.value = true
  try { items.value = await listMyFavorites() }
  finally { loading.value = false }
}
onMounted(refresh)

function open(b: any) { router.push(`/book/${b.book_id}`) }
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight">我的收藏</h1>
      <span class="text-sm text-ink-300">{{ items.length }} 本</span>
    </div>
    <div v-if="loading" class="text-center text-ink-300 py-8">加载中…</div>
    <div v-else-if="items.length === 0" class="text-center py-16">
      <Star class="w-12 h-12 mx-auto text-ink-300 mb-2" :stroke-width="1.5" />
      <p class="text-ink-300 mb-3">还没有收藏</p>
      <p class="text-xs text-ink-300">在书籍详情页点 ☆ 即可收藏</p>
    </div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
      <div v-for="it in items" :key="it.book_id" class="cursor-pointer" @click="open(it)">
        <BookCard :book="{ ...it.books, id: it.book_id, progress: 0 }" :show-format="false" :show-meta="false" />
      </div>
    </div>
  </div>
</template>
