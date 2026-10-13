# Settings — คู่มือการใช้งาน

**หน้า:** `settings.html`
**บทบาทที่ใช้ได้:** ทุก role

## ภาพรวม

หน้า Settings สำหรับ **user** = ปรับ appearance ของ Portal (UI Theme + Color Mode). Setting ระบบ (session timeout, rate limit ฯลฯ) อยู่ที่ **Admin → System Settings** ไม่ใช่หน้านี้.

## ส่วนประกอบหลัก

### Section 1: 🎨 UI Theme
เลือก 1 ใน 4 theme:

#### 🌊 Glass (Default)
- Frosted glass effect + orange accents
- นุ่มนวล เหมาะกับ daily use
- ทำงานได้ทั้ง light + dark

#### 🏢 Enterprise
- Flat + minimal + professional
- เหมาะกับการใช้เป็นทางการ / meeting
- ทั้ง light + dark

#### 💻 Console
- Terminal / monospace vibe
- **บังคับ dark mode** (light disabled)
- เหมาะกับ dev / SRE

#### 🍁 Warm
- Cream / brown / paper tone
- อ่านง่าย ยาว
- ทั้ง light + dark

**Theme card** ประกอบด้วย:
- **Preview** — mini mockup ของ layout (sidebar, topbar, card, item)
- **Name + badge "Default"** (ถ้าเป็น default)
- **Description**
- **Meta pills** — feature ของ theme (เช่น "Dark only")
- **Use this theme** button

### Section 2: ☀︎ Color Mode
- **☀︎ Light** — โหมดสว่าง
- **☾ Dark** — โหมดมืด
- Toggle แยกจาก UI theme (Glass + Dark, Warm + Light เลือกได้อิสระ)
- Hint text: "Console theme บังคับ dark เท่านั้น" (ถ้าเลือก Console จะ lock)

### Section 3: อื่น ๆ (อาจมี)
- Language preference (future)
- Notification settings (future)
- Sidebar preferences

## ขั้นตอนการใช้งาน

### เปลี่ยน UI Theme
1. คลิก card ของ theme ที่ต้องการ
2. Preview ทันที (live)
3. หรือคลิก **Use this theme** ที่ card
4. Theme ถูก save ใน localStorage
5. ทุกหน้า apply theme นี้ทันที (ไม่ต้อง reload)

### เปลี่ยน Color Mode
1. คลิก **☀︎ Light** หรือ **☾ Dark**
2. Apply ทันที
3. Sidebar → "Dark mode" pill ก็ toggle ตรงนี้ได้เช่นกัน

### ผสม Theme + Mode
- Glass + Light (default)
- Glass + Dark (สวย)
- Enterprise + Light (สำหรับ demo)
- Enterprise + Dark (สำหรับ night work)
- Console → บังคับ Dark
- Warm + Light (อ่านง่ายกลางวัน)
- Warm + Dark (อ่านง่ายกลางคืน)

## Tips

- **Preview live** — คลิก theme → preview ใน card ก่อน apply
- **Sidebar toggle** — ปุ่ม "Dark mode" ที่ sidebar = shortcut สลับ light/dark เร็ว
- **Console theme** — ถ้าใช้ Console แล้ว switch light → toggle auto กลับมา dark (dark-only)
- **Setting per user** — theme เก็บใน localStorage ต่อ browser (ไม่ sync device)

## Edge Cases

- **หลัง clear localStorage** — theme reset เป็น default (Glass + Light)
- **Console + Light** — Light button จะ disabled (mode-lock hint แสดง)
- **Theme ไม่ apply บางหน้า** — refresh หน้า (บาง content HTML ตัดไม่ถึง theme system)
- **บาง element ยังใช้สีเก่า** — inline styles อาจ override theme (bug report ให้ admin)

## Ref: Theme Files

- `assets/js/theme.js` — theme controller
- `assets/css/ui-themes.css` — theme definitions
- `assets/css/dark.css` — dark mode variables
- Theme keys: `glass`, `enterprise`, `console`, `warm`

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `settings.html`
- **JS:** `assets/js/theme.js`
- **CSS:** `ui-themes.css`, `dark.css`
