# scripts/deploy_gutenberg.ps1
# 一键部署古登堡集成到 Supabase + 触发首次目录同步
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/deploy_gutenberg.ps1 `
#     -ProjectRef 你的项目ref `
#     -AdminUserIds "你的user_uuid1,你的user_uuid2"
#
# 必需参数:
#   -ProjectRef     Supabase 项目 ref (从 Project URL 提取)
#   -AdminUserIds   管理员 user_id (逗号分隔)
#
# 可选参数:
#   -CliVersion     Supabase CLI 版本, 默认 2.107.0
#   -SkipMigration  跳过数据库迁移
#   -SkipSync       跳过首次目录同步
#   -Force          强制重新下载 CLI
#
# 退出码:
#   0 = 成功
#   1 = 一般错误
#   2 = 迁移失败
#   3 = 函数部署失败

[CmdletBinding()]
param(
  [Parameter(Mandatory=$false)][string]$ProjectRef = "",
  [Parameter(Mandatory=$false)][string]$AdminUserIds = "",
  [Parameter(Mandatory=$false)][string]$CliVersion = "2.107.0",
  [Parameter(Mandatory=$false)][switch]$SkipMigration,
  [Parameter(Mandatory=$false)][switch]$SkipSync,
  [Parameter(Mandatory=$false)][switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ============================================================
# 输出辅助 (用 ASCII 字符避免编码问题)
# ============================================================
function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "    [OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
  Write-Host "    [WARN] $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
  Write-Host "    [ERR] $msg" -ForegroundColor Red
}

function Confirm-Continue($msg) {
  Write-Host ""
  Write-Host "    $msg" -ForegroundColor Yellow
  $choice = Read-Host "    Continue? [y/N]"
  return ($choice -eq "y" -or $choice -eq "Y")
}

# ============================================================
# 主流程
# ============================================================
try {
  $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepoRoot = Split-Path -Parent $ScriptDir
  $ToolsDir = Join-Path $RepoRoot "tools"
  $CliExe = Join-Path $ToolsDir "supabase.exe"

  Write-Host ""
  Write-Host "========================================" -ForegroundColor Magenta
  Write-Host "  Gutenberg Integration Deploy Script" -ForegroundColor Magenta
  Write-Host "========================================" -ForegroundColor Magenta
  Write-Host ""
  Write-Host "  Project Root: $RepoRoot"
  Write-Host "  CLI Version: v$CliVersion"
  Write-Host ""

  # ----------------------------------------------------------
  # Step 1: Download Supabase CLI
  # ----------------------------------------------------------
  if (-not (Test-Path $CliExe) -or $Force) {
    Write-Step "Step 1/7: Download Supabase CLI v$CliVersion"

    if (-not (Test-Path $ToolsDir)) {
      New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
    }

    $CliUrl = "https://github.com/supabase/cli/releases/download/v$CliVersion/supabase_$CliVersion`_windows_amd64.zip"
    $TempZip = Join-Path $env:TEMP "supabase-cli-$CliVersion.zip"

    Write-Host "    URL: $CliUrl"
    $downloadOk = $false

    try {
      # GitHub 对 PowerShell 默认 UA 返回 404，加浏览器 UA 绕过
      Invoke-WebRequest -Uri $CliUrl -OutFile $TempZip -UseBasicParsing -TimeoutSec 180 `
        -Headers @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      if (Test-Path $TempZip) {
        # ZIP 包含 supabase.exe，解压到 tools/
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $ExtractDir = Join-Path $env:TEMP "supabase-cli-extract-$CliVersion"
        if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
        [System.IO.Compression.ZipFile]::ExtractToDirectory($TempZip, $ExtractDir)

        # 找到 supabase.exe 和 supabase-go.exe
        $ExtractedExe = Get-ChildItem -Path $ExtractDir -Filter "supabase.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
        $ExtractedGo  = Get-ChildItem -Path $ExtractDir -Filter "supabase-go.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName

        $neededCount = 0
        if (Test-Path $ExtractedExe) {
          Move-Item -Force $ExtractedExe $CliExe
          $neededCount++
        }
        if (Test-Path $ExtractedGo) {
          $DestGo = Join-Path $ToolsDir "supabase-go.exe"
          Move-Item -Force $ExtractedGo $DestGo
          $neededCount++
        }

        Remove-Item -Recurse -Force $ExtractDir
        Remove-Item -Force $TempZip

        if ($neededCount -eq 0) {
          Write-Err "supabase.exe not found in zip"
        } else {
          $downloadOk = $true
          Write-Host "    Extracted $neededCount binaries to $ToolsDir"
        }
      }
    } catch {
      Write-Err "Download failed: $($_.Exception.Message)"
    }

    if (-not $downloadOk) {
      Write-Host "    Manual download required:"
      Write-Host "      1. Open $CliUrl"
      Write-Host "      2. Save as $CliExe"
      Write-Host "      3. Re-run this script"
      exit 1
    }

    Write-Ok "Downloaded to $CliExe"
  } else {
    Write-Ok "Step 1/7: CLI already exists: $CliExe"
  }

  # Verify CLI works
  $cliOutput = & $CliExe --version 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Err "CLI cannot execute: $cliOutput"
    exit 1
  }
  Write-Ok "CLI ready: $cliOutput"

  # ----------------------------------------------------------
  # Step 2: Login check
  # ----------------------------------------------------------
  Write-Step "Step 2/7: Check login status"
  # supabase projects list 在未登录时返回非 0 exit code
  # 已登录但未 link 时 exit code = 0 + 仍然能列出项目
  # 不能用 $null = & 捕获（PowerShell bug: $ErrorActionPreference=Stop 时 stderr 会冒泡成 terminating error）
  & $CliExe projects list *> $null 2>&1
  $loginOk = ($LASTEXITCODE -eq 0)
  if (-not $loginOk) {
    Write-Warn "Not logged in. Browser will open..."
    & $CliExe login
    if ($LASTEXITCODE -ne 0) {
      Write-Err "Login failed"
      exit 1
    }
  } else {
    Write-Ok "Already logged in"
  }

  # ----------------------------------------------------------
  # Step 3: Link project
  # ----------------------------------------------------------
  Write-Step "Step 3/7: Link project"
  if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
    Write-Host ""
    Write-Host "Available projects:"
    & $CliExe projects list
    Write-Host ""
    $ProjectRef = Read-Host "Enter project ref (from Project URL)"
    if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
      Write-Err "Project ref cannot be empty"
      exit 1
    }
  }

  & $CliExe link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Link failed"
    exit 1
  }
  Write-Ok "Linked to $ProjectRef"

  # ----------------------------------------------------------
  # Step 4: Database migration
  # ----------------------------------------------------------
  if (-not $SkipMigration) {
    Write-Step "Step 4/7: Apply database migration (018_gutenberg.sql)"
    $MigrationFile = Join-Path $RepoRoot "supabase/migrations/018_gutenberg.sql"

    if (-not (Test-Path $MigrationFile)) {
      Write-Err "Migration file not found: $MigrationFile"
      exit 1
    }

    $PsqlExe = $null
    $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($psqlCmd) { $PsqlExe = $psqlCmd.Source }
    if ($PsqlExe) {
      Write-Host "    Found psql: $PsqlExe"
      $DbUrl = Read-Host "    DB URL (postgresql://postgres:xxx@host:5432/postgres)"

      if ([string]::IsNullOrWhiteSpace($DbUrl)) {
        Write-Warn "No DB URL, skipping migration"
      } else {
        try {
          $Uri = [System.Uri]$DbUrl
          $PgHost = $Uri.Host
          $PgPort = if ($Uri.Port -gt 0) { $Uri.Port } else { 5432 }
          $UserInfo = $Uri.UserInfo.Split(':')
          $PgUser = $UserInfo[0]
          $PgPass = $UserInfo[1]
          $PgDb = $Uri.AbsolutePath.TrimStart('/')

          $env:PGPASSWORD = $PgPass
          & psql -h $PgHost -p $PgPort -U $PgUser -d $PgDb -v ON_ERROR_STOP=1 -f $MigrationFile
          if ($LASTEXITCODE -ne 0) {
            Write-Err "Migration failed"
            exit 2
          }
          Write-Ok "Migration applied"
        } catch {
          Write-Err "Migration error: $($_.Exception.Message)"
          exit 2
        }
      }
    } else {
      Write-Warn "psql not installed"
      Write-Host ""
      Write-Host "    Manual steps:"
      Write-Host "      1. Open: https://supabase.com/dashboard/project/$ProjectRef/sql/new"
      Write-Host "      2. Copy content of: $MigrationFile"
      Write-Host "      3. Paste and Run"
      Write-Host ""
      $continue = Read-Host "    Press Enter after completing (or 's' to skip)"
      if ($continue -ne "s") {
        Write-Ok "Migration marked as done"
      } else {
        Write-Warn "Migration skipped"
      }
    }
  } else {
    Write-Warn "Step 4/7: Migration skipped (-SkipMigration)"
  }

  # ----------------------------------------------------------
  # Step 5: Deploy Edge Functions
  # ----------------------------------------------------------
  Write-Step "Step 5/7: Deploy Edge Functions"
  $Functions = @("gutenberg-import", "gutenberg-fetch", "gutenberg-sync")
  $deployOk = $true
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"  # Docker warnings should not terminate

  foreach ($fn in $Functions) {
    Write-Host "    Deploying $fn..."
    & $CliExe functions deploy $fn --no-verify-jwt
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Deploy $fn failed"
      $deployOk = $false
    } else {
      Write-Ok "$fn deployed"
    }
  }

  $ErrorActionPreference = $prevEAP

  if (-not $deployOk) {
    Write-Warn "Some functions failed to deploy"
    Write-Host ""
    Write-Host "    If Docker is not installed, deploy via Supabase Dashboard:"
    Write-Host "      1. Open https://supabase.com/dashboard/project/$ProjectRef/functions"
    Write-Host "      2. Create new function with the same name"
    Write-Host "      3. Copy code from supabase/functions/<name>/index.ts"
    Write-Host ""
    Write-Host "    Or install Docker Desktop:"
    Write-Host "      https://www.docker.com/products/docker-desktop/"
    Write-Host ""
  }

  # ----------------------------------------------------------
  # Step 6: Set secrets
  # ----------------------------------------------------------
  Write-Step "Step 6/7: Set secrets"
  if (-not [string]::IsNullOrWhiteSpace($AdminUserIds)) {
    $null = & $CliExe secrets set "ADMIN_USER_IDS=$AdminUserIds" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Err "Failed to set ADMIN_USER_IDS"
    } else {
      Write-Ok "ADMIN_USER_IDS set"
    }
  } else {
    Write-Warn "No -AdminUserIds provided, skipping"
    Write-Host "    To set later: supabase secrets set ADMIN_USER_IDS=your_uuid"
  }

  # ----------------------------------------------------------
  # Step 7: Trigger first sync
  # ----------------------------------------------------------
  if (-not $SkipSync) {
    Write-Step "Step 7/7: Trigger first sync (CSV -> gutenberg_catalog)"
    Write-Host "    Expected time: 1-3 minutes"
    Write-Host ""
    Write-Host "    You need an admin access_token. To get one:"
    Write-Host "      1. Login to your deployed app"
    Write-Host "      2. DevTools (F12) -> Application -> Local Storage"
    Write-Host "      3. Find 'sb-$ProjectRef-auth-token'"
    Write-Host "      4. Copy the 'access_token' value"
    Write-Host ""
    $Token = Read-Host "    Paste access_token (Enter to skip)"

    if (-not [string]::IsNullOrWhiteSpace($Token)) {
      $SyncUrl = "https://$ProjectRef.supabase.co/functions/v1/gutenberg-sync"
      $syncOk = $false

      try {
        $Response = Invoke-RestMethod -Uri $SyncUrl -Method POST `
          -Headers @{ "Authorization" = "Bearer $Token"; "Content-Type" = "application/json" } `
          -Body "{}" -TimeoutSec 300
        Write-Host ""
        Write-Host "    Sync response:"
        Write-Host ($Response | ConvertTo-Json -Depth 3) -ForegroundColor Gray
        if ($Response.ok -and $Response.synced) {
          Write-Ok "Synced $($Response.synced) books (zh=$($Response.languages.zh), en=$($Response.languages.en))"
          $syncOk = $true
        } else {
          Write-Warn "Sync function returned unexpected response"
        }
      } catch {
        Write-Err "Sync request failed: $($_.Exception.Message)"
        Write-Host "    Manual command:"
        Write-Host "      curl -X POST -H 'Authorization: Bearer $Token' $SyncUrl"
      }
    } else {
      Write-Warn "Sync skipped (no token)"
      Write-Host "    Manual command (replace YOUR_TOKEN):"
      Write-Host "      curl -X POST -H 'Authorization: Bearer YOUR_TOKEN' https://$ProjectRef.supabase.co/functions/v1/gutenberg-sync"
    }
  } else {
    Write-Warn "Step 7/7: Sync skipped (-SkipSync)"
  }

  # ----------------------------------------------------------
  # Done
  # ----------------------------------------------------------
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Magenta
  Write-Host "  Deployment Complete!" -ForegroundColor Magenta
  Write-Host "========================================" -ForegroundColor Magenta
  Write-Host ""
  Write-Host "  Next steps:" -ForegroundColor Cyan
  Write-Host "    1. Add VITE_ENABLE_GUTENBERG=true in Vercel env"
  Write-Host "    2. Push code to trigger Vercel deploy"
  Write-Host "    3. Visit /search and try searching 'War and Peace'"
  Write-Host ""
  Write-Host "  Functions deployed:" -ForegroundColor Cyan
  $funcs = & $CliExe functions list *> $null 2>&1
  $funcs | Select-String "gutenberg-" | ForEach-Object { Write-Host "    $_" }
  Write-Host ""
}
catch {
  Write-Host ""
  Write-Err "FATAL: $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
  exit 1
}