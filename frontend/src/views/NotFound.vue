<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
    <div class="text-6xl mb-4">🤔</div>
    <h1 class="text-2xl font-bold mb-2">页面找不到了</h1>
    <p class="text-slate-500 mb-6">你访问的页面不存在或已被移除</p>
    <RouterLink to="/" class="btn-primary">返回首页</RouterLink>
  </div>
</template>
