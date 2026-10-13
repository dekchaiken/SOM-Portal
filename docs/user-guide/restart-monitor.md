# EKS Restart Monitor — คู่มือการใช้งาน

**หน้า:** `restart-monitor.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `restart-monitor`)

## ภาพรวม

EKS Restart Monitor = ติดตาม **restart events** ของ pod ใน Kubernetes cluster (EKS TMN / EKS NANO / OCP). ใช้วิเคราะห์:
- Pod ที่ restart บ่อย
- OOMKilled / Critical events
- Trend ราย 7d / 30d / month / custom range

รองรับ 2 view:
1. **📊 Analyzed** — วิเคราะห์แล้ว (aggregated) — pod-level
2. **🗒 Raw / Auto** — raw event stream

## ส่วนประกอบหลัก

### Header
- **Last updated** timestamp
- **📅 รายงานรายเดือน** — เปิด modal สรุปรายเดือน
- **↺ Refresh** — reload

### Main Tabs
1. **Analyzed** — default
2. **Raw / Auto**

### Runway Bar (ใน tab)
เลือก cluster:
- 🟠 **EKS TMN** (acm-tmn-eks-prod)
- 🔵 **EKS NANO**
- 🟢 **OCP**

### Period Tabs (เลือกช่วงเวลา)
- **7d** / **14d** / **30d** / **This month** / **Custom range**
- Custom: date from / to picker

### KPI Cards
- **Restarts · 7d** — จำนวน restart ใน 7 วัน
- **Critical · 7d** — restart ที่ critical
- **OOMKilled · 30d** — memory kill
- **Days covered** — จำนวนวันในช่วง

### Daily Reports Card
- **← / →** navigate วัน (มี keyboard shortcut ←/→)
- **Day date input** — เลือกวันโดยตรง
- **Day pills** — pill ของแต่ละวันในช่วง (สีตาม severity)
- **Sort toggle** — ใหม่→เก่า / เก่า→ใหม่

### Selected Day Summary
- แสดง summary ของวันที่เลือก

### Pods Section
- Tab view: **รวมช่วง (aggregated)** / **รายวัน**
- ตาราง pod:
  - Pod name (monospace)
  - Restart count
  - Critical count
  - Last restart time
  - Reason
- คลิก pod → **Pod Detail** slide-in:
  - Memory usage bar
  - Event timeline
  - Container logs (ถ้ามี)
  - **✕ ปิด** หรือ **ESC**

### Auto-refresh
- ทุก **5 นาที**
- Keyboard shortcuts: **← →** เปลี่ยนวัน, **ESC** ปิด pod detail

### Raw / Auto Tab
โครงสร้างคล้าย Analyzed แต่แสดง:
- Raw restart events (ทีละ event)
- ไม่ aggregated per pod
- ใช้สำหรับ dig deep เข้าไปดู events ปลีกย่อย

## ขั้นตอนการใช้งาน

### เช็ค restart pod สัปดาห์นี้
1. เปิด Restart Monitor
2. Tab **Analyzed** (default) + Runway **EKS TMN**
3. Period **7d**
4. ดู KPI — Restarts, Critical, OOMKilled
5. เลื่อนไป Pods table → เรียงจำนวน restart มากสุด
6. คลิก pod ที่ suspicious → เห็น timeline

### เจาะดูวันเฉพาะ
1. Daily Reports card
2. คลิก day pill หรือ date picker
3. Selected day summary + pods table ของวันนั้น

### สลับ Cluster
1. คลิก runway button (TMN / NANO / OCP)
2. KPI + daily reports + pods update

### Custom range
1. คลิก **Custom** ใน period tabs
2. เลือก **From** + **To**
3. ระบบ query + แสดง result

### รายงานรายเดือน
1. คลิก **รายงานรายเดือน**
2. Modal สรุป: total restarts, top pods, incidents, ฯลฯ
3. Export CSV/PDF ถ้ามี

### Pod Detail
1. คลิก pod name ใน table
2. Detail slide-in ทางขวา
3. เห็น memory bar + timeline
4. Navigate pod ถัดไปด้วย keyboard (← →) 
5. **ESC** ปิด

## Tips

- **Keyboard shortcuts** — ← → เปลี่ยนวัน, ESC ปิด detail
- **Sort restart** — คลิก column header
- **Aggregated vs Raw** — Analyzed = สรุป, Raw = ทุก event
- **OOMKilled** — pod ที่ memory limit ต่ำเกิน → ปรับ resource limits
- **Compact mode** — table ที่มี pod เยอะจะ scroll horizontal

## Edge Cases

- **KPI ว่าง** — cluster ไม่มี data ในช่วง / API fail
- **Pod detail ว่าง** — pod ไม่มี memory metric (ต้อง config metrics-server)
- **Auto-refresh หยุด** — tab background — browser throttle
- **Multiple clusters** — restart pattern คนละแบบ → เลือก cluster ถูกต้อง
- **Custom range เกิน 90 วัน** — query อาจ timeout (จำกัด)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `restart-monitor.html`
- **API:** `/api/restart-monitor` (proxy ไป Kubernetes / Prometheus)
