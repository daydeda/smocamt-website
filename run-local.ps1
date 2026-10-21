# =========================================================================
# ActiveCAMT — สคริปต์รันระบบและทดสอบบนเครื่อง Local (Local Test & Runner)
# บันทึกเป็น: run-local.ps1
# การใช้งาน: เปิด PowerShell ในโฟลเดอร์โครงการแล้วรัน: .\run-local.ps1
# =========================================================================

$UTF8 = [System.Text.Encoding]::UTF8
$OutputEncoding = $UTF8
[Console]::OutputEncoding = $UTF8

# ล้างหน้าจอและแสดงแบนเนอร์
function Show-Header {
    Clear-Host
    Write-Host "=========================================================================" -ForegroundColor Cyan
    Write-Host " 🏠 ActiveCAMT — Local Test & Development Environment Runner" -ForegroundColor Green -Bold
    Write-Host "           สคริปต์ตรวจสอบไลบรารีและรันระบบทดสอบบนเครื่อง Local" -ForegroundColor Cyan
    Write-Host "=========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

# สร้างรหัสผ่านสุ่ม
function Generate-RandomString($Length = 24) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $random = New-Object System.Random
    $result = ""
    for ($i = 0; $i -lt $Length; $i++) {
        $result += $chars[$random.Next(0, $chars.Length)]
    }
    return $result
}

# สร้างรหัสสำหรับ NextAuth AUTH_SECRET
function Generate-AuthSecret {
    return [Convert]::ToBase64String((1..33 | ForEach-Object { [byte](Get-Random -Minimum 0 -Maximum 256) }))
}

# ตรวจสอบและติดตั้งไลบรารีที่จำเป็น (Library Verification & Installation)
function Check-Libraries {
    Write-Host "[*] กำลังตรวจสอบความครบถ้วนของ Dependencies..." -ForegroundColor Cyan
    
    # 1. เช็คโฟลเดอร์ node_modules
    $modulesPath = Join-Path $PSScriptRoot "node_modules"
    if (-not (Test-Path $modulesPath)) {
        Write-Host "[!] ไม่พบโฟลเดอร์ node_modules กำลังดำเนินการติดตั้งหลัก (npm install)..." -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ การติดตั้งหลักล้มเหลว กรุณาตรวจสอบสิทธิ์และการเชื่อมต่ออินเทอร์เน็ต" -ForegroundColor Red
            return $false
        }
    }
    
    # 2. เช็คไลบรารี dotenv (ซึ่งมักหายในเครื่องแรก)
    $packageJsonPath = Join-Path $PSScriptRoot "package.json"
    if (Test-Path $packageJsonPath) {
        $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
        $hasDotenv = $false
        
        if ($packageJson.dependencies -and $packageJson.dependencies.dotenv) { $hasDotenv = $true }
        if ($packageJson.devDependencies -and $packageJson.devDependencies.dotenv) { $hasDotenv = $true }
        
        if (-not $hasDotenv) {
            Write-Host "[!] ไม่พบไลบรารี 'dotenv' ในรายการ dependencies ซึ่งจำเป็นสำหรับการเชื่อมต่อฐานข้อมูลบน Local" -ForegroundColor Yellow
            Write-Host "    กำลังติดตั้ง 'dotenv' เป็น devDependencies ให้โดยอัตโนมัติ..." -ForegroundColor Gray
            npm install dotenv --save-dev
            if ($LASTEXITCODE -ne 0) {
                Write-Host "❌ ติดตั้ง 'dotenv' ล้มเหลว" -ForegroundColor Red
                return $false
            }
            Write-Host "✅ ติดตั้ง 'dotenv' สำเร็จ!" -ForegroundColor Green
        }
    }
    
    # 3. เช็คไลบรารี tsx (สำหรับการรันไฟล์ TypeScript ทดสอบ)
    if (-not (Get-Command "tsx" -ErrorAction SilentlyContinue) -and -not (Test-Path (Join-Path $modulesPath ".bin\tsx"))) {
        Write-Host "[!] ไม่พบเครื่องมือ 'tsx' กำลังติดตั้งให้เพิ่มเติม..." -ForegroundColor Yellow
        npm install tsx --save-dev
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ ติดตั้ง 'tsx' ล้มเหลว" -ForegroundColor Red
            return $false
        }
    }

    Write-Host "✅ ตรวจสอบและติดตั้งไลบรารีทั้งหมดครบถ้วนแล้ว!" -ForegroundColor Green
    Write-Host ""
    return $true
}

# ตรวจสอบและตั้งค่าไฟล์ .env
function Check-EnvFile {
    $envPath = Join-Path $PSScriptRoot ".env"
    $examplePath = Join-Path $PSScriptRoot ".env.production.example"
    
    if (-not (Test-Path $envPath)) {
        Write-Host "[!] ไม่พบไฟล์ .env ในโฟลเดอร์โครงการ..." -ForegroundColor Yellow
        Write-Host "    กำลังสร้างไฟล์ .env จากเทมเพลตตัวอย่างให้อัตโนมัติ..." -ForegroundColor Gray
        
        if (-not (Test-Path $examplePath)) {
            Write-Host "❌ ข้อผิดพลาด: ไม่พบไฟล์เทมเพลต .env.production.example" -ForegroundColor Red
            return $false
        }
        
        Copy-Item $examplePath $envPath
        
        # เจนค่าความปลอดภัยให้ผู้ใช้อัตโนมัติ
        $dbPassword = Generate-RandomString 16
        $authSecret = Generate-AuthSecret
        
        $content = Get-Content $envPath -Raw
        
        # ปรับแก้เนื้อหาใน .env ให้พร้อมรันบน Local Host ทันที
        $content = $content -replace '# DATABASE_URL=postgresql://username:securepassword@host:5432/dbname\?sslmode=require', "DATABASE_URL=postgresql://activecamt_admin:$dbPassword@localhost:5432/activecamt_prod?sslmode=disable"
        $content = $content -replace 'POSTGRES_PASSWORD=FILL_WITH_A_SUPER_SECURE_PASSWORD', "POSTGRES_PASSWORD=$dbPassword"
        $content = $content -replace 'AUTH_SECRET=FILL_WITH_SECURE_RANDOM_BASE64_KEY', "AUTH_SECRET=$authSecret"
        $content = $content -replace 'AUTH_URL=https://activecamt.university.ac.th/api/auth', 'AUTH_URL=http://localhost:3000/api/auth'
        
        Set-Content $envPath $content -Encoding UTF8
        
        Write-Host "✅ สร้างไฟล์ .env เรียบร้อยแล้ว!" -ForegroundColor Green
        Write-Host "   - เจนค่าสุ่ม AUTH_SECRET และรหัสผ่านฐานข้อมูลให้เรียบร้อย" -ForegroundColor Gray
        Write-Host "   - กำหนดพอร์ตและปิด SSL (sslmode=disable) สำหรับ Local เรียบร้อย" -ForegroundColor Gray
        Write-Host ""
    }
    return $true
}

# โหลดค่าตัวแปรจาก .env เข้า PowerShell Session
function Load-EnvFile {
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        Get-Content $envPath | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#")) {
                $index = $line.IndexOf('=')
                if ($index -gt 0) {
                    $key = $line.Substring(0, $index).Trim()
                    $value = $line.Substring($index + 1).Trim()
                    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                        $value = $value.Substring(1, $value.Length - 2)
                    }
                    [System.Environment]::SetEnvironmentVariable($key, $value, [System.EnvironmentVariableTarget]::Process)
                }
            }
        }
    }
}

# -------------------------------------------------------------------------

# ทดสอบการเชื่อมต่อฐานข้อมูล
function Test-DbConnection {
    Write-Host "[*] กำลังทดสอบการเชื่อมต่อฐานข้อมูล..." -ForegroundColor Cyan
    Load-EnvFile
    
    if (-not $env:DATABASE_URL -and $env:DB_TYPE -ne "pglite") {
        Write-Host "❌ ไม่พบค่า DATABASE_URL ในตัวแปรระบบ กรุณาตรวจสอบไฟล์ .env" -ForegroundColor Red
        return $false
    }
    
    # รัน script ตรวจสอบ
    npx tsx scripts/test-db.ts
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ เชื่อมต่อฐานข้อมูลสำเร็จ!" -ForegroundColor Green
        return $true
    } else {
        if ($env:DB_TYPE -eq "pglite") {
            Write-Host "❌ ไม่สามารถเข้าถึงหรือสร้างฐานข้อมูลจำลอง PGlite ได้!" -ForegroundColor Red
        } else {
            Write-Host "❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้! (โปรดตรวจสอบว่า DB ทำงานอยู่บนพอร์ต 5432 หรือยัง)" -ForegroundColor Red
        }
        return $false
    }
}

# เมนูย่อยสำหรับจัดการฐานข้อมูล
function Manage-DatabaseMenu {
    while ($true) {
        Show-Header
        Write-Host "=== 🗄️ เครื่องมือจัดการฐานข้อมูล Local (Drizzle Utility) ===" -ForegroundColor Yellow
        Write-Host "[1] อัปเดตตารางฐานข้อมูลโดยตรง (db:push) - รวดเร็ว สะดวกตอนเขียนโค้ด"
        Write-Host "[2] รัน SQL Migrations (db:migrate) - ดึงข้อมูลตามลำดับตาราง"
        Write-Host "[3] ใส่ข้อมูลระบบและสิทธิ์แอดมินจำลองเริ่มต้น (db:seed)"
        Write-Host "[4] ล้างข้อมูลทั้งหมดในฐานข้อมูลใหม่ (db:reset) - ⚠️ ข้อมูลจะถูกลบหมด"
        Write-Host "[5] เปิด Drizzle Studio หลังบ้าน (drizzle-kit studio)"
        Write-Host "[6] ทดสอบการเชื่อมต่อ (Test Connection)"
        Write-Host "[7] กลับเมนูหลัก"
        Write-Host ""
        
        $dbChoice = Read-Host "เลือกเมนู (1-7)"
        
        switch ($dbChoice) {
            "1" {
                Write-Host "[*] กำลังรัน db:push..." -ForegroundColor Cyan
                npm run db:push
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "2" {
                Write-Host "[*] กำลังรัน db:migrate..." -ForegroundColor Cyan
                npm run db:migrate
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "3" {
                Write-Host "[*] กำลังรัน db:seed..." -ForegroundColor Cyan
                npm run db:seed
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "4" {
                Write-Host "⚠️ คำเตือน: ข้อมูลในฐานข้อมูลทั้งหมดจะถูกลบ!" -ForegroundColor Red
                $confirm = Read-Host "คุณแน่ใจว่าต้องการล้างฐานข้อมูล? (พิมพ์ 'yes' เพื่อยืนยัน)"
                if ($confirm -eq "yes") {
                    npm run db:reset
                }
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "5" {
                Write-Host "[*] กำลังเปิด Drizzle Studio (http://local.drizzle.studio)..." -ForegroundColor Green
                npm run db:studio
            }
            "6" {
                [void](Test-DbConnection)
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "7" {
                return
            }
        }
    }
}

# ปรับสิทธิ์เป็น Admin
function Promote-Admin {
    Show-Header
    Write-Host "=== 👑 ยกระดับบัญชีให้เป็น Admin (Promote Admin) ===" -ForegroundColor Yellow
    $email = Read-Host "ระบุอีเมลบัญชีผู้ใช้ (@cmu.ac.th) ที่เคย Login แล้ว"
    
    if (-not $email) {
        Write-Host "❌ อีเมลว่างเปล่า!" -ForegroundColor Red
        Read-Host "กด Enter เพื่อย้อนกลับ..."
        return
    }
    
    Load-EnvFile
    npx tsx scripts/elevate-admin.ts $email
    Read-Host "กด Enter เพื่อทำต่อ..."
}

# ตรวจสอบความพร้อมของระบบ (Diagnostics)
function Show-Diagnostics {
    Show-Header
    Write-Host "=== 📊 ตรวจสอบข้อมูลความพร้อมและการตั้งค่าระบบ (Diagnostics) ===" -ForegroundColor Yellow
    
    # Node
    if (Get-Command "node" -ErrorAction SilentlyContinue) {
        $nodeV = node -v
        Write-Host "✓ Node.js Version: $nodeV" -ForegroundColor Green
    } else {
        Write-Host "✗ Node.js: ไม่พบโปรแกรม! กรุณาติดตั้งก่อนทำต่อ" -ForegroundColor Red
    }
    
    # PGlite Local Data Check
    $pglitePath = Join-Path $PSScriptRoot ".pglite-data"
    if (Test-Path $pglitePath) {
        Write-Host "✓ ฐานข้อมูล PGlite Local (.pglite-data): ตรวจพบไฟล์ข้อมูลแล้ว" -ForegroundColor Green
    } else {
        Write-Host "⚠ ฐานข้อมูล PGlite Local (.pglite-data): ยังไม่ถูกสร้าง (จะสร้างและบันทึกอัตโนมัติเมื่อรันโหมด ZeroSetup ครั้งแรก)" -ForegroundColor Yellow
    }
    
    # Environment File
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        Write-Host "✓ ไฟล์ .env: ตรวจพบแล้ว" -ForegroundColor Green
    } else {
        Write-Host "✗ ไฟล์ .env: ไม่พบในระบบ" -ForegroundColor Red
    }
    
    Write-Host ""
    Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
}

# ฟังก์ชันหลัก (Main Menu Loop)
function Main-Menu {
    Show-Header
    Check-Libraries | Out-Null
    Check-EnvFile | Out-Null
    Load-EnvFile
    
    while ($true) {
        Show-Header
        Write-Host "=== 🚀 เมนูหลักสำหรับทดสอบระบบบนเครื่อง Local ===" -ForegroundColor Yellow
        Write-Host "[1] ⚡ รันระบบแบบ ZeroSetup (ใช้ PGlite - ไม่ต้องมีฐานข้อมูลแยก)"
        Write-Host "[2] รันเฉพาะระบบเว็บแอปพลิเคชันเครื่อง Local (Next.js - ใช้ DATABASE_URL จาก .env)"
        Write-Host "[3] เรียกใช้งานเครื่องมือจัดการฐานข้อมูล (Database & Drizzle Utility)"
        Write-Host "[4] แต่งตั้งสิทธิ์บัญชีให้เป็น Admin (Promote to Admin)"
        Write-Host "[5] ตรวจสอบความพร้อมและการวิเคราะห์ระบบ (Diagnostics)"
        Write-Host "[6] ปิดโปรแกรม (Exit)"
        Write-Host ""
        
        $choice = Read-Host "เลือกตัวเลือกการทำงาน (1-6)"
        
        switch ($choice) {
            "1" {
                Show-Header
                Write-Host "=== ⚡ กำลังสตาร์ทระบบแบบ ZeroSetup ด้วย PGlite ===" -ForegroundColor Cyan
                
                # ตั้งค่าระดับ Session
                $env:DB_TYPE = "pglite"
                
                # รัน migration และ seed อัตโนมัติ (เป็นของคู่กันสำหรับ ZeroSetup ครั้งแรก)
                Write-Host "[*] กำลังเตรียมฐานข้อมูลจำลอง PGlite (Migrate & Seed)..." -ForegroundColor Gray
                npm run db:migrate
                npm run db:seed
                
                # เช็คการเชื่อมต่ออีกครั้ง
                $dbConn = Test-DbConnection
                if (-not $dbConn) {
                    Write-Host "❌ เชื่อมต่อ PGlite ล้มเหลว กรุณาตรวจสอบสิทธิ์การอ่านเขียนไฟล์ในโฟลเดอร์โครงการ" -ForegroundColor Red
                    Read-Host "กด Enter เพื่อกลับเมนู..."
                    continue
                }
                
                # เริ่ม Next.js dev server
                Write-Host "[*] กำลังสตาร์ท Next.js Web server..." -ForegroundColor Green
                Write-Host "👉 เปิดเข้าชมระบบได้ที่: http://localhost:3000" -ForegroundColor Green -Bold
                Write-Host "💡 กด [CTRL + C] เพื่อหยุดการทำงานของเซิร์ฟเวอร์" -ForegroundColor Yellow
                Write-Host ""
                npm run dev
                Read-Host "กด Enter เพื่อกลับเมนู..."
            }
            "2" {
                $env:DB_TYPE = $null
                Show-Header
                Write-Host "=== การสตาร์ทระบบเว็บแอปพลิเคชัน Next.js (Local Node.js) ===" -ForegroundColor Cyan
                
                # ตรวจสอบการต่อฐานข้อมูล
                $dbConn = Test-DbConnection
                if (-not $dbConn) {
                    Write-Host ""
                    Write-Host "[?] คำเตือน: ฐานข้อมูลยังเชื่อมต่อไม่สำเร็จ!" -ForegroundColor Yellow
                    Write-Host "    กรุณาตรวจสอบว่ามี PostgreSQL รันอยู่และตั้งค่า DATABASE_URL ใน .env ถูกต้องแล้ว" -ForegroundColor Gray
                    $ignore = Read-Host "ต้องการเปิดแอปพลิเคชันต่อโดยไม่เชื่อมต่อฐานข้อมูลหรือไม่? (y/n)"
                    if ($ignore -ne "y" -and $ignore -ne "Y") {
                        continue
                    }
                }
                
                Write-Host "[*] กำลังเปิดเว็บแอปในโหมดพัฒนา..." -ForegroundColor Green
                Write-Host "👉 เปิดดูหน้าเว็บได้ที่: http://localhost:3000" -ForegroundColor Green -Bold
                Write-Host "💡 กด [CTRL + C] เพื่อหยุดการทำงานของเซิร์ฟเวอร์" -ForegroundColor Yellow
                Write-Host ""
                npm run dev
                Read-Host "กด Enter เพื่อกลับเมนู..."
            }
            "3" {
                Manage-DatabaseMenu
            }
            "4" {
                Promote-Admin
            }
            "5" {
                Show-Diagnostics
            }
            "6" {
                Write-Host "ขอให้สนุกกับการทดสอบระบบโลคอลครับ! สวัสดี" -ForegroundColor Green
                exit
            }
            default {
                Write-Host "❌ ตัวเลือกไม่ถูกต้อง" -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

Main-Menu
