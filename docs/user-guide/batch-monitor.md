# Batch Monitor — คู่มือการใช้งาน

**หน้า:** `batch-monitor.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `batch-monitor`)
**สิทธิ์:**
- **ดู**: ทุกคน
- **สร้าง Jira ticket จาก failed job**: ทุกคน (`write` action)
- **แก้ Batch Records / Report**: **Lead**, **Admin**, **Dev**

## ภาพรวม

Batch Monitor = หน้ารวมสถานะ Jenkins batch job ของหลาย server ในหน้าเดียว. ดึงข้อมูลผ่าน `jenkins-proxy`. รองรับ:
- **Auto-refresh** ทุก 60 วิ
- **Filter** ตาม status / search / time range
- **สร้าง Jira ticket** จาก failed job ด้วย 1 คลิก (พร้อม field auto-fill)
- **Batch Records** — บันทึกประวัติ incident batch
- **Batch Report** — สรุปรายงาน

## ส่วนประกอบหลัก

### Header
- **📊 Batch Records** — เปิด modal ประวัติ batch incident
- **📋 Batch Report** — สรุปรายงานประจำวัน/เดือน
- **↺ Refresh** — reload manual
- **Auto-toggle** — เปิด/ปิด auto-refresh 60s
- **Last refresh** — timestamp

### Server Tabs
- แต่ละ tab = 1 Jenkins server (config ที่ Admin → Jenkins Servers)
- คลิกสลับ server

### Control Row (Stats + Filter)
- **Chips** จำนวน per status:
  - 🔴 **Failed**
  - 🟡 **Running**
  - 🟢 **OK**
  - ⚫ **Aborted**
  - **Other**
- **Search box** — พิมพ์ค้น job name (real-time)
- **Status filter dropdown**
- **⏱ Time filter** — เปิด panel:
  - Date + Start time + End time
  - **Cross-midnight hint** (ถ้า end < start ⇒ ข้ามคืน)
  - Checkbox "Overlap mode"
  - Apply / Clear
- **⬇ Export** — export ตาราง filtered เป็น CSV
- **Visible count** — จำนวนที่แสดง

### Jobs Container
- ตาราง job:
  - Job name, status, start time, duration, build number, link
  - คลิกแถวเข้า job detail (Jenkins)
  - ถ้า Failed → มีปุ่ม **⚡ Create Ticket** ในแถว

### Batch Records Modal
- เลือกเดือน → ดูตาราง incident
- Export CSV
- Admin เห็นปุ่ม 🗑 Clear All (ระวัง!)

### Batch Ticket Create Modal
เมื่อคลิกสร้าง ticket จาก failed job:
- **Summary** — auto-fill "Job name + Fail + วันที่"
- **Work Type** — Batch failure / Manual / etc.
- **Fault Start** — datetime picker
- **Priority** — P1/P2/P3
- **Issue** — ประเภทปัญหา
- **File Type** — Report / Data / Log (มี subtype)
- **⚡ Create Ticket** → Jira SMC ticket ใหม่

### Success Modal
- แสดง key ticket + ปุ่ม "เปิดใน Jira ↗"

## ขั้นตอนการใช้งาน

### ตรวจ status batch วันนี้
1. เลือก server tab
2. Auto-refresh ทำงาน (บอก last refresh)
3. Failed chip แดง = มีปัญหา
4. คลิก **Failed** ใน status filter เห็นเฉพาะ failed job

### เจาะช่วงเวลา (Time Filter)
1. คลิก **⏱ Time**
2. เลือก date + start time + end time
3. ถ้า cross-midnight → hint บอก
4. **Apply** — ตารางกรองเฉพาะ job ในช่วงนั้น
5. Overlap = job ที่มี start_time OR end_time อยู่ในช่วง
6. **Clear** = reset

### สร้าง Jira Ticket จาก Failed Job
1. หา job ที่ **Failed**
2. คลิกปุ่ม **⚡ Create Ticket** ในแถว
3. Modal โผล่ พร้อม summary/priority pre-fill
4. ปรับ field ตามจริง
5. เลือก **File Type** — ถ้า type ต้อง sub type → dropdown โผล่
6. คลิก **⚡ Create Ticket**
7. Success modal → เปิดใน Jira ได้เลย

### Batch Records
1. คลิก **📊 Batch Records**
2. เลือกเดือน dropdown
3. ตาราง incident รายเดือน
4. Export CSV

### Batch Report
1. คลิก **📋 Batch Report**
2. ระบบสรุปสถิติ per server / month
3. Print / export

### Auto-refresh
- คลิก **auto-toggle** → ปิด (สำหรับดู stationary)
- Refresh ทุก 60 วิ (config ได้ที่ system-settings)

## Tips

- **Sound** — บาง config มี beep เมื่อมี job fail ใหม่
- **Copy job name** — คลิกขวาบน job name → copy
- **Filter combine** — search + status + time filter ใช้ได้พร้อมกัน (AND)
- **CSV export** — export ที่ **filter อยู่** ตอนนั้นเท่านั้น (ไม่ใช่ full)
- **Nav strip** — Back / breadcrumb เมื่อ drill-down job

## Edge Cases

- **Server tab ว่าง** — ไม่มี Jenkins server config → Admin → Jenkins Servers
- **401 / Auth fail** — Jenkins token หมดอายุ → update ที่ Admin
- **Job ไม่ update** — Jenkins polling delay 60s หรือ Jenkins เอง slow
- **Create ticket fail** — Jira token expired / mandatory field ไม่ครบ
- **Cross-midnight time filter** — ต้องเข้าใจว่า end < start = ข้ามวัน (00:00 - 03:00 หา job ตี 1 ตี 3)
- **Auto-refresh หยุด** — ถ้า tab background นาน browser อาจ throttle

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `batch-monitor.html`
- **API:** `/api/jenkins-proxy`, `/api/jenkins-servers`, `/api/batch-records`, `/api/jira`
- **Admin:** Admin → Jenkins Servers, Batch Meta, Batch Monitor Noti
