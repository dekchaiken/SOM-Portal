# Analytics — คู่มือการใช้งาน

**หน้า:** `analytics.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `analytics`)

## ภาพรวม

Analytics = Dashboard สถิติของทีม แสดง KPI, trend, และ breakdown จาก **Jira** (ผ่าน API + cache). ครอบคลุม 3 มิติหลัก:
1. **Server / Incident** — ticket incident + severity
2. **Batch** — batch failure ticket
3. **Monitoring** — coverage ของ monitoring

## ส่วนประกอบหลัก

### Header Controls
- **📅 Date range** — From / To (default = ปีปัจจุบัน)
- **↺ Refresh** — reload ข้อมูล (ใช้ cache)
- **⟲ Force** — bypass cache ดึงสด จาก Jira (ช้าแต่แม่น)
- **Status pill** — แสดงสถานะ loading / cache time

### Main Tabs
1. **Server** (default)
2. **Batch**
3. **Monitoring**

## Tab: Server (Incident)

### Section 1: Trend Chart
- Line/bar chart ของ SM Detection % ในช่วงเวลาที่เลือก
- คลิก data point ดู detail

### Section 2: KPI Cards (Hero)
- **SM Detection % (All)** — % incident ที่ SM detect ก่อนผู้ใช้ (target 90%)
- **Internal** — % ที่มาจาก internal cause (target 75%)
- **External** — % ที่มาจาก 3rd-party
- Progress bar + delta vs target (🟢 = เข้าเป้า, 🔴 = ต่ำกว่า)

### Section 3: Severity Breakdown (3 sections)
**By SM Detection %:** Sev1 / Sev2 / Sev3 (แต่ละ severity มีของ All / Internal / External)
- **By SM** — จำนวนที่ SM เจอ
- **Total** — จำนวนทั้งหมด
- **%** — By SM / Total

## Tab: Batch

### Chart
- Batch ticket trend

### Stat Cards (คลิกได้)
คลิก → เปิด SMC ticket list ใน Jira:
- **Total Tickets** — batch ticket ทั้งหมด
- **Closed** — ปิดแล้ว
- **Close Rate** — %

### Internal / External (Hero)
- **Internal %** — batch cause ภายใน
- **External %** — batch cause ภายนอก
- Progress bar + closed count

### Action Breakdown Bar
- Breakdown ตาม action taken

## Tab: Monitoring

- Monitoring coverage stats (config-driven, อาจมี custom charts)

## ขั้นตอนการใช้งาน

### ดูสถิติปีนี้
1. เปิด `analytics.html` — default = current year
2. Tab **Server** เปิดอัตโนมัติ
3. ดู SM Detection % หลัก + severity breakdown
4. สลับ tab **Batch** ดู batch tickets

### เจาะช่วงเดือน
1. เลือก From/To date
2. คลิก **↺ Refresh**
3. ทุก card + chart อัปเดตตาม range

### Force Refresh (Bypass Cache)
1. เมื่อสงสัยว่า cache เก่า ให้คลิก **⟲ Force**
2. ระบบ query Jira สด (2-10 วินาที)
3. Cache จะ update ครั้งใหม่

### Drill-down เข้า Jira ticket
- คลิกการ์ด "Total Tickets" / "Closed" / severity cards
- ระบบเปิด Jira ในแท็บใหม่ พร้อม filter ที่ตรงกับ card นั้น

## Tips

- **Cache** — ปกติ cache ~15-60 นาที (config ใน system-settings)
- **Target** — 90% All, 75% Internal (default) — Admin แก้ได้ใน Analytics config
- **Present-ready** — layout เหมาะกับ TV/projector, สลับ dark mode ได้
- **Multi-team** — สลับ team switcher เพื่อดูของทีมอื่น (super_admin)

## Edge Cases

- **Chart ว่าง** — ช่วงเวลาที่เลือกไม่มี ticket → empty state
- **Force ช้า** — Jira API หน่วง; รอ 10-30 วินาที
- **Delta ผิดปกติ** — ตรวจ Jira filter หรือ project key (JIRA_PROJECT_KEY ใน config.php)
- **Cache stuck** — Force refresh
- **Chart ไม่ update หลังเปลี่ยน date** — ลอง refresh manual (↺) ครั้งที่สอง

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `analytics.html`
- **JS:** `assets/js/analytics.js`, `analytics-features.js`, `analytics-dashboard.js`
- **API:** `/api/analytics`, `/api/jira`
