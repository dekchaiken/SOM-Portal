# Alert Monitor — คู่มือการใช้งาน

**หน้า:** `alert-monitor.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `alert-monitor`)
**สิทธิ์:**
- **ดู**: ทุกคน
- **Config** (ปุ่ม ⚙): **Admin**, **Lead**, **Dev**
- **Refresh manual**: ทุกคน

## ภาพรวม

Alert Monitor = Dashboard สรุป **JSM Ops Alert** (จาก **acm-opscenter**) ในรูปแบบวิเคราะห์รายเดือน ปี. ประกอบด้วย:
- KPI: total alerts, months, sync time
- Chart: alerts monthly (Monitoring / Batch / Other)
- Heatmap: hour × month
- Top 10 alerts (แบบ all / per-month / high-freq)
- Compare 2 เดือน
- Auto analysis (AI-generated insight)

## ส่วนประกอบหลัก

### Hero Section
- Title: **Alert Monitor** + team pill "Service Monitoring - SM"
- Sub: pulled from acm-opscenter
- **Sync status** dot (idle / syncing / error) + text
- **↻ รีเฟรช** button
- **⚙ Config** — Admin only

### Hero Stats
- **Alerts (ปีนี้)** — จำนวน alerts รวม
- **Coverage** — จำนวนเดือนที่ sync
- **Last sync** — จากเวลาไหน

### Progress Bar
- แสดงตอน sync history: "กำลัง sync ข้อมูลย้อนหลัง..."
- Percentage bar (X%)

### Year Tabs
- เลือกปี (ปีปัจจุบัน default)

### KPI Cards (4)
- **Total alerts** ในปีที่เลือก
- **Monitoring** — ประเภท monitoring
- **Batch** — ประเภท batch
- **Delta** — เทียบเดือน/ช่วง

### Monthly Chart
- Bar chart alerts รายเดือน แยก Monitoring / Batch / Other

### Auto Analysis
- Panel "วิเคราะห์อัตโนมัติ" — bullet list insight ที่ระบบวิเคราะห์
  - เดือนที่ alert สูงสุด
  - Alert ที่โผล่บ่อย
  - Trend เดือนต่อเดือน

### Compare 2 Months
- Dropdown **A** vs **B**
- คลิก **Compare** → เห็น diff แต่ละ alert (เพิ่ม/ลด)

### Heatmap
- แนวตั้ง: hour (0-23)
- แนวนอน: เดือน
- สีเข้ม = alert เยอะ

### Top 10 Alerts
- **Tabs**:
  - **รวมทั้งช่วง** — top 10 ของปี
  - **แยกรายเดือน** — top 10 per month (มี month strip navigator)
  - **≥20 ครั้ง/เดือน** — เฉพาะ alert ที่ยิงบ่อย
- Table: Rank, Alert Title, Count, Trend (sparkline), Δ (delta)

## ขั้นตอนการใช้งาน

### เช็ค alert ปีนี้
1. เปิด Alert Monitor
2. ปีปัจจุบันเปิดอัตโนมัติ
3. ดู Hero Stats → total alerts
4. Monthly chart — เห็น trend

### Sync ข้อมูลใหม่
1. คลิก **↻ รีเฟรช**
2. Sync dot เปลี่ยนเป็น syncing (animated)
3. Progress bar แสดงถ้ามี history backfill
4. Sync สำเร็จ → dot เขียว, KPI update

### วิเคราะห์แบบเทียบเดือน
1. Scroll ไปส่วน **Compare**
2. เลือกเดือน A (เช่น "2026-06")
3. เลือกเดือน B (เช่น "2026-07")
4. คลิก **Compare**
5. Body แสดง alert ที่เพิ่ม/ลด/ใหม่

### หา Alert ที่ยิงบ่อย
1. Section **Top 10**
2. Tab **≥20 ครั้ง/เดือน**
3. ดู alert ที่ต้อง tune หรือ fix

### ดู Heatmap
1. Scroll ไปส่วน **Alerts รายชั่วโมง × เดือน**
2. Cell เข้ม = ช่วงเวลาที่ alert เยอะ
3. Hover เพื่อดูจำนวน

## Tips

- **Auto analysis** — เป็น text ที่ระบบสรุป, อ่านแล้วเข้าใจ trend เร็ว
- **Delta** — บวก = alert เพิ่ม, ลบ = ลด (เทียบ period ก่อน)
- **Config admin** — เปลี่ยน source (JSM URL/team) ที่ Admin → Alert Monitor Config
- **Sync ช้า** — ครั้งแรก sync backfill 12 เดือน อาจใช้เวลา 30-60 วิ

## Edge Cases

- **Sync fail** — JSM API ล่ม / token expired → ตรวจ Admin → Alert Monitor Config
- **KPI 0** — ยังไม่เคย sync / ทีมไม่มี alert
- **Heatmap ว่าง** — ยังไม่มีข้อมูล hour breakdown
- **Compare ว่าง** — เดือน A/B ไม่มี alert
- **Feature ปิด** — sidebar ไม่โผล่ alert monitor

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `alert-monitor.html`
- **JS:** `assets/js/alert-monitor.js`
- **Admin:** `admin/alert-monitor-config.html`
- **API:** `/api/alert-monitor` (JSM proxy)
