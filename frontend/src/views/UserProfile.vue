<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getUserProfile, listUserPublicBooks, isFollowing, followUser, unfollowUser,
  uploadAvatar, updateMyProfile
} from '@/lib/books'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import { maskUsername } from '@/lib/privacy'
import { ArrowLeft, Upload, Trophy, BookOpen, Pencil } from 'lucide-vue-next'
import BookCard from '@/components/BookCard.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import Skeleton from '@/components/Skeleton.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'

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
const showLoginPrompt = ref(false)

// 头像 / 签名编辑
const uploadingAvatar = ref(false)
const editingBio = ref(false)
const bioDraft = ref('')
const savingBio = ref(false)
const avatarFileInput = ref<HTMLInputElement | null>(null)

async function refresh() {
  if (!userId.value || userId.value === 'undefined') {
    router.replace('/')
    return
  }
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
  if (!auth.isLoggedIn) { showLoginPrompt.value = true; return }
  try {
    if (following.value) {
      await unfollowUser(userId.value)
      following.value = false
    } else {
      await followUser(userId.value)
      following.value = true
    }
  } catch (e: any) {
    toast.error(e.message)
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
    toast.error('上传失败：' + err.message)
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
    toast.error('保存失败：' + e.message)
  } finally {
    savingBio.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-4">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
    </div>

    <div v-if="loading" class="space-y-3">
      <Skeleton variant="rect" height="120px" rounded="2xl" />
      <Skeleton variant="rect" height="180px" rounded="2xl" />
      <Skeleton variant="rect" height="80px" rounded="2xl" />
    </div>

    <div v-else>
      <!-- 头部 -->
      <div class="card p-5 mb-4 relative overflow-hidden">
        <div class="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br from-neon-purple/20 to-fuchsia-500/20 blur-3xl" />
        <div class="relative">
          <div class="flex items-center gap-4">
            <div class="relative group">
              <div class="w-20 h-20 rounded-full overflow-hidden ring-4 ring-white/15 shadow-lg">
                <UserAvatar :user="profile" size="xl" />
              </div>
              <label v-if="isMe" class="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
                <Upload class="w-3.5 h-3.5 mr-0.5" :stroke-width="1.75" />
                <span>{{ uploadingAvatar ? '上传中' : '更换' }}</span>
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
              <div class="font-bold text-lg tracking-tight text-ink-50">{{ isMe ? (profile?.username || '匿名用户') : maskUsername(profile?.username) }}</div>
              <div v-if="!editingBio" class="flex items-start gap-2 mt-0.5">
                <span class="text-sm text-ink-300 flex-1">{{ profile?.bio || '这个人很懒，什么也没写' }}</span>
                <button v-if="isMe" @click="startEditBio" class="text-xs text-neon-purple hover:underline flex-shrink-0 flex items-center gap-0.5">
                  <Pencil class="w-3 h-3" :stroke-width="1.75" />
                  <span>编辑</span>
                </button>
              </div>
              <div v-else class="mt-1">
                <textarea v-model="bioDraft" rows="2" maxlength="200" class="input text-sm" placeholder="说说你自己…" />
                <div class="flex justify-between items-center mt-1">
                  <span class="text-xs text-ink-300">{{ bioDraft.length }} / 200</span>
                  <div class="flex gap-2">
                    <button @click="cancelEditBio" class="text-xs btn-secondary px-2 py-1">取消</button>
                    <button @click="saveBio" :disabled="savingBio" class="text-xs btn-primary px-2 py-1">
                      {{ savingBio ? '保存中…' : '保存' }}
                    </button>
                  </div>
                </div>
              </div>
              <div class="text-xs text-ink-300 mt-1">加入于 {{ new Date(profile?.created_at).toLocaleDateString('zh-CN') }}</div>
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
          <div class="grid grid-cols-5 gap-2 mt-5 text-center text-sm">
            <div class="py-2">
              <div class="font-bold text-lg text-neon-purple">{{ stats?.books_count || 0 }}</div>
              <div class="text-xs text-ink-300">藏书</div>
            </div>
            <div class="py-2">
              <div class="font-bold text-lg text-neon-purple">{{ stats?.followers_count || 0 }}</div>
              <div class="text-xs text-ink-300">粉丝</div>
            </div>
            <div class="py-2">
              <div class="font-bold text-lg text-neon-purple">{{ stats?.following_count || 0 }}</div>
              <div class="text-xs text-ink-300">关注</div>
            </div>
            <div class="py-2">
              <div class="font-bold text-lg text-neon-purple">{{ Math.floor((stats?.total_seconds || 0) / 3600) }}h</div>
              <div class="text-xs text-ink-300">阅读</div>
            </div>
            <div class="py-2">
              <div class="font-bold text-lg text-neon-purple">{{ stats?.achievements_count || 0 }}</div>
              <div class="text-xs text-ink-300">成就</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 成就 -->
      <div v-if="achievements.length" class="card p-4 mb-4">
        <h3 class="font-semibold text-sm mb-3 tracking-tight">成就</h3>
        <div class="flex flex-wrap gap-2">
          <div v-for="a in achievements" :key="a.achievement_id" class="badge-amber flex items-center gap-1">
            <span v-if="a.achievements?.icon" class="text-sm">{{ a.achievements.icon }}</span>
            <Trophy v-else class="w-3 h-3" :stroke-width="1.75" />
            <span>{{ a.achievements?.name }}</span>
          </div>
        </div>
      </div>

      <!-- 公开书 -->
      <div class="card p-4">
        <h3 class="font-semibold text-sm mb-3 tracking-tight">公开的图书</h3>
        <div v-if="books.length === 0" class="py-8 text-center">
          <BookOpen class="w-10 h-10 mx-auto text-ink-300 mb-2" :stroke-width="1.5" />
          <p class="text-sm text-ink-300">还没有公开的图书</p>
        </div>
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <BookCard v-for="b in books" :key="b.id" :book="b" :show-format="false" :show-meta="false" @open="readBook" />
        </div>
      </div>
    </div>

    <LoginPrompt :open="showLoginPrompt" @close="showLoginPrompt = false" />
  </div>
</template>