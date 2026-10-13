# Sync Up (Daily Sync-up) — คู่มือการใช้งาน

**หน้า:** `syncup.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `syncup`)

## ภาพรวม

Daily Sync-up = ระบบอัปโหลด **screenshot / รูป** ตอน sync ประจำวัน (เช้า / เย็น) ของทีม. ใช้เป็นหลักฐาน handover — ช่วยให้ทีมเห็นสถานะ system, dashboard, incident summary ตอน sync.

2 ช่วง sync ต่อวัน:
- **☀️ Sync-up เช้า** (default 08:45)
- **🌙 Sync-up เย็น** (default 20:45)

## ส่วนประกอบหลัก

### Header
- **📸 Daily Sync-up** + วันที่วันนี้
- **Topbar actions** (ทั้งสอง shift)

### Shift Cards (2 การ์ด)
แต่ละการ์ดมี structure เหมือนกัน:

#### Header ของ card
- **Icon** ☀️ / 🌙
- **Title** — "Sync-up เช้า" / "เย็น"
- **Time** — เวลาที่กำหนด (08:45 / 20:45)
- **Badge** — สถานะ:
  - 🟡 **รอ** — ยังไม่ upload
  - 🟢 **สำเร็จ** — upload แล้ว
  - ⚠️ **เลย** — ผ่านเวลา sync แล้วยังไม่มีรูป

#### Body ของ card
**ถ้ามีรูปวันนี้แล้ว:**
- แสดง thumbnail → คลิกเปิด lightbox ดูเต็ม
- Info: ใครอัปโหลด, เวลา
- ปุ่ม **ลบ**
- Hint: "เลือกรูปใหม่เพื่ออัปโหลดทับ"

**ถ้ายังไม่มี:**
- **Drop zone** — ลากรูป / คลิกเลือกไฟล์
- **Preview** — โผล่หลังเลือก
- **Compress progress** — แสดงตอนบีบรูป (auto-compress ก่อน upload)
- **📤 อัปโหลด** button

### Log Table (ท้ายหน้า)
- ประวัติ sync-up ย้อนหลัง (ทีม)
- คอลัมน์: วันที่, shift, ผู้อัปโหลด, thumbnail, actions
- คลิก thumbnail → lightbox

### Lightbox
- ดูรูปเต็มจอ (dark backdrop)
- ✕ ปิด

## ขั้นตอนการใช้งาน

### อัปโหลด Sync-up
1. Screenshot dashboard/monitoring/inbox summary ที่ต้องการ save
2. เปิดหน้า Sync Up
3. ลาก/drop รูปลง card ของ shift (เช้า/เย็น)
4. ระบบ auto-compress (ดู progress bar)
5. Preview ปรากฏ + meta size
6. คลิก **📤 อัปโหลด**
7. Badge เปลี่ยนเป็น 🟢 สำเร็จ

### แทนที่รูปเดิม
1. Card มีรูปแล้ว → คลิก drop zone อีกครั้ง
2. เลือกรูปใหม่
3. Hint "เลือกรูปใหม่เพื่ออัปโหลดทับ" โผล่
4. **📤 อัปโหลด** — รูปเก่าถูกแทนที่

### ลบรูป
1. ปุ่ม **ลบ** ที่ card
2. Confirm dialog
3. Badge กลับเป็น 🟡 รอ

### ดูประวัติ
- เลื่อนลง log table
- คลิก thumbnail รูปวันก่อน ๆ

## Tips

- **Auto-compress** — รูปใหญ่ (>1MB) ระบบบีบก่อน upload
- **Naming convention** — ระบบตั้งชื่อไฟล์ตาม `YYYY-MM-DD_shift.jpg`
- **Time customization** — เวลา sync (08:45/20:45) admin ตั้งได้ที่ Admin → Syncup Config
- **Team-wide** — ทุกคนในทีมเห็น log เดียวกัน
- **Reminder** — ระบบส่ง noti เตือนถ้าใกล้เวลา sync แล้วยังไม่ upload (ถ้า noti config)

## Edge Cases

- **Upload fail** — ตรวจ file size (max 5MB หลัง compress) และ format (jpg/png/webp)
- **ลบไม่ได้** — ถ้ารูปเก่ากว่า X วัน admin ตั้ง lock ไว้ (config)
- **Duplicate upload** — จะแทนที่รูปเดิม (มี confirm)
- **Multi-user** — ถ้าอีกคนอัปโหลดพร้อมกัน → คนที่ save ทีหลังทับ
- **Feature ปิด** — sidebar จะไม่โผล่ syncup

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `syncup.html`
- **API:** `/api/upload`, `/api/syncup` (per team)
- **Admin:** Admin → Syncup Config
