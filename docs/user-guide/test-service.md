# Service Test — คู่มือการใช้งาน

**หน้า:** `test-service.html`
**บทบาทที่ใช้ได้:** ทุก role (feature toggle: `test-service`)
**สิทธิ์:**
- **ใช้ tab test tools**: ทุกคน
- **ใช้ Reconcile Cash-out / Fund-Out**: ทุกคน (แต่ operation จริงต้อง auth ผ่าน backend API)

## ภาพรวม

Service Test = หน้าเดี่ยวสำหรับ **ทดสอบ service** หลัง deploy หรือ **reconcile transaction** ที่ค้าง. รวม 2 mode:
1. **Test Tabs** — iframe embed หน้า test tools ต่าง ๆ (login page, sandbox, monitoring)
2. **Reconcile Panel** — panel ควบคุม reconcile Cash-out + Fund-Out (สำหรับทีมที่ดูแล payment)

## ส่วนประกอบหลัก

### Header
- **⊡ Test Service** title
- **Test tools & reconcile status**

### Tab Bar
- Tabs = list ของ test tool ที่ admin config (ที่ Admin → Test Service Config)
- Actions:
  - **↺ Reload** — reload iframe
  - **↗ Open in New Tab** — เปิดใน tab ใหม่

### Frame Area
- **Iframe** ของ tool ที่เลือก
- **Loading state** — ตอน iframe โหลด
- **Blocked state** — เมื่อ CSP block:
  - 🔗 Icon
  - "ไม่สามารถแสดงในหน้านี้ได้"
  - Hint: "หากใช้ VPN อยู่ สามารถเปิดลิงก์ด้านล่างได้ทันที"
  - Link เปิด new tab

### Reconcile Panel (2 columns)

#### Column 1: 🔁 Reconcile Cash-out
**Quick Params (chips)**:
- **Recon** status: New / Reconciled
- **Transfer** status: Success / Failed / Pending
- **📅 Date**: Auto (default) / Manual
- **Banks**: All / เลือก specific bank

**Detail Form (expand)**:
- **Reconcile Status** dropdown
- **Transfer Status** dropdown
- **Date Auto checkbox** + preview (from/to)
- **Date Manual** — from / to (format: 17-Apr-2026 00:00:00)
- **Banks**: checkbox all + bank grid (custom select)
- **Optional filters**:
  - Request Channel / Status
  - TPP ID / Utiba ID
  - EW Account
  - Request Amount
  - Bank Acct No / Name
  - **Limit** (default 10,000, max 50,000)

**Actions**:
- **🔍 Check Now** — query API
- **Reset** ↺

**Results**:
- Count "พบรายการ N"
- Last check time
- Table — result data
- **Debug panel** (toggle 👁️):
  - Endpoint URL
  - Params (JSON)
  - Token (masked)
  - Response (raw JSON)

#### Column 2: 🔧 Fund-Out (Jenkins)
- **Fund-Out Reconcile** — ตรวจ Jenkins job status
- ปุ่ม **Check** — ping Jenkins job

## ขั้นตอนการใช้งาน

### ทดสอบ service ผ่าน iframe tool
1. เลือก tab จาก tab bar
2. รอ iframe โหลด
3. ใช้งาน tool ปกติ (login ครั้งแรก)
4. **↗ Open in New Tab** ถ้า iframe block

### Reconcile Cash-out
1. เปิดหน้า → panel Cash-out เริ่มด้วยค่า default (Recon: New, Transfer: Success, Auto date)
2. คลิก header เพื่อ expand form
3. ปรับ status / date / banks / optional
4. คลิก **🔍 Check Now**
5. รอผลลัพธ์:
   - **✅ Empty** = ไม่มีรายการค้าง
   - **📋 List** = ตารางรายการ
   - **❌ Error** = ดู error message
6. ดู debug panel ถ้าต้อง trace API

### แก้ Reconcile ทีละบัญชี
1. ในตารางผลลัพธ์ → คลิก transaction
2. อ่าน detail
3. ทำตาม runbook (ที่ **Ops Runbook**)

### ตรวจ Fund-Out
1. Column 2 → **Check**
2. Jenkins job status แสดง
3. Follow link ไป Jenkins ถ้าต้อง trigger manual

## Tips

- **Quick chips** — แสดงค่า current settings; คลิก reset (↺) เพื่อกลับ default
- **Date auto** — คำนวณจากเวลาปัจจุบัน (ช่วง lookback config ได้)
- **Bank select** — Custom หมายถึงเลือกทีละธนาคาร (ไม่ใช่ All)
- **Debug info** — save token ห้าม screenshot แชร์
- **Limit ใหญ่** — result เยอะ = query ช้า / browser ตอบสนองช้า

## Edge Cases

- **Iframe blocked (CSP)** — โผล่ blocked state → เปิด new tab แทน
- **Reconcile API 401** — token expired / user ไม่มีสิทธิ์ → refresh หน้า login
- **Reconcile ว่างแต่มีจริง** — ตรวจ date range + filter — บาง filter อาจเข้มไป
- **Fund-Out check fail** — Jenkins ตาย / VPN ไม่ได้ต่อ
- **Bank grid ว่าง** — Admin ต้อง config bank list ใน system-settings
- **Multi-team** — reconcile ใช้ได้เฉพาะทีมที่ config API endpoint (ทีม Payment/SM)

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `test-service.html`
- **API:** `/api/test-records`, `/api/fundout-proxy`
- **Admin:** Admin → Test Service Config
