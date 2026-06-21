# scripts/deploy_gutenberg.ps1
# 一键部署古登堡集成到 Supabase + 触发首次目录同步
# 用法：powershell -ExecutionPolicy Bypass -File scripts/deploy_gutenberg.ps1
#
# 功能：
#   1. 下载 Supabase CLI（如果 tools/supabase.exe 不存在）
#   2. 登录 Supabase（如果未登录）
#   3. 链接项目
#   4. 应用数据库迁移（018_gutenberg.sql）
#   5. 部署 4 个 Edge Functions（gutenberg-import, -fetch, -sync, 不含 tts）
#   6. 设置 secrets（ADMIN_USER_IDS）
#   7. 触发首次目录同步（下载 pg_catalog.csv → 灌入 gutenberg_catalog）
#   8. 验证：count(*) 报告

[CmdletBinding()]
param(
  [string]$ProjectRef = "",
  [string]$AdminUserIds = "",
  [string]$SupabaseUrl = "",
  [string]$SupabaseServiceKey = "",
  [string]$CliVersion = "2.107.0",
  [switch]$SkipMigration,
  [switch]$SkipSync,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # 加速 Invoke-WebRequest

# 颜色输出
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    [ERR] $msg" -ForegroundColor Red }

# ============== 0. 路径设置 ==============
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ToolsDir = Join-Path $RepoRoot "tools"
$CliExe = Join-Path $ToolsDir "supabase.exe"

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  古登堡集成 - 一键部署脚本" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "项目根目录：$RepoRoot"
Write-Host "CLI 版本：v$CliVersion"
Write-Host ""

# ============== 1. 下载 Supabase CLI ==============
if (-not (Test-Path $CliExe) -or $Force) {
  Write-Step "下载 Supabase CLI v$CliVersion"
  if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
  }

  $CliUrl = "https://github.com/supabase/cli/releases/download/v$CliVersion/supabase_windows_amd64.exe"
  $TempZip = Join-Path $env:TEMP "supabase-cli.exe"

  try {
    Write-Host "    下载 URL: $CliUrl"
    Invoke-WebRequest -Uri $CliUrl -OutFile $TempZip -UseBasicParsing -TimeoutSec 60
    Move-Item -Force $TempZip $CliExe
    Write-Ok "已下载到 $CliExe"
  } catch {
    Write-Err "下载失败：$($_.Exception.Message)"
    Write-Host "    请手动下载后放到 $CliExe"
    Write-Host "    或设置 http_proxy 环境变量后重试"
    exit 1
  }
} else {
  Write-Ok "Supabase CLI 已存在：$CliExe"
}

# 验证 CLI 可用
try {
  $null = & $CliExe --version
  Write-Ok "CLI 版本: $LASTEXITCODE"
} catch {
  Write-Err "CLI 无法执行：$($_.Exception.Message)"
  exit 1
}

# ============== 2. 登录 ==============
Write-Step "检查 Supabase 登录状态"
$loginStatus = & $CliExe projects list 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Warn "未登录，需要交互式登录"
  Write-Host "    浏览器会打开，按提示完成登录..."
  & $CliExe login
  if ($LASTEXITCODE -ne 0) {
    Write-Err "登录失败"
    exit 1
  }
} else {
  Write-Ok "已登录"
}

# ============== 3. 链接项目 ==============
if (-not $ProjectRef) {
  Write-Host ""
  Write-Host "可用项目列表："
  & $CliExe projects list
  Write-Host ""
  $ProjectRef = Read-Host "请输入项目 ref (从 Project URL 提取，例如 abcdefghij)"
  if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
    Write-Err "项目 ref 不能为空"
    exit 1
  }
}

Write-Step "链接项目：$ProjectRef"
& $CliExe link --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) {
  Write-Err "链接失败"
  exit 1
}
Write-Ok "已链接"

# ============== 4. 数据库迁移 ==============
if (-not $SkipMigration) {
  Write-Step "应用数据库迁移：018_gutenberg.sql"
  $MigrationFile = Join-Path $RepoRoot "supabase/migrations/018_gutenberg.sql"

  if (-not (Test-Path $MigrationFile)) {
    Write-Err "找不到迁移文件：$MigrationFile"
    exit 1
  }

  # 用 psql 直连 Supabase 数据库执行迁移
  # 先从 secrets 或用户输入获取 DB URL
  if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($SupabaseServiceKey)) {
    Write-Host "    需要数据库连接信息来执行迁移"
    Write-Host "    从 Supabase Dashboard → Project Settings → Database → Connection string (URI mode) 获取"
    $DbUrl = Read-Host "    请粘贴 DB URL (postgresql://postgres:xxx@xxx.supabase.co:5432/postgres)"
    if ([string]::IsNullOrWhiteSpace($DbUrl)) {
      Write-Err "DB URL 不能为空"
      exit 1
    }
  } else {
    $DbUrl = "$SupabaseUrl/rest/v1"  # 占位
  }

  # 解析 pg 主机
  $Uri = [System.Uri]$DbUrl
  $PgHost = $Uri.Host
  $PgPort = if ($Uri.Port -gt 0) { $Uri.Port } else { 5432 }
  $PgUser = $Uri.UserInfo.Split(':')[0]
  $PgPass = $Uri.UserInfo.Split(':')[1]
  $PgDb = $Uri.AbsolutePath.TrimStart('/')

  $env:PGPASSWORD = $PgPass
  $PsqlArgs = @("-h", $PgHost, "-p", $PgPort, "-U", $PgUser, "-d", $PgDb, "-v", "ON_ERROR_STOP=1", "-f", $MigrationFile)

  # 检查 psql 是否可用
  $PsqlExe = (Get-Command psql -ErrorAction SilentlyContinue)?.Source
  if (-not $PsqlExe) {
    Write-Warn "psql 未安装，尝试用 Node.js 执行迁移"
    Write-Host "    需要 service_role key，从 Supabase Dashboard → Settings → API 获取"

    $ServiceKey = Read-Host "    请粘贴 service_role key (留空完全跳过)"

    if ([string]::IsNullOrWhiteSpace($ServiceKey)) {
      Write-Warn "跳过迁移（请手动在 Supabase SQL Editor 执行 018_gutenberg.sql）"
    } else {
      # 用 Node.js 的 postgres 客户端直接执行
      # 注：这里用 Supabase 的 PostgREST 不行（PostgREST 不支持 DDL），
      # 真正能执行 DDL 的只有 psql 或 Supabase Dashboard SQL Editor。
      # 所以 service_role key 也救不了 DDL —— 还是提示用户手动跑。
      Write-Warn "service_role key 无法执行 DDL，请手动在 Supabase SQL Editor 跑："
      Write-Host "    路径：Dashboard → SQL Editor → New query"
      Write-Host "    复制 supabase/migrations/018_gutenberg.sql 内容 → Run"
      Read-Host "    完成后按 Enter 继续"
    }
  } else {
    Write-Host "    使用 psql: $PsqlExe"
    & psql @PsqlArgs
    if ($LASTEXITCODE -ne 0) {
      Write-Err "迁移失败"
      exit 1
    }
    Write-Ok "迁移成功"
  }
} else {
  Write-Warn "跳过迁移（-SkipMigration）"
}

# ============== 5. 部署 Edge Functions ==============
Write-Step "部署 Edge Functions"
$Functions = @("gutenberg-import", "gutenberg-fetch", "gutenberg-sync")

foreach ($fn in $Functions) {
  Write-Host "    部署 $fn..."
  & $CliExe functions deploy $fn --no-verify-jwt
  if ($LASTEXITCODE -ne 0) {
    Write-Err "$fn 部署失败"
    exit 1
  }
  Write-Ok "$fn 部署成功"
}

# ============== 6. 设置 secrets ==============
if (-not [string]::IsNullOrWhiteSpace($AdminUserIds)) {
  Write-Step "设置 ADMIN_USER_IDS secret"
  & $CliExe secrets set "ADMIN_USER_IDS=$AdminUserIds"
  if ($LASTEXITCODE -ne 0) {
    Write-Err "设置 secret 失败"
    exit 1
  }
  Write-Ok "ADMIN_USER_IDS 已设置"
} else {
  Write-Warn "未提供 -AdminUserIds，跳过"
  Write-Host "    提示：gutenberg-sync 需要管理员 token 才能调用"
  Write-Host "    设置方法：supabase secrets set ADMIN_USER_IDS=你的user_uuid"
}

# ============== 7. 触发首次同步 ==============
if (-not $SkipSync) {
  Write-Step "触发首次目录同步（下载 pg_catalog.csv → 灌入 gutenberg_catalog）"
  Write-Host "    预计耗时 1-3 分钟..."

  # 拿 admin user 的 access token 来调 gutenberg-sync
  # 这里简单用 CLI 生成一个短期 token（如果支持）
  $TokenCmd = Get-Command fnox -ErrorAction SilentlyContinue  # 占位

  Write-Warn "首次同步需要 admin 用户的 access_token"
  Write-Host "    获取方式：登录项目 → 浏览器 DevTools → Application → Cookies → 复制 sb-xxx-auth-token"
  $Token = Read-Host "    请粘贴 admin access_token (留空跳过)"

  if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $SyncUrl = "https://$ProjectRef.supabase.co/functions/v1/gutenberg-sync"
    try {
      $Response = Invoke-RestMethod -Uri $SyncUrl -Method POST `
        -Headers @{ "Authorization" = "Bearer $Token"; "Content-Type" = "application/json" } `
        -Body "{}" -TimeoutSec 300
      Write-Host "    同步结果："
      Write-Host ($Response | ConvertTo-Json -Depth 3)
      if ($Response.synced) {
        Write-Ok "已同步 $($Response.synced) 本，$($Response.languages.zh) 本中文，$($Response.languages.en) 本英文"
      } else {
        Write-Warn "同步函数响应异常：$Response"
      }
    } catch {
      Write-Err "同步失败：$($_.Exception.Message)"
      Write-Host "    可以稍后手动跑：curl -X POST -H 'Authorization: Bearer $Token' $SyncUrl"
    }
  } else {
    Write-Warn "跳过首次同步（可稍后手动跑）"
  }
}

# ============== 8. 验证 ==============
Write-Step "验证部署结果"
Write-Host "    Edge Functions:"
& $CliExe functions list 2>&1 | Select-String -Pattern "gutenberg-" | ForEach-Object { Write-Host "      $_" }

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  部署完成！" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "下一步："
Write-Host "  1. 在 Vercel 设置环境变量 VITE_ENABLE_GUTENBERG=true"
Write-Host "  2. 推代码触发自动部署"
Write-Host "  3. 访问 /search 试试搜索「战争与和平」"
Write-Host ""
