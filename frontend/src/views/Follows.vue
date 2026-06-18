<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  listFollowers, listFollowing
} from '@/lib/books'
import { useAuthStore } from '@/stores/auth'
import { maskUsername } from '@/lib/privacy'
import { ArrowLeft, Users, UserPlus } from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const type = computed(() => (route.params.type as string) || 'followers')
const userId = computed(() => (route.params.id as string) || auth.user?.id)

const list = ref<any[]>([])
const loading = ref(false)

async function refresh() {
  if (!userId.value || userId.value === 'undefined') return
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
      <h1 class="text-2xl font-bold tracking-tight text-ink-50">{{ type === 'followers' ? '粉丝' : '关注' }}</h1>
    </div>
    <div v-if="loading" class="text-center text-ink-300 py-8">加载中…</div>
    <div v-else-if="list.length === 0" class="text-center py-16">
      <component :is="type === 'followers' ? Users : UserPlus" class="w-12 h-12 mx-auto text-ink-300 mb-2" :stroke-width="1.5" />
      <p class="text-ink-300">还没有人</p>
    </div>
    <div v-else class="space-y-2">
      <div v-for="item in list" :key="item.follower_id || item.followee_id"
           class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-[0_0_24px_rgba(168,85,247,0.3)] hover:border-neon-purple/40 transition"
           @click="open(item.follower_id || item.followee_id)">
        <UserAvatar :user="item.profiles as any" size="md" />
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm text-ink-50">{{ maskUsername((item.profiles as any)?.username) }}</div>
          <div class="text-xs text-ink-300">关注于 {{ new Date(item.created_at).toLocaleDateString('zh-CN') }}</div>
        </div>
        <span class="text-xs text-neon-purple">查看 ›</span>
      </div>
    </div>
  </div>
</template>
