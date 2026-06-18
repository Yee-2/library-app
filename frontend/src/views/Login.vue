<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Mail, Lock, LogIn, ArrowLeft } from 'lucide-vue-next'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const loading = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')

async function submit() {
  loading.value = true
  message.value = ''
  try {
    if (mode.value === 'signup') {
      const res = await auth.signUp(email.value, password.value)
      if (res.session) goRedirect()
      else {
        messageType.value = 'ok'
        message.value = '注册成功！请前往邮箱点击验证链接。'
      }
    } else {
      await auth.signIn(email.value, password.value)
      goRedirect()
    }
  } catch (e: any) {
    messageType.value = 'err'
    message.value = e.message || '操作失败'
  } finally {
    loading.value = false
  }
}

function goRedirect() {
  const redirect = (route.query.redirect as string) || '/library'
  router.push(redirect)
}
</script>

<template>
  <div class="min-h-[calc(100vh-100px)] flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <!-- 品牌头 -->
      <div class="text-center mb-6">
        <div class="inline-flex w-16 h-16 rounded-3xl bg-gradient-to-br from-neon-purple to-neon-pink items-center justify-center shadow-lg">
          <img src="/favicon.svg" class="w-9 h-9" alt="logo" />
        </div>
        <h1 class="text-2xl font-bold mt-3 tracking-tight">云端图书馆</h1>
      </div>

      <div class="card p-6">
        <h2 class="text-lg font-semibold text-center mb-1">
          {{ mode === 'signin' ? '欢迎回来' : '注册账号' }}
        </h2>
        <p class="text-sm text-ink-300 text-center mb-5">
          {{ mode === 'signin' ? '登录后开始你的阅读之旅' : '几秒钟即可创建账号' }}
        </p>

        <form @submit.prevent="submit" class="space-y-3">
          <div class="relative">
            <Mail class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
            <input v-model="email" type="email" required placeholder="you@example.com" class="input pl-10" />
          </div>
          <div class="relative">
            <Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
            <input v-model="password" type="password" required minlength="6" placeholder="••••••" class="input pl-10" />
          </div>

          <button type="submit" :disabled="loading" class="btn-primary w-full h-11 mt-1">
            <LogIn class="w-4 h-4" :stroke-width="1.75" />
            <span>{{ loading ? '处理中…' : (mode === 'signin' ? '登录' : '注册') }}</span>
          </button>

          <p v-if="message" :class="['text-sm text-center py-2 rounded-lg', messageType === 'ok' ? 'text-emerald-300 bg-emerald-500/15' : 'text-rose-400 bg-rose-500/15']">
            {{ message }}
          </p>
        </form>

        <div class="text-center text-sm text-ink-300 mt-5">
          <template v-if="mode === 'signin'">
            还没有账号？
            <button class="text-neon-purple hover:underline font-medium" @click="mode = 'signup'">立即注册</button>
          </template>
          <template v-else>
            已有账号？
            <button class="text-neon-purple hover:underline font-medium" @click="mode = 'signin'">去登录</button>
          </template>
        </div>
      </div>

      <div class="text-center mt-4">
        <RouterLink to="/" class="inline-flex items-center gap-1 text-xs text-ink-300 hover:text-ink-50 transition">
          <ArrowLeft class="w-3 h-3" :stroke-width="1.75" />
          <span>返回首页</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
