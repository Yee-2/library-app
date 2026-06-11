<script setup lang="ts">
import { ref, onMounted, onActivated, computed, nextTick } from 'vue'
import { getMyReadingSummary, listMyBooks } from '@/lib/books'
import { ArrowLeft, Clock, BarChart3, Type, Hash, BookOpen } from 'lucide-vue-next'

const summary = ref<any[]>([])
const books = ref<any[]>([])
const loading = ref(false)
const totalSeconds = computed(() => summary.value.reduce((s, r) => s + r.total_seconds, 0))
const totalWords = computed(() => summary.value.reduce((s, r) => s + r.total_words, 0))
const totalSessions = computed(() => summary.value.reduce((s, r) => s + r.sessions_count, 0))
const avgSecondsPerDay = computed(() => summary.value.length === 0 ? 0 : Math.round(totalSeconds.value / summary.value.length))

async function refresh() {
  loading.value = true
  try {
    const [s, b] = await Promise.all([getMyReadingSummary(30), listMyBooks()])
    summary.value = s
    books.value = b
    await nextTick()
    drawChart()
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
onActivated(refresh)

let chart: any = null
async function drawChart() {
  const canvas = document.getElementById('stats-chart') as HTMLCanvasElement
  if (!canvas) return
  const { Chart, registerables } = await import('chart.js')
  Chart.register(...registerables)
  if (chart) { chart.destroy(); chart = null }
  const days: string[] = []
  const map = new Map(summary.value.map(r => [r.stat_date, r]))
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  const minutes = days.map(d => Math.round(((map.get(d) as any)?.total_seconds || 0) / 60))
  chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: days.map(d => d.slice(5)),
      datasets: [{
        label: '阅读分钟',
        data: minutes,
        backgroundColor: '#0ea5e9',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      },
    },
  })
}

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}小时${m}分`
  return `${m}分钟`
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6">
    <div class="flex items-center gap-2 mb-5">
      <button @click="$router.back()" class="btn-ghost -ml-2 flex items-center gap-1">
        <ArrowLeft class="w-4 h-4" :stroke-width="1.75" />
        <span>返回</span>
      </button>
      <h1 class="text-2xl font-bold tracking-tight">阅读统计</h1>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-8">加载中…</div>

    <div v-else>
      <!-- 概览卡 -->
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="card p-4 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Clock class="w-5 h-5" :stroke-width="1.75" />
          </div>
          <div>
            <div class="text-xs text-slate-500">近 30 天阅读</div>
            <div class="text-2xl font-bold text-brand-600 mt-0.5">{{ fmtTime(totalSeconds) }}</div>
          </div>
        </div>
        <div class="card p-4 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
            <BarChart3 class="w-5 h-5" :stroke-width="1.75" />
          </div>
          <div>
            <div class="text-xs text-slate-500">日均阅读</div>
            <div class="text-2xl font-bold text-brand-600 mt-0.5">{{ fmtTime(avgSecondsPerDay) }}</div>
          </div>
        </div>
        <div class="card p-4 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
            <Type class="w-5 h-5" :stroke-width="1.75" />
          </div>
          <div>
            <div class="text-xs text-slate-500">累计字数</div>
            <div class="text-2xl font-bold text-brand-600 mt-0.5">{{ totalWords.toLocaleString() }}</div>
          </div>
        </div>
        <div class="card p-4 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <Hash class="w-5 h-5" :stroke-width="1.75" />
          </div>
          <div>
            <div class="text-xs text-slate-500">阅读会话</div>
            <div class="text-2xl font-bold text-brand-600 mt-0.5">{{ totalSessions }}</div>
          </div>
        </div>
      </div>

      <!-- 图表 -->
      <div class="card p-4 mb-4">
        <h3 class="font-semibold text-sm mb-3">每日阅读分钟数</h3>
        <div class="h-56">
          <canvas id="stats-chart"></canvas>
        </div>
      </div>

      <!-- 书目排行 -->
      <div class="card p-4">
        <h3 class="font-semibold text-sm mb-3">藏书（{{ books.length }}）</h3>
        <div v-if="books.length === 0" class="py-6 text-center">
          <BookOpen class="w-10 h-10 mx-auto text-slate-300 mb-2" :stroke-width="1.5" />
          <p class="text-xs text-slate-400">还没有书</p>
        </div>
        <div v-else class="space-y-2">
          <div v-for="(b, i) in books.slice(0, 8)" :key="b.id" class="flex items-center gap-2 text-sm">
            <span class="w-5 text-slate-400 text-xs font-mono">{{ i + 1 }}</span>
            <div class="flex-1 truncate">{{ b.title }}</div>
            <span class="text-xs text-slate-400 uppercase font-mono">{{ b.file_format }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
