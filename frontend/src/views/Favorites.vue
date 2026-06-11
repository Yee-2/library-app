<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listMyFavorites } from '@/lib/books'
import { useAuthStore } from '@/stores/auth'

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
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost text-sm">← 返回</button>
      <h1 class="text-xl font-bold">我的收藏</h1>
      <span class="text-sm text-slate-500">{{ items.length }} 本</span>
    </div>
    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>
    <div v-else-if="items.length === 0" class="text-center text-slate-500 py-10">还没有收藏</div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
      <div v-for="it in items" :key="it.book_id" class="cursor-pointer" @click="open(it)">
        <div class="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg overflow-hidden">
          <img v-if="it.books?.cover_url" :src="it.books.cover_url" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl opacity-30">📖</div>
        </div>
        <div class="text-xs line-clamp-1 mt-1">{{ it.books?.title }}</div>
        <div class="text-[10px] text-slate-400">{{ it.books?.author || '佚名' }}</div>
      </div>
    </div>
  </div>
</template>