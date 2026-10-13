# Profile — คู่มือการใช้งาน

**หน้า:** `profile.html`
**บทบาทที่ใช้ได้:** ทุก role
**สิทธิ์:** ผู้ใช้ทุกคนเข้าดู profile ตัวเองได้; ดูของคนอื่นได้ผ่าน URL `?user=<user_id>` (บาง section เห็นเฉพาะเจ้าของ)

## ภาพรวม

หน้า Profile เป็นทั้ง **บัญชีผู้ใช้** และ **หน้าสรุปกิจกรรม** ของตัวเอง — ประกอบด้วย:
- Avatar, ชื่อ, role badge, username, team
- Statistics: Activities / Posts / Comments / Logins
- Achievement (badges + points)
- Activity Heatmap (contribution graph)
- My Posts
- Activity log
- Edit ชื่อ / avatar

## ส่วนประกอบหลัก

### Header
- **◈ Profile**
- **← Back**

### Hero Card
- **Team slug** — `~/sm` เป็น breadcrumb terminal-like
- **Avatar** (200×200):
  - คลิกเพื่ออัปโหลด (accept: png/jpeg/gif/webp)
  - ถ้าไม่มี → แสดง initials (ตัวอักษรจากชื่อ)
- **Name** — ตัวใหญ่
- **Role badge** — สีตาม role
- **# Username** chip
- **Team** context (SM·HUB / profile)
- Actions:
  - **📷 อัปโหลด/เปลี่ยน avatar**
  - **🗑 ลบรูป** (ถ้ามีอยู่)

### Hero Stats (4 counter)
- **Activities** — total activity count
- **Posts** — จำนวนโพสต์ที่สร้าง
- **Comments** — comment ที่พิมพ์
- **Logins** — จำนวน login

### Basic Info Section
- **ชื่อ** — editable (max 60)
- **Username** — readonly (admin แก้)
- **Email** — readonly (admin แก้)
- **💾 บันทึก**

### 🏆 Achievements
- **Points** total ด้านขวา
- Achievement stats (unlocked / total)
- List badge ที่ได้รับ (จาก course/exam/onboarding)

### 🔥 Activity Heatmap
- Contribution graph 365 วัน (แนว GitHub)
- Cell สีเข้ม = activity เยอะ
- Hover ดูจำนวน per day
- Total count ด้านขวา

### 📝 My Posts
- List โพสต์ที่คุณสร้างบน Web Board
- ปุ่ม refresh
- Empty state ถ้าไม่มี

### 📊 Activity Log
- Log activity ล่าสุด: login, post, comment, edit
- **Load more** ถ้ามีมากกว่า page แรก

## ขั้นตอนการใช้งาน

### เปลี่ยน Avatar
1. คลิก avatar หรือ **📷 อัปโหลด**
2. เลือกไฟล์ (png/jpeg/gif/webp)
3. ระบบ crop 200×200 (canvas)
4. Upload → เห็นเปลี่ยนทันที
5. **🗑 ลบรูป** = กลับเป็น initials

### แก้ไขชื่อ
1. Section Basic Info
2. พิมพ์ในช่อง **ชื่อ**
3. คลิก **💾 บันทึก**
4. Toast success

### ดู Activity Heatmap
- Hover cell เพื่อดูจำนวนกิจกรรมวันนั้น
- Total ด้านขวา = รวมทั้ง 365 วัน

### ดู Achievement
- Section 🏆
- Card แต่ละ badge — locked/unlocked
- Progress toward next tier (ถ้ามี)

### ดู Profile ของคนอื่น
- URL: `profile.html?user=<user_id>`
- เห็น hero + activity heatmap + posts (public info)
- **ไม่เห็น**: activity log ละเอียด, edit form

## Tips

- **Initials** — จะใช้ 1-2 ตัวแรกของชื่อ (สีสุ่มจาก user id)
- **Avatar size** — ระบบบีบ ~200KB
- **Points calc** — จาก achievement + course + exam (config ที่ Admin → Achievements)
- **Heatmap** — คำนวณจาก activity log (login, post, comment, etc.)

## Edge Cases

- **Upload fail** — ตรวจ format + size (< 5MB)
- **Change email** — ต้องแจ้ง admin (readonly ใน UI)
- **Profile ของทีมอื่น** — บาง section อาจ hidden (privacy)
- **Achievement ไม่ update** — background job ทำงานทุกวัน; force update ที่ admin
- **URL user_id ผิด** — แสดง 404

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `profile.html`
- **API:** `/api/auth/profile`, `/api/auth/my-activity`, `/api/board?author=`, `/api/achievements`
