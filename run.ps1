# =========================================================================
# ActiveCAMT — สคริปต์รันระบบและจัดการฐานข้อมูลบนเครื่องโลคอล (Local Runner & Manager)
# บันทึกเป็น: run.ps1
# การใช้งาน: เปิด PowerShell ในโฟลเดอร์โครงการแล้วรัน: .\run.ps1
# =========================================================================

$UTF8 = [System.Text.Encoding]::UTF8
$OutputEncoding = $UTF8
[Console]::OutputEncoding = $UTF8

# ล้างหน้าจอและแสดงแบนเนอร์หน้าแรก
function Show-Header {
    Clear-Host
    Write-Host "=========================================================================" -ForegroundColor Cyan
    Write-Host " 🏠 ActiveCAMT — Real-Time Activity & House Points Management Platform" -ForegroundColor Green -Bold
    Write-Host "                    สคริปต์รันระบบและจัดการฐานข้อมูลบนเครื่อง Local" -ForegroundColor Cyan
    Write-Host "=========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

# สร้างรหัสผ่านสุ่มเพื่อความปลอดภัย
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
        # 1. เปิดใช้และตั้งค่า DATABASE_URL เป็น localhost
        $content = $content -replace '# DATABASE_URL=postgresql://username:securepassword@host:5432/dbname\?sslmode=require', "DATABASE_URL=postgresql://activecamt_admin:$dbPassword@localhost:5432/activecamt_prod?sslmode=disable"
        # 2. ตั้งค่ารหัสผ่าน Postgres
        $content = $content -replace 'POSTGRES_PASSWORD=FILL_WITH_A_SUPER_SECURE_PASSWORD', "POSTGRES_PASSWORD=$dbPassword"
        # 3. ใส่ AUTH_SECRET
        $content = $content -replace 'AUTH_SECRET=FILL_WITH_SECURE_RANDOM_BASE64_KEY', "AUTH_SECRET=$authSecret"
        # 4. เปลี่ยนโดเมนให้ชี้ไปที่ Localhost
        $content = $content -replace 'AUTH_URL=https://activecamt.university.ac.th/api/auth', 'AUTH_URL=http://localhost:3000/api/auth'
        
        Set-Content $envPath $content -Encoding UTF8
        
        Write-Host "✅ สร้างไฟล์ .env เรียบร้อยแล้ว!" -ForegroundColor Green
        Write-Host "   - เจนค่าสุ่ม AUTH_SECRET และรหัสผ่านฐานข้อมูลให้เรียบร้อย" -ForegroundColor Gray
        Write-Host "   - กำหนดพอร์ตและปิด SSL (sslmode=disable) สำหรับ Local เรียบร้อย" -ForegroundColor Gray
        Write-Host "   ⚠️ หากคุณต้องการใช้ Google Login จริงๆ ให้กรอก AUTH_GOOGLE_ID และ AUTH_GOOGLE_SECRET เพิ่มใน .env" -ForegroundColor Yellow
        Write-Host ""
    }
    return $true
}

# โหลดค่าตัวแปรจาก .env เข้า PowerShell Session ป้องกัน Drizzle หลงพาร์ท
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

# ตรวจสอบ node_modules
function Check-NodeModules {
    $modulesPath = Join-Path $PSScriptRoot "node_modules"
    if (-not (Test-Path $modulesPath)) {
        Write-Host "[*] ไม่พบโฟลเดอร์ node_modules กำลังเตรียมติดตั้งไลบรารีพัฒนา..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ ติดตั้งไลบรารีล้มเหลว กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต" -ForegroundColor Red
            return $false
        }
        Write-Host "✅ ติดตั้งไลบรารีเสร็จสมบูรณ์" -ForegroundColor Green
    }
    return $true
}

# ตรวจสอบสถานะการเชื่อมต่อ Docker
function Check-DockerStatus {
    if (Get-Command "docker" -ErrorAction SilentlyContinue) {
        & docker info > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            return "Running"
        }
        return "NotRunning"
    }
    return "NotInstalled"
}

# เสนอแก้ไฟล์ docker-compose.yml ให้เปิดพอร์ต 5432 สื่อสารกับโฮสต์ภายนอกคอนเทนเนอร์ได้
function Expose-DockerPort {
    $composePath = Join-Path $PSScriptRoot "docker-compose.yml"
    if (-not (Test-Path $composePath)) { return }
    
    $content = Get-Content $composePath -Raw
    if ($content -match '-\s+"?5432:5432"?') {
        # แมปอยู่แล้ว
        return
    }
    
    Write-Host "[!] ตรวจพบว่าคอนเทนเนอร์ DB ไม่ได้แมปพอร์ต 5432 สู่โฮสต์ภายนอก (Local Host)" -ForegroundColor Yellow
    Write-Host "    หากไม่แมปพอร์ต เครื่องคุณจะไม่สามารถทดสอบ DB หรือเปิด Drizzle Studio ด้านนอกคอนเทนเนอร์ได้" -ForegroundColor Gray
    $choice = Read-Host "ต้องการให้สคริปต์แก้ไข docker-compose.yml เพื่อเปิดพอร์ต 5432 (5432:5432) หรือไม่? (y/n)"
    if ($choice -eq "y" -or $choice -eq "Y") {
        # เพิ่มพอร์ตลงในคอมโพส DB โดยใช้ Regex ค้นหาบรรทัดที่เหมาะสม
        $pattern = "restart:\s*always\s*\r?\n\s+environment:"
        $replacement = "restart: always`r`n    ports:`r`n      - `"5432:5432`"`r`n    environment:"
        
        $newContent = $content -replace $pattern, $replacement
        Set-Content $composePath $newContent -Encoding UTF8
        Write-Host "✅ เปิดพอร์ต 5432 ใน docker-compose.yml เรียบร้อย!" -ForegroundColor Green
    }
}

# ทดสอบสถานะการเชื่อมต่อฐานข้อมูล
function Test-DbConnection {
    Write-Host "[*] กำลังตรวจสอบการเชื่อมต่อฐานข้อมูล..." -ForegroundColor Cyan
    if (-not $env:DATABASE_URL) {
        Write-Host "❌ ไม่พบค่า DATABASE_URL ในระบบย่อย โปรดตรวจสอบไฟล์ .env" -ForegroundColor Red
        return $false
    }
    
    npx tsx scripts/test-db.ts
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ เชื่อมต่อฐานข้อมูลสำเร็จ!" -ForegroundColor Green
        return $true
    } else {
        Write-Host "❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้! กรุณาเปิดเครื่องฐานข้อมูลของคุณก่อน" -ForegroundColor Red
        return $false
    }
}

# ทำการรันระบบด้วย docker compose
function Start-DockerCompose($Mode) {
    $docker = Check-DockerStatus
    if ($docker -eq "NotInstalled") {
        Write-Host "❌ ข้อผิดพลาด: ไม่พบโปรแกรม Docker บนเครื่องนี้ กรุณาติดตั้ง Docker Desktop ก่อน" -ForegroundColor Red
        Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
        return
    }
    elseif ($docker -eq "NotRunning") {
        Write-Host "❌ ข้อผิดพลาด: โปรแกรม Docker ติดตั้งแล้ว แต่ยังไม่ได้เปิดใช้งาน กรุณาเปิด Docker Desktop" -ForegroundColor Red
        Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
        return
    }
    
    if ($Mode -eq "Full") {
        Write-Host "[*] กำลังสั่งรันระบบทั้งหมดด้วย Docker Compose (รวมแอปและฐานข้อมูล)..." -ForegroundColor Green
        docker compose up -d --build
        
        Write-Host "[*] กำลังรอให้คอนเทนเนอร์พร้อมทำงาน..." -ForegroundColor Cyan
        Start-Sleep -Seconds 5
        
        Write-Host "[?] ต้องการให้รันสคริปต์สร้างตาราง (Migrate) และใส่ข้อมูลตั้งต้น (Seed) หรือไม่?" -ForegroundColor Yellow
        $dbChoice = Read-Host "รันตารางและข้อมูลตั้งต้นหรือไม่? (y/n)"
        if ($dbChoice -eq "y" -or $dbChoice -eq "Y") {
            Write-Host "[*] กำลังรัน Migration ภายใน Docker..." -ForegroundColor Cyan
            docker compose exec web npm run db:migrate
            Write-Host "[*] กำลังรัน Database Seeding..." -ForegroundColor Cyan
            docker compose exec web npm run db:seed
            Write-Host "✅ ทำงานเสร็จสมบูรณ์!" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "🏠 ระบบเว็บของคุณทำงานแล้วที่: http://localhost:3000" -ForegroundColor Green -Bold
        Write-Host "👉 หากต้องการดู Logs การทำงาน ให้รันคำสั่ง: docker compose logs -f" -ForegroundColor Gray
        Write-Host ""
        $logChoice = Read-Host "ต้องการเปิดดู Logs ตอนนี้เลยหรือไม่? (y/n)"
        if ($logChoice -eq "y" -or $logChoice -eq "Y") {
            docker compose logs -f
        }
    }
    elseif ($Mode -eq "DbOnly") {
        Expose-DockerPort
        Write-Host "[*] กำลังสตาร์ทคอนเทนเนอร์ฐานข้อมูล PostgreSQL เท่านั้น..." -ForegroundColor Green
        docker compose up -d db
        Write-Host "✅ คอนเทนเนอร์ฐานข้อมูลเริ่มทำงานแล้ว!" -ForegroundColor Green
        Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
    }
}

# จัดการจัดการฐานข้อมูล (Sub-Menu)
function Manage-DatabaseMenu {
    while ($true) {
        Show-Header
        Write-Host "=== 🗄️ เมนูจัดการฐานข้อมูล (Database Utilities) ===" -ForegroundColor Yellow
        Write-Host "[1] อัปเดตตารางตาม Schema ปัจจุบัน (drizzle-kit push) - รวดเร็วสำหรับ Dev"
        Write-Host "[2] รันไฟล์ Migration (db:migrate) - ตามสคริปต์ SQL"
        Write-Host "[3] ใส่ข้อมูลจำลองและสิทธิ์ระบบตั้งต้น (db:seed)"
        Write-Host "[4] ล้างฐานข้อมูลทั้งหมดใหม่ (db:reset) - ⚠️ ข้อมูลเก่าจะหายหมด"
        Write-Host "[5] เปิดหน้าจัดการฐานข้อมูลแบบเว็บดีไซน์ (drizzle-kit studio)"
        Write-Host "[6] ตรวจสอบการเชื่อมต่อฐานข้อมูลปัจจุบัน (scripts/test-db.ts)"
        Write-Host "[7] กลับเมนูหลัก"
        Write-Host ""
        
        $dbChoice = Read-Host "เลือกตัวเลือกจัดการฐานข้อมูล (1-7)"
        
        switch ($dbChoice) {
            "1" {
                Write-Host "[*] กำลังอัปเดตตารางฐานข้อมูล..." -ForegroundColor Cyan
                npm run db:push
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "2" {
                Write-Host "[*] กำลังรันตารางข้อมูล SQL..." -ForegroundColor Cyan
                npm run db:migrate
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "3" {
                Write-Host "[*] กำลังใส่ข้อมูลตั้งต้นลงระบบ..." -ForegroundColor Cyan
                npm run db:seed
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "4" {
                Write-Host "⚠️ คำเตือน: ระบบจะล้างข้อมูลและตารางทั้งหมดในฐานข้อมูล!" -ForegroundColor Red
                $confirm = Read-Host "คุณแน่ใจหรือไม่ที่จะล้างฐานข้อมูล? (พิมพ์ 'yes' เพื่อยืนยัน)"
                if ($confirm -eq "yes") {
                    npm run db:reset
                } else {
                    Write-Host "ยกเลิกกระบวนการ" -ForegroundColor Yellow
                }
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "5" {
                Write-Host "[*] กำลังรัน Drizzle Studio หน้าเว็บจะเปิดที่: http://local.drizzle.studio" -ForegroundColor Green
                npm run db:studio
            }
            "6" {
                [void](Test-DbConnection)
                Read-Host "กด Enter เพื่อทำต่อ..."
            }
            "7" {
                return
            }
            default {
                Write-Host "❌ ตัวเลือกไม่ถูกต้อง กรุณาระบุ 1-7" -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

# ยกระดับผู้ใช้ธรรมดาให้เป็น Admin
function Promote-Admin {
    Show-Header
    Write-Host "=== 👑 เมนูยกระดับผู้ใช้เป็นแอดมิน (Promote Admin) ===" -ForegroundColor Yellow
    Write-Host "ระบบจะทำงานโดยการเปลี่ยนฟิลด์ role ในตาราง users ให้เป็น 'admin'"
    Write-Host "เงื่อนไข: ผู้ใช้นั้นๆ ต้องเคยล็อกอินเข้าสู่ระบบผ่าน Google Login แล้วอย่างน้อย 1 ครั้งเพื่อให้มีแถวข้อมูลในฐานข้อมูล"
    Write-Host ""
    $email = Read-Host "กรุณากรอกอีเมล (CMU Account เช่น somchai_d@cmu.ac.th) เพื่อโปรโมท"
    
    if (-not $email) {
        Write-Host "❌ อีเมลต้องไม่เป็นค่าว่าง!" -ForegroundColor Red
        Read-Host "กด Enter เพื่อกลับ..."
        return
    }
    
    Write-Host "[1] ดำเนินการบนเครื่องนี้โดยตรง (Local Command Line)"
    Write-Host "[2] ดำเนินการผ่านคอนเทนเนอร์ Docker (Docker Compose)"
    $platform = Read-Host "ระบุประเภทระบบที่รันเพื่อแก้ไขฐานข้อมูล (1/2)"
    
    if ($platform -eq "1") {
        Write-Host "[*] กำลังดำเนินการยกระดับสิทธิ์..." -ForegroundColor Cyan
        npx tsx --env-file=.env scripts/elevate-admin.ts $email
    }
    elseif ($platform -eq "2") {
        $docker = Check-DockerStatus
        if ($docker -ne "Running") {
            Write-Host "❌ คอนเทนเนอร์ Docker ไม่ได้รันอยู่ หรือระบบไม่ได้ติดตั้ง Docker" -ForegroundColor Red
        } else {
            Write-Host "[*] กำลังส่งคำสั่งไปยัง Docker Container..." -ForegroundColor Cyan
            docker compose exec web npx tsx --env-file=.env scripts/elevate-admin.ts $email
        }
    }
    else {
        Write-Host "ยกเลิกการดำเนินงานเนื่องจากตัวเลือกแพลตฟอร์มไม่ถูกต้อง" -ForegroundColor Yellow
    }
    Read-Host "กด Enter เพื่อทำต่อ..."
}

# ตรวจสอบภาพรวมและ Diagnostics ของเครื่อง
function Show-Diagnostics {
    Show-Header
    Write-Host "=== 📊 ข้อมูลวิเคราะห์สภาพแวดล้อมระบบ (System Diagnostics) ===" -ForegroundColor Yellow
    
    # Node
    if (Get-Command "node" -ErrorAction SilentlyContinue) {
        $nodeV = node -v
        Write-Host "✓ Node.js Version: $nodeV" -ForegroundColor Green
    } else {
        Write-Host "✗ Node.js: ไม่พบในเครื่อง! กรุณาติดตั้ง Node.js ก่อนเริ่มรันระบบ" -ForegroundColor Red
    }
    
    # npm
    if (Get-Command "npm" -ErrorAction SilentlyContinue) {
        $npmV = npm -v
        Write-Host "✓ npm Version: $npmV" -ForegroundColor Green
    } else {
        Write-Host "✗ npm: ไม่พบในเครื่อง!" -ForegroundColor Red
    }
    
    # Docker
    $docker = Check-DockerStatus
    if ($docker -eq "Running") {
        Write-Host "✓ Docker Desktop: ทำงานอยู่และพร้อมใช้งาน" -ForegroundColor Green
        # แสดงรายชื่อคอนเทนเนอร์ของโครงการถ้ามี
        Write-Host ""
        Write-Host "--- คอนเทนเนอร์ที่รันอยู่ในปัจจุบัน ---" -ForegroundColor Gray
        docker compose ps
    }
    elseif ($docker -eq "NotRunning") {
        Write-Host "⚠ Docker Desktop: ติดตั้งแล้วแต่ไม่ได้เปิดรัน (ปิดอยู่)" -ForegroundColor Yellow
    }
    else {
        Write-Host "✗ Docker: ไม่ได้ติดตั้งไว้บนเครื่องคอมพิวเตอร์เครื่องนี้" -ForegroundColor Gray
    }
    
    # .env File
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        Write-Host "✓ ไฟล์การตั้งค่าระบบ (.env): พบแล้ว" -ForegroundColor Green
    } else {
        Write-Host "✗ ไฟล์การตั้งค่าระบบ (.env): ไม่พบ (ระบบจะสร้างให้อัตโนมัติเมื่อกดรัน)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
}

# เริ่มการทำงานหลัก (Main Loop)
function Main-Menu {
    # 1. เช็คความพร้อมสภาพแวดล้อมพื้นฐานก่อนใช้งาน
    [void](Check-EnvFile)
    Load-EnvFile
    
    while ($true) {
        Show-Header
        Write-Host "=== 🚀 เมนูหลักเครื่องมือควบคุม (Main Control Menu) ===" -ForegroundColor Yellow
        Write-Host "[1] รันระบบฝั่งหน้าบ้าน/หลังบ้านเครื่องโลคอล (npm run dev) - รวดเร็วสำหรับนักพัฒนา"
        Write-Host "[2] รันระบบพร้อมฐานข้อมูลแบบครบชุดด้วย Docker (docker compose up)"
        Write-Host "[3] เปิดเฉพาะระบบฐานข้อมูล PostgreSQL ใน Docker (docker compose up db)"
        Write-Host "[4] จัดการตารางข้อมูล/รันข้อมูลตั้งต้น (Database Tools)"
        Write-Host "[5] แต่งตั้งสิทธิ์บัญชีให้เป็น Admin (Promote to Admin)"
        Write-Host "[6] ตรวจสอบสภาพแวดล้อมระบบและการตั้งค่าคีย์ (System Diagnostics)"
        Write-Host "[7] ปิดโปรแกรม (Exit)"
        Write-Host ""
        
        $mainChoice = Read-Host "ระบุตัวเลขบริการที่ต้องการเรียกใช้งาน (1-7)"
        
        switch ($mainChoice) {
            "1" {
                Show-Header
                Write-Host "=== รันระบบในโหมดพัฒนาผ่านโฮสต์ภายนอกคอนเทนเนอร์ (npm run dev) ===" -ForegroundColor Cyan
                
                # เช็ค dependencies
                if (-not (Check-NodeModules)) {
                    Read-Host "กด Enter เพื่อทำต่อ..."
                    continue
                }
                
                # โหลดตัวแปรใหม่อีกรอบกันพลาด
                Load-EnvFile
                
                # เช็คการเข้าถึง DB
                $testConn = Test-DbConnection
                if (-not $testConn) {
                    Write-Host ""
                    Write-Host "[?] ตรวจพบว่าฐานข้อมูลยังไม่พร้อมใช้งาน!" -ForegroundColor Yellow
                    Write-Host "    หากฐานข้อมูลเป็นของ Docker ให้เลือกข้อ [3] เพื่อเปิดระบบฐานข้อมูลก่อน" -ForegroundColor Gray
                    Write-Host "    หรือกรุณาตั้งค่า DATABASE_URL ใน .env ให้ชี้ไปยังฐานข้อมูลที่เปิดอยู่" -ForegroundColor Gray
                    $ignore = Read-Host "ต้องการฝืนรันระบบเว็บต่อไปโดยข้ามฐานข้อมูลหรือไม่? (y/n)"
                    if ($ignore -ne "y" -and $ignore -ne "Y") {
                        continue
                    }
                }
                
                Write-Host ""
                Write-Host "[*] สตาร์ทโปรเจกต์ Next.js บนพอร์ต 3000..." -ForegroundColor Green
                Write-Host "👉 เปิดเข้าชมหน้าเว็บที่: http://localhost:3000" -ForegroundColor Green -Bold
                Write-Host "💡 กดปุ่ม [CTRL + C] เพื่อยุติการทำงานและหยุดเซิร์ฟเวอร์" -ForegroundColor Yellow
                Write-Host ""
                npm run dev
                
                # จบจากการกด CTRL+C หรือปิดโปรแกรม
                Read-Host "กด Enter เพื่อกลับเมนูหลัก..."
            }
            "2" {
                Start-DockerCompose "Full"
            }
            "3" {
                Start-DockerCompose "DbOnly"
            }
            "4" {
                Manage-DatabaseMenu
            }
            "5" {
                Promote-Admin
            }
            "6" {
                Show-Diagnostics
            }
            "7" {
                Write-Host "ขอให้มีความสุขกับการพัฒนาครับ! สวัสดี" -ForegroundColor Green
                Start-Sleep -Seconds 1
                exit
            }
            default {
                Write-Host "❌ ตัวเลือกไม่ถูกต้อง กรุณากรอกหมายเลข 1-7" -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    }
}

# เริ่มต้นเรียกเมนูหลัก
Main-Menu
