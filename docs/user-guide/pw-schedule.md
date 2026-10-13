# PW Schedule (Planwork) — คู่มือการใช้งาน

**หน้า:** `pw-schedule.html`
**บทบาทที่ใช้ได้:** SM team เท่านั้น (team = `sm`)
**สิทธิ์เข้าถึง:**
- **ดู**: ทุกคนในทีม SM
- **สร้าง/แก้/ลบ Planwork**: **Lead**, **Admin**, **Dev**
- **Tick complete**: ทุกคน

## ภาพรวม

PW Schedule = **Planwork Schedule** — ตารางงาน planned change / maintenance ที่ทีม SM ต้องดำเนินการเป็น "รอบ" (round). แต่ละรอบมีรายการ PW หลายรายการ พร้อม start/end, MOP, task steps, ownership, และ status.

รอบทั่วไป:
- ตี 1 (01:00)
- ตี 3 (03:00)
- 05:00 หรือรอบพิเศษตามแผน

## ส่วนประกอบหลัก

### Topbar Actions
- **⧗ Cron** — เปิด Cron expression builder (สำหรับตั้ง schedule)
- **↻ Sync Sheet** — sync ข้อมูลจาก Google Sheet ที่ทีมใช้
- **↗ Send Noti** — ส่ง notification แจ้งทีมเรื่อง PW รอบนี้
- **＋ Add PW** — เพิ่ม planwork ใหม่ (lead/admin)
- **↺ Refresh** — reload

### Round Selector (ด้านบน)
- แสดงรอบปัจจุบัน + dropdown เปลี่ยนรอบ
- **Live indicator** — auto-refresh ทุก N วินาที
- **Enable sound** — เปิดเสียงแจ้งเตือน (browser notification)

### Stats Cards
- **Total** — จำนวน PW ทั้งหมดในรอบ
- **Internal** — จำนวน PW ของทีมภายใน
- **External** — จำนวน PW ของทีมภายนอก (เราแค่ standby)
- **Done** — จำนวนที่ทำเสร็จแล้ว

### Next Up List
- แสดง PW ที่กำลังจะเริ่มถัดไป (ตาม start time)

### Progress Bar
- แถบ progress "X / Y done"

### PW List
- รายการ PW ทั้งหมดในรอบ เรียงตามเวลา
- แต่ละแถวมี checkbox tick เมื่อทำเสร็จ
- สีต่างกันตาม type

### Empty State
- ถ้ายังไม่มี PW ในรอบ → แสดง "ยังไม่มี PW ในรอบนี้ กด ＋ Add PW"

## ขั้นตอนการใช้งาน

### เพิ่ม Planwork ใหม่ (lead/admin)
1. คลิก **＋ Add PW**
2. เลือก **Type** (Internal / External / Standby ฯลฯ)
3. กรอก:
   - **PW Name** — เช่น "CMT-14061 Upgrade EKS 1.32 → 1.35 (Nano)"
   - **Start / End** — datetime picker
   - **MOP link** — Google Docs URL
   - **Meet link** — Google Meet URL
   - **Task steps** — text หลาย บรรทัด (เช่น "04:15 - test all service")
   - **Impact** — เช่น "No Service Impacted"
   - **Owner** — ชื่อคนที่รับผิดชอบ
   - **Ticket** — เลข ticket (SMC-xxxxx)
   - **Remark** — หมายเหตุ
   - **Attachments** — แนบรูป (≤ 5MB) หรือข้อความ (จะกลายเป็น reply ใน thread)
4. คลิก **Save**

### ทำ Task ในรอบ
1. เข้าดูรอบปัจจุบัน (auto-select ตามเวลา)
2. รอเวลา start ของแต่ละ PW
3. ทำตาม task steps ใน list
4. คลิก checkbox หน้ารายการเมื่อทำเสร็จ → progress bar อัปเดต
5. เมื่อทำครบทุกรายการ → แสดง banner "All tasks completed" 🎉

### Sync จาก Google Sheet
- ทีม SM มี Google Sheet master สำหรับ PW plan
- คลิก **↻ Sync Sheet** จะดึงข้อมูลจาก Sheet เข้ามา (สร้างรอบใหม่/เพิ่ม PW)
- ใช้เมื่อ plan ถูกอัปเดตใน Sheet แต่ยังไม่มีในระบบ

### Send Notification
- คลิก **↗ Send Noti** → ส่งแจ้งเตือนใน channel ที่ตั้งไว้ (Line/Slack/Email)
- ใช้ทีมทั้งหมดทราบว่ารอบ PW กำลังจะเริ่ม

### เปิดใช้ Sound Alert
- คลิก **Enable sound** ครั้งแรก → browser ขอ permission
- เมื่อ PW ใกล้ถึงเวลา start → เสียงเตือน (5-10 นาทีก่อน)
- **Enable noti** — เปิด browser notification (แม้ tab อยู่ background)

## Tips

- **Auto-refresh** — Live dot กระพริบเมื่อ refresh สำเร็จ
- **แนบข้อความ** — ใน attachment สามารถแนบข้อความอย่างเดียวได้ (จะไปโผล่ใน thread)
- **Cron builder** — ⧗ Cron เปิด `cron-builder.html` แบบ modal ช่วยสร้าง cron expression
- **Lightbox** — คลิกรูปแนบจะเปิด lightbox ดูภาพเต็ม

## Edge Cases

- **Sound ไม่ทำงาน** — browser บาง version block auto-play → ต้องคลิก Enable sound ครั้งแรก
- **PW ข้ามรอบ** — end > next round → PW จะโผล่ในทั้งสองรอบ
- **Sync Sheet ซ้ำ** — กด sync หลายครั้งไม่สร้าง PW ซ้ำ (dedupe by name+start)
- **Delete PW** — ปุ่ม Delete โผล่ตอน edit mode → มี confirmation
- **Sidebar ไม่โผล่ในทีมอื่น** — PW Schedule จำกัดที่ team = `sm` เท่านั้น (multi-team)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `pw-schedule.html`, `cron-builder.html`
- **JS:** `assets/js/pw-schedule.js`
- **API:** `/api/pw-schedule`
