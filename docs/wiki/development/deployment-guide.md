# 📋 คู่มือขั้นตอนการติดตั้งระบบบนเซิร์ฟเวอร์ (Deployment Guide — Option A)

**อัปเดตล่าสุด:** 2026-06-18  
**สถานะ:** เสร็จสมบูรณ์ (เวอร์ชัน 1.2)  
**ลิงก์วิกิหลัก:** [กลับหน้าหลักวิกิ](../wiki.md)

---

คู่มือนี้อธิบายขั้นตอนการอัปโหลดและติดตั้งระบบ **ActiveCAMT** บนเครื่องเซิร์ฟเวอร์เสมือน (Virtual Machine) ของวิทยาลัยหรือมหาวิทยาลัย (ปกติรันระบบปฏิบัติการ Linux เช่น Ubuntu Server)

โดยใช้ระบบ **Docker Compose** เพื่อจัดโครงสร้างให้สภาพแวดล้อมบนเซิร์ฟเวอร์ทำงานเหมือนกับการพัฒนาบนเครื่องคอมพิวเตอร์ส่วนตัวทุกประการ หมดปัญหาโปรแกรมไม่ทำงานเนื่องจากความคลาดเคลื่อนของเวอร์ชันระบบปฏิบัติการหรือไลบรารีของระบบ

---

## 📋 ขั้นตอนที่ 1: ติดตั้ง Docker และ Docker Compose บนเซิร์ฟเวอร์
เชื่อมต่อไปยังเซิร์ฟเวอร์มหาวิทยาลัยผ่าน SSH และรันชุดคำสั่งด้านล่างเพื่อเริ่มการติดตั้ง Docker (ตัวอย่างกรณี Ubuntu Server):

```bash
# อัปเดตรายการแพ็กเกจระบบปฏิบัติการ
sudo apt update && sudo apt upgrade -y

# ติดตั้งแพ็กเกจพื้นฐานที่จำเป็นในการเชื่อมต่อ HTTPS
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# เพิ่มคีย์รักษาความปลอดภัยอย่างเป็นทางการของ Docker (GPG key)
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# ตั้งค่าเชื่อมต่อคลังเก็บข้อมูลของ Docker (Stable Repository)
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# ทำการอัปเดตระบบและเริ่มติดตั้ง Docker Engine และ Docker Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# ทดสอบตรวจสอบเวอร์ชันติดตั้ง
docker --version
docker compose version
```

---

## 📦 ขั้นตอนที่ 2: ดาวน์โหลดโค้ดโครงการมายังเซิร์ฟเวอร์
ดำเนินการคัดลอกไฟล์โครงการ หรือทำการดาวน์โหลดผ่าน Git Repository ในโฟลเดอร์ทำงานบนเซิร์ฟเวอร์:

```bash
# โคลนคลังโค้ดโครงการ ActiveCAMT
git clone <URL คลังโค้ดของคุณ> activecamt
cd activecamt
```

---

## 🔑 ขั้นตอนที่ 3: ตั้งค่าตัวแปรระบบปฏิบัติการ (Environment Variables)
คัดลอกไฟล์เทมเพลตของการตั้งค่าตัวแปรระบบ และเปิดทำการแก้ไขข้อมูลสำคัญ:

```bash
cp .env.production.example .env
nano .env
```

แก้ไขข้อมูลสำคัญภายในโปรแกรม `nano`:
1. เลือกและกรอกรหัสผ่านที่มีความปลอดภัยสูงในช่อง `POSTGRES_PASSWORD`
2. สร้างชุดคีย์ความปลอดภัยสำหรับตัวแปร `AUTH_SECRET` โดยการเปิดรันชุดคำสั่งนี้บนหน้าจอ Terminal ตัวใหม่เพื่อนำค่ารหัสลับมาใส่:
   ```bash
   openssl rand -base64 33
   ```
3. กำหนดตัวแปร `AUTH_URL` ชี้ไปยังโดเมนของเซิร์ฟเวอร์มหาวิทยาลัย (เช่น `https://activecamt.university.ac.th/api/auth`)
4. กรอกรหัส OAuth Client ที่ได้จาก Google Cloud Console ในช่อง `AUTH_GOOGLE_ID` และ `AUTH_GOOGLE_SECRET` 
   * *หมายเหตุสำคัญ:* อย่าลืมนำที่อยู่ลิงก์ `https://activecamt.university.ac.th/api/auth/callback/google` ไปป้อนในช่อง Authorized Redirect URIs ภายในหน้าตั้งค่าความปลอดภัยของ [Google Cloud Console](https://console.cloud.google.com) ด้วย

เสร็จแล้วกดบันทึกและปิดโปรแกรม `nano` (กด `CTRL+O`, กด `Enter`, และกด `CTRL+X`)

---

## 🚀 ขั้นตอนที่ 4: Build และรันคอนเทนเนอร์ขึ้นทำงาน
สั่งการให้ Docker Compose เริ่มทำกระบวนการติดตั้งและรวมไฟล์โค้ด (Build) เพื่อรันแอปพลิการทำงานหลังบ้าน:

```bash
# สั่งประกอบร่างและรันคอนเทนเนอร์เป็นเบื้องหลัง
sudo docker compose up -d --build
```
ระบบจะดำเนินการดังนี้โดยอัตโนมัติ:
1. เรียกใช้สภาพแวดล้อมน้ำหนักเบา Node.js 20 เพื่อประกอบซอร์สโค้ด
2. เริ่มทำกระบวนการ Build Next.js ให้พร้อมใช้อินเทอร์เน็ตจริง (`npm run build`)
3. สปินอัปคอนเทนเนอร์เว็บแอป Next.js
4. สปินอัปคอนเทนเนอร์ฐานข้อมูล PostgreSQL 16
5. สร้างไดเรกทอรีถาวร `./public/uploads` เชื่อมโยงไว้กับเครื่องแม่เพื่อรักษาไฟล์รูปที่อัปโหลดทั้งหมด

### ตรวจสอบการทำงาน (Logs)
เช็คสถานะการเริ่มทำงานว่าเสร็จสมบูรณ์หรือติดปัญหาหรือไม่:
```bash
sudo docker compose logs -f
```

---

## 🗄️ ขั้นตอนที่ 5: เริ่มทำการ Migration โครงสร้างฐานข้อมูล
เนื่องจากระบบฐานข้อมูล PostgreSQL ถูกสร้างขึ้นมาใหม่แบบว่างเปล่า แอดมินต้องรันคำสั่งเพื่อให้ระบบดำเนินการรันสคีมาข้อมูลและใส่ชุดข้อมูลตั้งต้น (Seeding) ดังนี้:

```bash
# อัปเดตตารางฐานข้อมูลและสคีมาสเปกผ่านคอนเทนเนอร์เว็บ
sudo docker compose exec web npm run db:migrate

# ใส่ข้อมูลบ้าน คะแนนบ้านตั้งต้น และสิทธิ์ต่างๆ ลงระบบ
sudo docker compose exec web npm run db:seed
```

---

## 👑 ขั้นตอนที่ 6: ยกระดับสิทธิ์บัญชีผู้ใช้เป็นผู้ดูแลระบบ (Promote Admin)
เนื่องจากการเข้าระบบผ่านอีเมล Google ครั้งแรก บัญชีจะได้รับบทบาทเป็นเพียง "นักศึกษาทั่วไป" เท่านั้น หากผู้ดูแลต้องการเข้าหน้าระบบจัดการ ให้ใช้คำสั่งเพื่อทำการเปลี่ยนบทบาทผู้ใช้ดังนี้:

1. กดเข้าหน้าเว็บผ่านคอมพิวเตอร์และลงทะเบียนล็อกอินด้วยบัญชี Google มหาวิทยาลัยครั้งแรกก่อนเพื่อให้มีข้อมูลผู้ใช้ในระบบ
2. กลับมายังหน้าต่าง Terminal ของเซิร์ฟเวอร์ รันคำสั่งต่อไปนี้โดยเปลี่ยนค่าเป็นอีเมลของท่านเพื่อยกระดับเป็นแอดมิน:
   ```bash
   sudo docker compose exec web npx tsx --env-file=.env scripts/elevate-admin.ts your-email@university.ac.th
   ```
   *(คำสั่งนี้จะแก้ไขข้อมูลบทบาทสิทธิ์ให้บัญชีของท่านกลายเป็นสิทธิ์ `'admin'` ทันทีและบันทึกประวัติลง Audit Trail ความปลอดภัย)*

---

## 🛡️ ขั้นตอนที่ 7: ตั้งค่าความปลอดภัย Nginx SSL (กรณีใช้เซิร์ฟเวอร์วิทยาลัยตรง)
หากเครื่องเซิร์ฟเวอร์เสมือนเชื่อมต่ออินเทอร์เน็ตโดยตรงและต้องเปิด SSL (HTTPS) โดยที่ระบบเครือข่ายของมหาวิทยาลัยไม่มี Load Balancer ช่วยคัดกรอง ให้ติดตั้งเครื่องมือเพื่อสร้างคีย์ความปลอดภัย Let's Encrypt ดังนี้:

1. ติดตั้งซอฟต์แวร์ certbot:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```
2. ป้อนคำสั่งให้ certbot เชื่อมต่อ Nginx และโดเมนของเซิร์ฟเวอร์เพื่อขอรับคีย์และบันทึกระบบ SSL:
   ```bash
   sudo certbot --nginx -d activecamt.university.ac.th
   ```
   ระบบจะอัปเดตไฟล์คอนฟิก Nginx ให้อัตโนมัติ และจะคอยต่ออายุคีย์ให้อัตโนมัติทุกๆ 3 เดือนโดยแอดมินไม่ต้องพิมพ์คำสั่งนี้ซ้ำอีกต่อไป

---

## 📈 การบำรุงรักษาและการอัปเดตซอฟต์แวร์

### วิธีการดึงโค้ดอัปเดตล่าสุดและนำขึ้นระบบใหม่:
หากมีการเขียนโค้ดและส่งข้อมูลขึ้น Git ล่าสุด ให้เข้ามาดึงโค้ดและสั่งประมวลผลอัปเกรดคอนเทนเนอร์ตามนี้:
```bash
git pull
sudo docker compose up -d --build
```
*(ระบบฐานข้อมูล ข้อมูลรูปภาพนักศึกษา และรูปโปสเตอร์ที่บันทึกไว้ใน `public/uploads` จะคงอยู่ปลอดภัยและไม่ได้รับผลกระทบใดๆ จากการกดอัปเดตซอฟต์แวร์ครั้งนี้)*

### วิธีเช็คการทำงานของฐานข้อมูล:
```bash
sudo docker compose logs db
```

---

## Related Documents
- [01-system-design.md](../../software/01-system-design.md) — โครงสร้างและโมดูลระบบย่อย
- [deployment-architecture.md](./deployment-architecture.md) — สถาปัตยกรรมคลาวด์/VPS
