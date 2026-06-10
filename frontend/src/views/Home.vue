<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="bg-gradient-to-br from-brand-500 to-brand-700 text-white">
      <div class="max-w-6xl mx-auto px-4 py-16 sm:py-24 text-center">
        <h1 class="text-3xl sm:text-5xl font-bold mb-4">云端图书馆</h1>
        <p class="text-base sm:text-lg text-brand-50/90 mb-8 max-w-xl mx-auto">
          自定义导入图书 · 多端同步阅读 · 多种字体主题 · AI 听书
        </p>
        <div class="flex items-center justify-center gap-3">
          <RouterLink
            v-if="!auth.isLoggedIn"
            to="/login"
            class="bg-white text-brand-600 font-medium px-6 py-3 rounded-lg hover:bg-brand-50 transition"
          >
            立即开始
          </RouterLink>
          <RouterLink
            v-else
            to="/library"
            class="bg-white text-brand-600 font-medium px-6 py-3 rounded-lg hover:bg-brand-50 transition"
          >
            进入我的书架
          </RouterLink>
          <RouterLink
            to="/store"
            class="border border-white/40 text-white px-6 py-3 rounded-lg hover:bg-white/10 transition"
          >
            浏览在线书库
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- 功能 -->
    <section class="max-w-6xl mx-auto px-4 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="card p-5">
        <div class="text-2xl mb-2">📚</div>
        <h3 class="font-semibold mb-1">多格式支持</h3>
        <p class="text-sm text-slate-500">EPUB / PDF / TXT / MOBI，本地文件一键导入</p>
      </div>
      <div class="card p-5">
        <div class="text-2xl mb-2">🎨</div>
        <h3 class="font-semibold mb-1">风格字体</h3>
        <p class="text-sm text-slate-500">宋体、楷体、黑体等多种字体，护眼/夜间多种主题</p>
      </div>
      <div class="card p-5">
        <div class="text-2xl mb-2">🔖</div>
        <h3 class="font-semibold mb-1">跨端同步</h3>
        <p class="text-sm text-slate-500">阅读进度、书签、笔记在所有设备实时同步</p>
      </div>
      <div class="card p-5">
        <div class="text-2xl mb-2">🤖</div>
        <h3 class="font-semibold mb-1">AI 听书</h3>
        <p class="text-sm text-slate-500">基于 MiniMax M3 TTS，多种音色随时切换</p>
      </div>
    </section>
  </div>
</template>
