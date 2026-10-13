# Change Password — คู่มือการใช้งาน

**หน้า:** `change-password.html`
**บทบาทที่ใช้ได้:** ทุก role

## ภาพรวม

หน้าเปลี่ยน password ใช้ 2 mode:
1. **First Login** — บังคับเปลี่ยน password ครั้งแรกหลัง admin สร้าง account
2. **Update Password** — ผู้ใช้เลือกเปลี่ยนเอง (ต้องใส่ password ปัจจุบัน)

รองรับ **password strength meter** และ **validation rules** real-time.

## ส่วนประกอบหลัก

### Header Card
- Logo + brand
- Title: **"Set new password"**
- **Status pill**:
  - 🆕 **First Login** — ครั้งแรก
  - 🔄 **Update Password** — เปลี่ยนตามปกติ

### Alert Bar
- แสดง error / info (เช่น "รหัสผ่านเดิมไม่ถูก")

### Form
1. **รหัสผ่านปัจจุบัน** (แสดงเฉพาะ mode Update, ไม่แสดงตอน first login)
   - Input password + 👁 toggle show/hide
2. **รหัสผ่านใหม่**
   - Input password + 👁 toggle
   - **Strength meter** — bar สี:
     - 🔴 Weak
     - 🟠 Fair
     - 🟡 Good
     - 🟢 Strong
   - **Rules checklist** (สี ✓/✗ real-time):
     - อย่างน้อย **8 ตัวอักษร**
     - มี **ตัวอักษร** (a-z A-Z)
     - มี **ตัวเลข** (0-9)
     - **ไม่ซ้ำ** กับ password เดิม
3. **ยืนยันรหัสผ่านใหม่**
   - Input + 👁 toggle
   - ต้องตรงกับช่องด้านบน

### Submit Button
- **Set Password & Continue** (mode first login)
- **Change Password** (mode update)
- Spinner ตอนส่ง

### Success Overlay
- Progress bar สีเขียว
- "Password changed" → redirect back

## ขั้นตอนการใช้งาน

### First Login (เข้าครั้งแรก)
1. Login ด้วย password ที่ admin ให้
2. ระบบ redirect ไป `change-password.html?first=1`
3. กรอก **รหัสผ่านใหม่** (ตรวจ rules ครบ)
4. กรอก **ยืนยัน**
5. คลิก **Set Password & Continue**
6. Success → เข้า Dashboard

### เปลี่ยน Password ปกติ
1. หน้า **Profile** → หรือ menu user → **Change password**
2. Redirect มา `change-password.html`
3. กรอก:
   - **รหัสผ่านปัจจุบัน**
   - **รหัสผ่านใหม่** (ผ่าน rules)
   - **ยืนยัน**
4. คลิก **Change Password**
5. Success → กลับหน้าเดิม

## Password Rules (Server-side)

- Min 8 characters
- Must contain letter + digit
- Not same as current
- ระบบใช้ bcrypt hash (server)

## Tips

- **Strength meter** — คำนวณจากความยาว + variety (upper, lower, digit, symbol)
- **Show password** — คลิก 👁 เพื่อ toggle
- **จำ password** — แนะนำใช้ password manager (1Password, Bitwarden)
- **Password ซ้ำ** — ระบบตรวจกับปัจจุบันเท่านั้น (ไม่เช็ค history)

## Edge Cases

- **รหัสเดิมผิด** — Alert "รหัสผ่านปัจจุบันไม่ถูกต้อง"
- **Rate limit** — เปลี่ยนผิดหลายครั้ง → lock ชั่วคราว
- **Rule ไม่ครบแต่กด submit** — button disabled
- **Confirm ไม่ตรง** — alert "รหัสผ่านไม่ตรงกัน"
- **Session หมด** — redirect ไป login page

## Ref: Forgot Password

หน้าอีกที่เกี่ยวข้อง:
- **`forgot-password.html`** — ขอ reset ผ่าน email
- **`reset-password.html`** — ตั้งใหม่ผ่าน token จาก email

## ไฟล์ที่เกี่ยวข้อง

- **HTML:** `change-password.html`, `forgot-password.html`, `reset-password.html`
- **API:** `/api/auth/change-password`, `/api/auth/reset-password`
