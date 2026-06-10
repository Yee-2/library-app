<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
    <div class="card w-full max-w-sm p-6">
      <h1 class="text-2xl font-bold text-center mb-1">
        {{ mode === 'signin' ? '欢迎回来' : '注册账号' }}
      </h1>
      <p class="text-sm text-slate-500 text-center mb-6">
        {{ mode === 'signin' ? '登录后开始你的阅读之旅' : '几秒钟即可创建账号' }}
      </p>

      <form @submit.prevent="submit" class="space-y-3">
        <div>
          <label class="text-xs text-slate-600">邮箱</label>
          <input v-model="email" type="email" required placeholder="you@example.com" class="input mt-1" />
        </div>
        <div>
          <label class="text-xs text-slate-600">密码（至少 6 位）</label>
          <input v-model="password" type="password" required minlength="6" placeholder="••••••" class="input mt-1" />
        </div>

        <button type="submit" :disabled="loading" class="btn-primary w-full">
          {{ loading ? '处理中…' : (mode === 'signin' ? '登录' : '注册') }}
        </button>

        <p v-if="message" :class="['text-sm text-center', messageType === 'ok' ? 'text-green-600' : 'text-red-600']">
          {{ message }}
        </p>
      </form>

      <div class="text-center text-sm text-slate-500 mt-6">
        <template v-if="mode === 'signin'">
          还没有账号？
          <button class="text-brand-600 hover:underline" @click="mode = 'signup'">立即注册</button>
        </template>
        <template v-else>
          已有账号？
          <button class="text-brand-600 hover:underline" @click="mode = 'signin'">去登录</button>
        </template>
      </div>
      <div class="text-center mt-2">
        <RouterLink to="/" class="text-xs text-slate-400 hover:underline">返回首页</RouterLink>
      </div>
    </div>
  </div>
</template>
