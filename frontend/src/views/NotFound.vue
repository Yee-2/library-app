<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { Compass, Home, ArrowLeft } from 'lucide-vue-next'
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
    <div class="w-24 h-24 rounded-full bg-gradient-to-br from-primary-200 to-accent-200
                border border-primary-200 flex items-center justify-center mb-6
                shadow-lg">
      <Compass class="w-12 h-12 text-primary-600/80" :stroke-width="1.5" />
    </div>
    <h1 class="text-3xl font-extrabold mb-2 tracking-tight text-ink-800">404</h1>
    <h2 class="text-xl font-semibold mb-1 text-ink-600">此页书的第 404 页还是空白的</h2>
    <p class="text-ink-300 mb-8 max-w-sm">也许它曾经存在过一瞬，也许只是链接打错了。不妨回到书架重新找找。</p>
    <div class="flex gap-3">
      <button @click="$router.back()" class="btn-secondary flex items-center gap-1.5">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回上页</span>
      </button>
      <RouterLink to="/" class="btn-primary">
        <Home class="w-4 h-4" :stroke-width="1.75" />
        <span>回到首页</span>
      </RouterLink>
    </div>
  </div>
</template>
