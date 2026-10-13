# Shift Schedule — คู่มือการใช้งาน

**หน้า:** `schedule.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `schedule`)
**สิทธิ์เข้าถึง:**
- **ดู**: ทุกคน
- **แก้ตารางเวร (drag/drop)**: **Lead**, **Admin**, **Dev**
- **ขอลา**: ทุกคน (ของตัวเอง)
- **อนุมัติลา**: **Lead**, **Admin**

## ภาพรวม

Shift Schedule คือปฏิทินตารางเวรของทีม แสดง 2 shift หลัก:
- **Shift #1** (09:00–21:00) — TDPK office / W@H / On-Call
- **Shift #2** (21:00–09:00) — W@H / On-Call

พร้อมด้วยระบบ **ขอลา (Leave Request)**, **วางแผนวันหยุด (Holiday Plans)**, และ **สถิติรายบุคคล**.

## ส่วนประกอบหลัก

### Topbar Actions
- **🎌 Holiday Plans** — เปิดโหมดวางแผนวันหยุดประจำปี
- **📷 Export Image** — export ปฏิทินเดือนนี้เป็นรูป
- **✏️ Leave Request** — เปิด modal ขอลา / ดูประวัติ
- **↺ Reload** — refresh ข้อมูล

### Calendar View
- **Month navigation**: ← / → เปลี่ยนเดือน · **Today** กลับวันนี้
- **👤 เฉพาะวันของฉัน** — filter แสดงเฉพาะวันที่คุณมีงาน
- **ตาราง** (rows × days of month):
  - Row 1-3: **Shift #1** — TDPK / W@H / On Call
  - Row 4-5: **Shift #2** — W@H / On Call
  - Row 6-8: Vacation / Sick / Business leave
- **แต่ละ cell** = ชื่อคนที่เข้าเวรวันนั้น (chip สี)
- **On-Call** จะมีสีเน้นพิเศษ

### สถิติรายบุคคล (Stats Table)
- ตารางสรุปจำนวนวันของแต่ละคนในเดือนนี้:
  - Shift#1 TDPK / Shift#1 W@H / Shift#2 W@H
  - On-Call ทั้งสอง shift
  - Vacation / Sick / Business

### วันลาพักร้อนประจำปี (Vacation Summary)
- สรุปโควตาวันลาพักร้อน (VC) ทั้งปี ของทุกคน
- แสดง: total quota / used / remaining

## ขั้นตอนการใช้งาน

### ดูเวรตัวเองในเดือนนี้
1. คลิก **👤 เฉพาะวันของฉัน**
2. ปฏิทินจะกรองแสดงเฉพาะวันที่คุณมีงาน (chip ของคุณ)
3. ตัวเลขข้าง ๆ ปุ่มบอกจำนวนวัน

### ขอลา (Leave Request)
1. คลิก **✏️ Leave** ที่ topbar
2. Tab **✏️ ขอลา**:
   - เลือกประเภท: 🟢 **Vacation** (พักร้อน) / 🔴 **Sick** (ป่วย) / 🟣 **Business** (ธุรกิจ)
   - เลือกวันในปฏิทิน (คลิก single หรือ drag range)
   - เลือก **Duration**: Full day / Half day (เช้า/บ่าย)
   - ระบุ **เหตุผล** ถ้าจำเป็น
   - ระบบจะแสดง **quota remaining** และเตือนถ้าโควต้าไม่พอ (สำหรับ vacation)
3. คลิก **Submit**
4. ผู้อนุมัติ (Lead/Admin) จะได้รับ notification

### ดูประวัติการขอลา
1. เปิด Leave Modal → tab **🗓 ประวัติขอลา**
2. เห็นรายการทั้งหมด: pending / approved / rejected
3. Badge สีแดง = จำนวน pending ที่ยังไม่ได้ตอบ

### วางแผนวันหยุดประจำปี (Holiday Plans)
1. คลิก **🎌 Holiday Plans**
2. หน้าเปลี่ยนเป็นตาราง year view (ทุกเดือน)
3. คลิก **✏️ วางแผนของฉัน**
4. เลือกวันที่ต้องการลาในปฏิทินย่อ (คลิกเพื่อ toggle)
5. คลิก **💾 บันทึก**
6. ระบบใช้ข้อมูลนี้ประกอบการจัดตารางเวรรอบต่อไป

### แก้ไขตารางเวร (Lead/Admin เท่านั้น)
- Click cell → พิมพ์ชื่อ / เลือกจาก dropdown
- Drag drop chip ระหว่าง cell
- Auto-save

## Tips

- **Export ไปแชร์** — ปุ่ม 📷 export รูปหน้าปฏิทินเดือนนี้ (แชร์ Line/Slack ได้)
- **Half day** — บอก AM/PM ให้ทีมรู้ว่าครึ่งไหน
- **Quota check** — ระบบเช็คโควต้า vacation อัตโนมัติ (จาก user.leave_quota)
- **Business leave** — ไม่หักโควตา แต่ต้องอนุมัติ
- **โควต้าปีที่ผ่านมา** — ปฏิทินย้ายปีอัตโนมัติเมื่อขึ้นปีใหม่

## Edge Cases

- **ขอลาแล้วต้องยกเลิก** — ไปที่ tab ประวัติ → คลิก ✕ (ทำได้เฉพาะ pending)
- **Quota ไม่พอ** — แจ้ง **Admin** เพื่อ adjust ที่ Admin → Users
- **ลาซ้อนวัน** — ระบบจะแจ้งเตือนถ้า overlap กับวันที่มี pending อยู่แล้ว
- **ลาแล้วยังขึ้นเวร** — Lead ต้องแก้ตารางเวรเอง (ระบบไม่ auto-remove)
- **Vacation quota reset** — ทุกวันที่ 1 ม.ค. (จัดโดย admin)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `schedule.html`, `holiday-plans.html`
- **API:** `/api/schedule`, `/api/leave-request`, `/api/holiday-plans`
