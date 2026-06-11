<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getUserProfile, listUserPublicBooks, isFollowing, followUser, unfollowUser,
  uploadAvatar, updateMyProfile
} from '@/lib/books'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const userId = computed(() => route.params.id as string)

const profile = ref<any>(null)
const stats = ref<any>(null)
const achievements = ref<any[]>([])
const books = ref<any[]>([])
const following = ref(false)
const loading = ref(false)

// 头像 / 签名编辑
const uploadingAvatar = ref(false)
const editingBio = ref(false)
const bioDraft = ref('')
const savingBio = ref(false)
const avatarFileInput = ref<HTMLInputElement | null>(null)

async function refresh() {
  loading.value = true
  try {
    const { profile: p, stats: s, achievements: a } = await getUserProfile(userId.value)
    profile.value = p
    stats.value = s
    achievements.value = a
    books.value = await listUserPublicBooks(userId.value)
    if (auth.isLoggedIn) following.value = await isFollowing(userId.value)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function toggleFollow() {
  if (!auth.isLoggedIn) { router.push('/login'); return }
  try {
    if (following.value) {
      await unfollowUser(userId.value)
      following.value = false
    } else {
      await followUser(userId.value)
      following.value = true
    }
  } catch (e: any) {
    alert(e.message)
  }
}

function readBook(b: any) {
  router.push(`/book/${b.id}`)
}

const isMe = computed(() => auth.user?.id === userId.value)

// ---- 头像 ----
async function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingAvatar.value = true
  try {
    const url = await uploadAvatar(file)
    profile.value = { ...profile.value, avatar_url: url }
  } catch (err: any) {
    alert('上传失败：' + err.message)
  } finally {
    uploadingAvatar.value = false
    if (avatarFileInput.value) avatarFileInput.value.value = ''
  }
}

// ---- bio 编辑 ----
function startEditBio() {
  bioDraft.value = profile.value?.bio || ''
  editingBio.value = true
}
function cancelEditBio() {
  editingBio.value = false
  bioDraft.value = ''
}
async function saveBio() {
  savingBio.value = true
  try {
    const updated = await updateMyProfile({ bio: bioDraft.value })
    profile.value = { ...profile.value, ...updated }
    editingBio.value = false
  } catch (e: any) {
    alert('保存失败：' + e.message)
  } finally {
    savingBio.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost text-sm">← 返回</button>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <div v-else>
      <!-- 头部 -->
      <div class="card p-5 mb-4">
        <div class="flex items-center gap-4">
          <div class="relative group">
            <div class="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-2xl font-bold">
              <img v-if="profile?.avatar_url" :src="profile.avatar_url" class="w-full h-full object-cover" alt="avatar" />
              <span v-else>{{ (profile?.username || '?')[0].toUpperCase() }}</span>
            </div>
            <label v-if="isMe" class="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
              {{ uploadingAvatar ? '上传中…' : '更换' }}
              <input
                ref="avatarFileInput"
                type="file"
                accept="image/*"
                class="hidden"
                :disabled="uploadingAvatar"
                @change="onAvatarChange"
              />
            </label>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-lg">{{ profile?.username || '匿名用户' }}</div>
            <div v-if="!editingBio" class="flex items-start gap-2 mt-0.5">
              <span class="text-sm text-slate-500 flex-1">{{ profile?.bio || '这个人很懒，什么也没写' }}</span>
              <button v-if="isMe" @click="startEditBio" class="text-xs text-brand-600 hover:underline flex-shrink-0">编辑</button>
            </div>
            <div v-else class="mt-1">
              <textarea v-model="bioDraft" rows="2" maxlength="200" class="input text-sm" placeholder="说说你自己…" />
              <div class="flex justify-between items-center mt-1">
                <span class="text-xs text-slate-400">{{ bioDraft.length }} / 200</span>
                <div class="flex gap-2">
                  <button @click="cancelEditBio" class="text-xs btn-secondary px-2 py-1">取消</button>
                  <button @click="saveBio" :disabled="savingBio" class="text-xs btn-primary px-2 py-1">
                    {{ savingBio ? '保存中…' : '保存' }}
                  </button>
                </div>
              </div>
            </div>
            <div class="text-xs text-slate-400 mt-1">加入于 {{ new Date(profile?.created_at).toLocaleDateString('zh-CN') }}</div>
          </div>
          <button
            v-if="!isMe"
            @click="toggleFollow"
            :class="following ? 'btn-secondary' : 'btn-primary'"
            class="text-sm"
          >
            {{ following ? '已关注' : '+ 关注' }}
          </button>
        </div>

        <!-- 统计 -->
        <div class="grid grid-cols-5 gap-1 mt-5 text-center text-sm">
          <div>
            <div class="font-bold">{{ stats?.books_count || 0 }}</div>
            <div class="text-xs text-slate-500">藏书</div>
          </div>
          <div>
            <div class="font-bold">{{ stats?.followers_count || 0 }}</div>
            <div class="text-xs text-slate-500">粉丝</div>
          </div>
          <div>
            <div class="font-bold">{{ stats?.following_count || 0 }}</div>
            <div class="text-xs text-slate-500">关注</div>
          </div>
          <div>
            <div class="font-bold">{{ Math.floor((stats?.total_seconds || 0) / 3600) }}h</div>
            <div class="text-xs text-slate-500">阅读</div>
          </div>
          <div>
            <div class="font-bold">{{ stats?.achievements_count || 0 }}</div>
            <div class="text-xs text-slate-500">成就</div>
          </div>
        </div>
      </div>

      <!-- 成就 -->
      <div v-if="achievements.length" class="card p-4 mb-4">
        <h3 class="font-semibold text-sm mb-2">成就</h3>
        <div class="flex flex-wrap gap-2">
          <div v-for="a in achievements" :key="a.achievement_id" class="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-xs flex items-center gap-1">
            <span>{{ a.achievements?.icon }}</span>
            <span>{{ a.achievements?.name }}</span>
          </div>
        </div>
      </div>

      <!-- 公开书 -->
      <div class="card p-4">
        <h3 class="font-semibold text-sm mb-3">公开的图书</h3>
        <div v-if="books.length === 0" class="text-sm text-slate-400 text-center py-6">还没有公开的图书</div>
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <div v-for="b in books" :key="b.id" class="cursor-pointer" @click="readBook(b)">
            <div class="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg overflow-hidden mb-1">
              <img v-if="b.cover_url" :src="b.cover_url" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-2xl opacity-30">📖</div>
            </div>
            <div class="text-xs line-clamp-1">{{ b.title }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>