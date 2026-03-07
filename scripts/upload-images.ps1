# Upload images to R2 bucket
# Run from worker directory: cd f:\project\Blog\worker && .\scripts\upload-images.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting R2 Image Upload" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Track uploaded files
$uploadedFiles = @()

# Helper function to upload a single file
function Upload-File {
    param(
        [string]$LocalPath,
        [string]$R2Key
    )

    $fullPath = "f:\project\Blog\$LocalPath"

    if (-not (Test-Path $fullPath)) {
        Write-Host "[SKIP] File not found: $fullPath" -ForegroundColor Yellow
        return
    }

    Write-Host "[UPLOADING] $R2Key ..." -ForegroundColor Cyan -NoNewline

    try {
        $output = npx wrangler r2 object put "blog-images/$R2Key" --file $fullPath --remote 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host " DONE" -ForegroundColor Green
            $script:uploadedFiles += @{
                LocalPath = $fullPath
                R2Key = $R2Key
                R2Url = "https://img.danarnoux.com/$R2Key"
            }
        } else {
            Write-Host " FAILED" -ForegroundColor Red
            Write-Host $output -ForegroundColor Red
        }
    } catch {
        Write-Host " ERROR: $_" -ForegroundColor Red
    }
}

Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host "1. Uploading avatars..." -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundGray

# 1. Avatars
Upload-File "astro-blog\public\image\bili\baiseguli.jpg" "avatars/baiseguli.jpg"
Upload-File "astro-blog\public\image\bili\fangyulaomao.jpg" "avatars/fangyulaomao.jpg"
Upload-File "astro-blog\public\image\bili\molijianyuzou.jpg" "avatars/molijianyuzou.jpg"
Upload-File "astro-blog\public\image\bili\sijingliunian.jpg" "avatars/sijingliunian.jpg"
Upload-File "astro-blog\public\image\bili\uiuiuiui8.jpg" "avatars/uiuiuiui8.jpg"
Upload-File "astro-blog\public\image\bili\Christina_Alex.jpg" "avatars/Christina_Alex.jpg"

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host "2. Uploading misc..." -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor DarkGray

# 2. Misc
Upload-File "astro-blog\public\image\DanArnoux.jpg" "misc/DanArnoux.jpg"
Upload-File "astro-blog\public\image\about\image.png" "misc/about-image.png"
Upload-File "astro-blog\public\image\home\2rd1yuubn4hc1.png" "misc/home-2rd1yuubn4hc1.png"

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host "3. Uploading posts..." -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor DarkGray

# 3. Posts
Upload-File "astro-blog\public\image\goflieuse\step1.png" "posts/goflieuse-step1.png"
Upload-File "astro-blog\public\image\goflieuse\step3.png" "posts/goflieuse-step3.png"
Upload-File "astro-blog\src\content\blog\gofile-download-tool-guide\images\step1.png" "posts/gofile-step1.png"
Upload-File "astro-blog\src\content\blog\gofile-download-tool-guide\images\step3.png" "posts/gofile-step3.png"
Upload-File "astro-blog\src\content\blog\how-to-build-a-personal-blog\step1.png" "posts/how-to-build-step1.png"
Upload-File "astro-blog\src\content\blog\how-to-build-a-personal-blog\step2.png" "posts/how-to-build-step2.png"
Upload-File "astro-blog\src\content\blog\how-to-build-a-personal-blog\step3.png" "posts/how-to-build-step3.png"
Upload-File "astro-blog\src\content\blog\how-to-build-a-personal-blog\step4.png" "posts/how-to-build-step4.png"
Upload-File "astro-blog\src\content\blog\how-to-get-started-with-programming\3-3-vscode-python.png" "posts/programming-3-3-vscode-python.png"
Upload-File "astro-blog\src\content\blog\how-to-get-started-with-programming\3-6-tsinghua-miniconda.png" "posts/programming-3-6-tsinghua-miniconda.png"
Upload-File "astro-blog\src\content\blog\how-to-get-started-with-programming\4-4-github-web.png" "posts/programming-4-4-github-web.png"
Upload-File "astro-blog\src\content\blog\how-to-get-started-with-programming\4-7-github-desktop.png" "posts/programming-4-7-github-desktop.png"
Upload-File "astro-blog\src\content\blog\how-to-get-started-with-programming\7-4-performance.png" "posts/programming-7-4-performance.png"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Upload Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Output results table
Write-Host "Uploaded Files Summary:" -ForegroundColor Green
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host ""

foreach ($file in $uploadedFiles) {
    Write-Host "Key:   $($file.R2Key)" -ForegroundColor White
    Write-Host "URL:   $($file.R2Url)" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "Total: $($uploadedFiles.Count) files uploaded" -ForegroundColor Green
