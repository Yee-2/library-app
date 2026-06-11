<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { HelpCircle, Home } from 'lucide-vue-next'
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
    <HelpCircle class="w-20 h-20 text-slate-300 mb-4" :stroke-width="1.5" />
    <h1 class="text-2xl font-bold mb-2 tracking-tight">页面找不到了</h1>
    <p class="text-slate-500 mb-6">你访问的页面不存在或已被移除</p>
    <RouterLink to="/" class="btn-primary">
      <Home class="w-4 h-4" :stroke-width="1.75" />
      <span>返回首页</span>
    </RouterLink>
  </div>
</template>
