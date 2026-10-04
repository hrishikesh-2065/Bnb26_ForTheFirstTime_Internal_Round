$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project

Write-Host ""
Write-Host "=== FairDrop Setup ===" -ForegroundColor Cyan
Write-Host "1) Make sure MySQL is running in XAMPP/WAMP."
Write-Host "2) This setup will create/import the fairdrop database."
Write-Host ""

$mysql = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysql) {
    Write-Host "mysql.exe was not found in PATH." -ForegroundColor Yellow
    Write-Host "If you use XAMPP, import database/schema.sql manually in phpMyAdmin:"
    Write-Host "http://localhost/phpmyadmin"
    Write-Host ""
    Write-Host "Then edit .env if your MySQL root account has a password."
    exit 0
}

$pw = Read-Host "Enter MySQL root password (press Enter if blank)"
if ($pw -eq "") {
    & mysql -u root -e "SOURCE database/schema.sql"
} else {
    & mysql -u root "-p$pw" -e "SOURCE database/schema.sql"
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Database setup failed. Check your MySQL username/password." -ForegroundColor Red
    exit 1
}

# Keep .env in sync with the password supplied above.
$envPath = Join-Path $project ".env"
$content = Get-Content $envPath -Raw
$content = [regex]::Replace($content, '(?m)^DB_PASSWORD=.*$', "DB_PASSWORD=$pw")
Set-Content -Path $envPath -Value $content -NoNewline

Write-Host ""
Write-Host "Database setup complete." -ForegroundColor Green
Write-Host "Now run: npm install"
Write-Host "Then run: npm start"
