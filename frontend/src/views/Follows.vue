<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  listFollowers, listFollowing
} from '@/lib/books'
import { useAuthStore } from '@/stores/auth'
import { ArrowLeft, User as UserIcon, Users, UserPlus } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const type = computed(() => (route.params.type as string) || 'followers')
const userId = computed(() => (route.params.id as string) || auth.user?.id)

const list = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  if (!userId.value) return
  loading.value = true
  try {
    if (type.value === 'followers') {
      list.value = await listFollowers(userId.value!)
    } else {
      list.value = await listFollowing(userId.value!)
    }
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function open(id: string) { router.push(`/user/${id}`) }
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight">{{ type === 'followers' ? '粉丝' : '关注' }}</h1>
    </div>
    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>
    <div v-else-if="list.length === 0" class="text-center py-16">
      <component :is="type === 'followers' ? Users : UserPlus" class="w-12 h-12 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
      <p class="text-slate-500">还没有人</p>
    </div>
    <div v-else class="space-y-2">
      <div v-for="item in list" :key="item.follower_id || item.followee_id"
           class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition"
           @click="open(item.follower_id || item.followee_id)">
        <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center font-medium flex-shrink-0">
          <img v-if="(item.profiles as any)?.avatar_url" :src="(item.profiles as any).avatar_url" class="w-full h-full object-cover" alt="avatar" />
          <UserIcon v-else class="w-5 h-5" :stroke-width="1.75" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">{{ (item.profiles as any)?.username || '匿名' }}</div>
          <div class="text-xs text-slate-400">关注于 {{ new Date(item.created_at).toLocaleDateString('zh-CN') }}</div>
        </div>
        <span class="text-xs text-brand-600">查看 ›</span>
      </div>
    </div>
  </div>
</template>
