# Audit: Feature parity ระหว่าง v1 (PHP portal) และ v2 (Next.js portal)

- วันที่ audit: 2026-10-13
- ขอบเขต: พื้นที่ Phase 1 ทั้ง 25 หมวด (login, password, profile, dashboard, board, comments, trash, jira-templates, jira create, jenkins build, batch monitor, admin users / system-settings / menu-permissions / nav-groups / super-team-permissions, notifications, presence, search, activity, backup, log, admin index, session/security)
- วิธีการ: อ่านซอร์ส v1 (`api/**/*.php`, `*.html`, `assets/pages/**/*.js`, `assets/js/*.js`) และ v2 (`som-portal-v2/app/**`, `som-portal-v2/src/**`) ผ่าน Read/Grep ไม่ได้รันระบบ ไม่ได้ทดสอบ e2e
- สถานะ: **PARITY** = พฤติกรรมตรงกันทั้ง API และ UI, **PARTIAL** = มีบางส่วนหรือต่างในรายละเอียด, **MISSING** = ไม่มีใน v2
- ความหมายของ "สถานะ" ในตาราง test case: สถานะของพฤติกรรมนั้นใน v2 ไม่ใช่ผลการรันเทสต์
- ไฟล์นี้ไม่ได้แก้ไขไฟล์อื่นในโปรเจกต์

## 1. สรุป (Summary)

| พื้นที่ | v1 behaviors | PARITY | PARTIAL | MISSING |
|---|---:|---:|---:|---:|
| Login (เข้าสู่ระบบ) (LOGIN) | 12 | 2 | 6 | 4 |
| Password: ลืมรหัส / รีเซ็ต / เปลี่ยนรหัส (PWD) | 18 | 14 | 4 | 0 |
| Profile (โปรไฟล์ตัวเอง / ผู้ใช้อื่น) (PROF) | 8 | 5 | 2 | 1 |
| Settings (การตั้งค่าส่วนตัว) (SETT) | 2 | 0 | 1 | 1 |
| Activity / My activity (ประวัติกิจกรรมของตัวเอง) (ACT) | 4 | 0 | 0 | 4 |
| Notifications (กระดิ่งแจ้งเตือน) (NOTI) | 7 | 6 | 0 | 1 |
| Presence (ผู้ใช้ออนไลน์) (PRES) | 3 | 0 | 0 | 3 |
| Search (ค้นหาทั่วระบบ) (SRCH) | 3 | 0 | 1 | 2 |
| Dashboard (หน้าแดชบอร์ด) (DASH) | 10 | 0 | 2 | 8 |
| Board (บอร์ดโพสต์บริการ) (BOARD) | 16 | 5 | 8 | 3 |
| Board comments (คอมเมนต์บนโพสต์) (CMT) | 4 | 1 | 3 | 0 |
| Trash / soft delete (ถังขยะ) (TRASH) | 6 | 5 | 1 | 0 |
| Jira templates (แม่แบบ Jira) (JTPL) | 8 | 1 | 5 | 2 |
| Jira create issue (สร้าง ticket) (JIRA) | 12 | 10 | 1 | 1 |
| Jenkins build (สร้าง build) (JNK) | 12 | 5 | 2 | 5 |
| Batch monitor (รายงาน batch) (BATCH) | 8 | 3 | 3 | 2 |
| Admin users (จัดการผู้ใช้) (USR) | 21 | 11 | 5 | 5 |
| Admin system-settings (ตั้งค่าระบบ) (SYS) | 6 | 4 | 1 | 1 |
| Admin menu-permissions (สิทธิ์เมนูตาม role) (MENU) | 7 | 6 | 1 | 0 |
| Admin nav-groups (กลุ่มเมนู) (NAV) | 6 | 4 | 2 | 0 |
| Super team permissions (สิทธิ์ทีม และสร้าง / ลบทีม) (TEAM) | 6 | 2 | 0 | 4 |
| Backup (สำรองข้อมูล) (BKP) | 5 | 0 | 0 | 5 |
| Activity / security log (บันทึกและดูบันทึก) (LOG) | 5 | 1 | 0 | 4 |
| Admin index (หน้าแอดมินหลัก) (ADMIN) | 3 | 0 | 2 | 1 |
| Session และความปลอดภัยระดับระบบ (SESS) | 6 | 0 | 3 | 3 |
| **รวม** | **198** | **85** | **53** | **60** |

หมายเหตุ: ทั้งหมด 198 พฤติกรรม v1 ที่ตรวจ; PARITY 43%, PARTIAL 27%, MISSING 30%. ตัวเลขนี้นับจากตาราง test case ในหัวข้อ 4 โดยตรง

## 2. Gap สำคัญ (เรียงตามผลกระทบต่อทีม SM)

1. **Dashboard เป็น mock ทั้งหน้า** (`som-portal-v2/app/(app)/dashboard/page.tsx:91-135`): KPI, feed และ banner สถานะเป็นค่าตายตัว ไม่มีข้อมูลจริง ทั้งที่ HANDOFF.md และ PAGE-COMPARISON.md ระบุว่า shipped (ดู TC-DASH-02..04)
2. **Flow บังคับเปลี่ยนรหัสผ่านไม่ครบ**: v2 บล็อก login ของ user ที่รหัสหมดอายุ/ถูกบังคับรีเซ็ต (`app/api/auth/login/route.ts:85-95`) และไม่มี redirect ไปหน้าเปลี่ยนรหัสสำหรับ `first_login` ทำให้ user ที่สร้างใหม่เข้า app ได้โดยไม่เปลี่ยนรหัส และ v2 ไม่คำนวณหมดอายุรหัสตาม password_expiry_days เลย (ดู TC-LOGIN-07/08/09)
3. **Admin reset password และ create user เปลี่ยนพฤติกรรมจาก v1 โดยไม่มีการประกาศ**: v1 ส่งลิงก์ 24 ชม. ทางอีเมลและไม่แตะรหัสเดิม (`api/users/index.php:380-447`); v2 เปลี่ยนรหัสทันทีและคืนรหัสชั่วคราวให้ admin แสดงบนจอ (`src/admin/users-service.ts:612-665`). การสร้าง user ใน v2 ไม่ส่ง welcome email แต่ audit meta ระบุ `sent_to` (ดู TC-USR-05, TC-USR-17)
4. **Board ทำได้แค่อ่านกับสร้างโพสต์**: pin, soft delete, เปลี่ยน status, แก้โพสต์, comment, edit/delete comment, poll โพสต์ใหม่, อัปโหลดรูป และ drag-drop ยังไม่มี UI. ลิงก์รายการโพสต์ไป `/v2/board/[id]` แต่ไม่มีไฟล์ route นี้บนดิสก์ (`app/(app)/board/page.tsx:183`) จึงเป็น 404 (ดู TC-BOARD-06..14)
5. **Jenkins maker/checker ไม่มี**: ไม่มี approval queue, approve/reject, history และ tools catalog. v2 trigger ตรงได้อย่างเดียว (ดู TC-JNK-02, 07..10)
6. **โมดูลทั้งก้อนหายไป**: presence, global search, backup, log viewer, my-activity, batch monitor UI (ดู TC-PRES-*, TC-SRCH-*, TC-BKP-*, TC-LOG-*, TC-ACT-*, TC-BATCH-05)
7. **จัดการทีมไม่ได้ผ่าน v2**: ไม่มีการสร้างทีม, ปิดใช้งานทีม, ลบทีม และ copy config จาก SM (`app/api/v1/teams/` มีแค่ GET และ PATCH) (ดู TC-TEAM-02..05)
8. **ความปลอดภัย**: ไม่มี CSRF ทั้งระบบ, super_viewer ยังเขียน board ได้, middleware ไม่ตรวจ password flags (ดู TC-SESS-01..03 และหัวข้อ 3)
9. **Login rate limit เปลี่ยนจากต่อ username เป็นต่อ IP** (`route.ts:38`) ทำให้ lockout ของ user หนึ่งไม่เกิดกับการโจมตีจาก IP หลายตัว และ reset login block (`users/reset-login-block.php`) ไม่มีใน v2 (ดู TC-LOGIN-03, TC-USR-19)
10. **Trash / team / user management ขาดปุ่มใช้งาน**: หลาย service action มีแล้วแต่ไม่มี UI เรียก (pin, delete, purge trash, clear read notifications, reset nav groups, template CRUD) ทำให้ดูเหมือน parity ใน API แต่ใช้งานจริงไม่ได้

## 3. ความเสี่ยงด้านความปลอดภัยที่พบระหว่าง audit

- **Reset token ถูกเขียนลง server log**: `som-portal-v2/app/api/auth/forgot-password/route.ts:120` ใช้ `console.info` พิมพ์ URL ที่มี token ทั้งก้อน (ดู TC-PWD-04)
- **Session fallback เป็น stub sm_user**: `som-portal-v2/app/(app)/layout.tsx:36-40` ถ้า `getSession()` ล้มเหลวจะ fallback เป็น `sm_user` ของทีม `sm` แทนที่จะ redirect (middleware กันเฉพาะกรณีไม่มี cookie) ควรแก้เป็น redirect ไป login
- **ไม่มี CSRF**: v1 ใช้ `requireCsrf()` ใน 91 endpoint (`api/helpers.php:661-674`); v2 ไม่มี token mechanism และ route ที่เปลี่ยนข้อมูลพึ่งเพียง SameSite=lax cookie (ดู TC-SESS-02)
- **super_viewer เขียนได้บาง endpoint**: v1 บล็อกทุก non-GET สำหรับ super_viewer (`api/helpers.php:625-637`); v2 `resolveWriteMode` คืน true สำหรับ super_viewer ที่ page mode ไม่ใช่ read (`src/board/access.ts:148-153`) (ดู TC-SESS-01)
- **รหัสชั่วคราวแสดงบนจอ**: `UsersClient.tsx:116-137` แสดง temp password จาก API ให้ admin เห็น (ดู TC-USR-06)
- **Audit ของ create user ไม่ตรงความจริง**: `users-service.ts:378-382` บันทึก `sent_to` ทั้งที่ไม่ได้ส่งอีเมล (ดู TC-USR-05)
- **Jenkins proxy gate ไม่ตรงกับหน้า** (ต้องยืนยัน): หน้าใช้ feature `jenkins-build` แต่ proxy ตรวจ `jenkins` (`app/api/v1/jenkins-proxy/route.ts:24,29,62`) อาจทำให้ทีมที่มีเฉพาะ `jenkins-build` เรียก proxy ไม่ได้ (ดู TC-JNK-01)
- **Jira TLS (v1 ปิด, v2 เปิด)**: v1 `api/jira/create.php:122` ปิด `SSL_VERIFYPEER`; v2 ไม่ปิด (ดี ไม่ต้องแก้) บันทึกไว้เพื่อไม่ให้ port กลับไปปิด

## 4. Test cases ต่อพื้นที่

คอลัมน์ "Precondition / Steps" และ "Expected" อิงพฤติกรรมตามซอร์ส v1 ส่วน "หลักฐาน" คือ path:line ฝั่ง v1 และ v2

### 4.1 Login (เข้าสู่ระบบ) (LOGIN)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-LOGIN-01 | ต้องกรอก username และ password | ส่ง body ขาด field | 400 "Username and password are required" | **PARTIAL** | ข้อความ error ต่างกัน ("Missing username or password") | v1 api/auth/login.php:13-15 / v2 app/api/auth/login/route.ts:62 |
| TC-LOGIN-02 | รหัสผิดได้ 401 | user มีจริง, ใส่ password ผิด | 401 "Invalid username or password" | **PARTIAL** | ข้อความต่าง ("Incorrect username or password") รหัส 401 เหมือนกัน | v1 login.php:36 / v2 route.ts:70,82 |
| TC-LOGIN-03 | Rate limit ตาม username: ล้มเหลว 5 ครั้งแล้วล็อก 15 นาที | ผิด 5 ครั้งกับ username เดิมจาก IP ต่างกัน | ครั้งที่ 6 ถูกบล็อกสำหรับ username นั้น | **PARTIAL** | v2 ล็อกตาม IP (5/15 นาที) ไม่ใช่ username: user คนเดียวโดน brute force จากหลาย IP ได้ และ IP เดียวล็อกทุก user | v1 login.php:18,30 + helpers.php:1074-1140 / v2 route.ts:37-51 |
| TC-LOGIN-04 | ล็อกอินสำเร็จคืน token + user DTO (team_features, team_page_modes, permissions, is_genz) | user ปกติ | ได้ token และ user ครบฟิลด์ใน response | **PARTIAL** | v2 คืน user เฉพาะ id/username/role/team/name/nickname; ฟีเจอร์ทีมโหลดฝั่ง server ที่ layout; ไม่มี permissions ของ external | v1 login.php:126-144 / v2 route.ts:151-163, app/(app)/layout.tsx:15-31 |
| TC-LOGIN-05 | Remember me = 30 วัน | ติ๊ก remember | token อายุ 30 วัน | **PARITY** | - | v1 login.php:83 / v2 route.ts:99 |
| TC-LOGIN-06 | อายุ session อ่านจาก system-settings (session_timeout_hours) | ตั้ง timeout = 4 ชม.ใน system settings | login แล้ว session อายุ 4 ชม. | **MISSING** | v2 ฮาร์ดโค้ด STD_TTL = 8 ชม. ไม่อ่าน system-settings | v1 config.php:44 / v2 route.ts:22 |
| TC-LOGIN-07 | first_login: login ได้ แล้วถูกบังคับไปหน้าเปลี่ยนรหัส | user ที่สร้างใหม่ (first_login=true) login | redirect ไป change-password.html | **MISSING** | v2 login ผ่านแล้วไป /v2/dashboard; middleware ไม่ตรวจ first_login; ไม่มี redirect บังคับ | v1 login.php:51,92 + assets/js/auth.js:165-170 / v2 login/page.tsx:71-73, middleware.ts:36-72 |
| TC-LOGIN-08 | password หมดอายุ (60 วัน): login ได้ แต่ถูกบังคับเปลี่ยนรหัส | password_changed_at เก่ากว่า 60 วัน | ได้ token (password_expired=true) และไป change-password?reason=expired | **MISSING** | v2 ตรวจแค่ flag password_expired ที่เก็บไว้ ไม่คำนวณจาก password_changed_at + password_expiry_days จึงไม่บังคับหมดอายุตามเวลาเลย; และเมื่อ flag เป็น true ก็ปฏิเสธ login ด้วย 403 ทำให้ผู้ใช้เปลี่ยนรหัสเองไม่ได้ | v1 login.php:48-55 + auth.js:172-178 / v2 route.ts:85-95 |
| TC-LOGIN-09 | must_reset_password (admin บังคับ): login ได้ แล้วถูกบังคับเปลี่ยนรหัส | admin ตั้ง must_reset_password=true | ไป change-password?reason=admin_reset | **PARTIAL** | v2 บล็อก login (403) ไม่มีทางเปลี่ยนรหัสใน flow ล็อกอิน; ใช้ได้เฉพาะ link ลืมรหัส | v1 auth.js:181-186 / v2 route.ts:85-95 |
| TC-LOGIN-10 | บันทึก security event login_success | login สำเร็จ | logSecurity login_success | **MISSING** | v2 บันทึกแค่ logActivity 'login' ไม่มี logSecurity success | v1 login.php:43-46 / v2 route.ts:144-149 |
| TC-LOGIN-11 | บันทึก login_failed พร้อมเหตุผล user_not_found / invalid_password | login ผิด | logSecurity login_failed + reason | **PARTIAL** | v2 ใช้ชื่อ event login.failed และ reason no_user / bad_password (ชื่อต่าง) | v1 login.php:31-35 / v2 route.ts:69,75-81 |
| TC-LOGIN-12 | logActivity 'login' พร้อม meta (pw_expired, must_reset) | login สำเร็จ | activity action=login | **PARITY** | action ตรง meta ต่าง (v2 เก็บ ip/remember/ttl) | v1 login.php:75-80 / v2 route.ts:144-149 |

### 4.2 Password: ลืมรหัส / รีเซ็ต / เปลี่ยนรหัส (PWD)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-PWD-01 | Forgot: จำกัด 3 ครั้ง/IP/15 นาที นับก่อนตรวจ คืน 429 + Retry-After | ขอ reset 4 ครั้งจาก IP เดียว | ครั้งที่ 4 ได้ 429 "คำขอบ่อยเกินไป..." | **PARITY** | - | v1 forgot-password.php:21-49 / v2 account/forgot-rate-limit.ts:11-15,45-70, route.ts:61-74 |
| TC-PWD-02 | Forgot: ข้อความตอบกลับเหมือนกันทุกกรณี (กัน enumeration) | username ไม่มี / ไม่มี email / มี email | ได้ข้อความ generic เดียวกัน | **PARITY** | - | v1 forgot-password.php:56-60,69-81,101-110 / v2 route.ts:40-41,87,101,113,156 |
| TC-PWD-03 | Forgot: ค้นจาก username (ไม่สนตัวพิมพ์) | ใส่ username | ค้นได้ตาม v1 | **PARITY** | v2 รับ email เพิ่มด้วย (superset) | v1 forgot-password.php:63-67 / v2 route.ts:90-91 |
| TC-PWD-04 | Forgot: ส่งลิงก์ reset อายุ 24 ชม. ทาง SMTP | user มี email, SMTP ตั้งค่าแล้ว | อีเมลถึง user, token 24 ชม. | **PARTIAL** | ส่งได้ แต่ v2 console.info พิมพ์ URL ที่มี token ลง server log (รั่วไหลของ token) | v1 forgot-password.php:85-99 / v2 route.ts:116-145, route.ts:120 |
| TC-PWD-05 | Forgot UI: แสดงหน้า "ส่งแล้ว" และข้อความ 429 | - | สำเร็จ / แสดง 429 | **PARITY** | - | v1 forgot-password.html:82-130 / v2 app/(public)/forgot-password/page.tsx:40-62 |
| TC-PWD-06 | Reset GET: ตรวจ token, คืน masked name/username และ expires_at | token ยังใช้ได้ | valid=true + ชื่อที่ mask | **PARITY** | - | v1 reset-password.php:19-60 / v2 app/api/auth/reset-password/route.ts:26-64 |
| TC-PWD-07 | Reset: token ไม่ valid แสดงหน้า Invalid or expired link | token หมดอายุ/ใช้แล้ว | แสดงหน้า invalid | **PARITY** | - | v1 reset-password.html:45 / v2 app/(public)/reset-password/page.tsx:126-127,317-329 |
| TC-PWD-08 | Reset: รหัสอย่างน้อย 8 ตัว | token valid | ตั้ง 8-9 ตัวได้ | **PARTIAL** | v2 บังคับ 10 ตัว + พิมพ์ใหญ่ + ตัวเลข (เข้มกว่า v1; รหัสตามกฎ v1 ตั้งไม่ได้) | v1 reset-password.php:74-76 / v2 account/password-policy.ts:7,21-32 |
| TC-PWD-09 | Reset: confirm ไม่ตรง → 'Passwords do not match' | ใส่ confirm ต่าง | 400 | **PARITY** | - | v1 reset-password.php:77-79 / v2 route.ts:93-95 |
| TC-PWD-10 | Reset: token ใช้ได้ครั้งเดียว และ consume ก่อนแก้รหัส | ใช้ token ซ้ำ | error ลิงก์หมดอายุหรือถูกใช้แล้ว | **PARITY** | - | v1 reset-password.php:82-86 / v2 route.ts:97-112 |
| TC-PWD-11 | Reset: ห้ามซ้ำรหัสปัจจุบันและประวัติ N ครั้ง | ตั้งรหัสเดิม | 400 same as current / reused | **PARITY** | - | v1 reset-password.php:93-105 / v2 route.ts:125-138, account/users-store.ts |
| TC-PWD-12 | Reset: ล้าง first_login / password_expired / must_reset และ log password_reset_via_token | reset สำเร็จ | flags ถูกล้าง, มี activity + security log | **PARITY** | - | v1 reset-password.php:109-126 / v2 account/users-store.ts:14-15,174-175, route.ts:143-154 |
| TC-PWD-13 | Reset: หลังสำเร็จ ล้าง session ฝั่ง client และกลับหน้า login | reset สำเร็จ | localStorage ถูกล้าง แล้วไปหน้า login | **PARITY** | v2 ใช้ cookie ฝั่ง server จึงไม่ต้องล้าง; มีลิงก์กลับ /login | v1 assets/pages/reset-password/reset-password.js:157-170 / v2 app/(public)/reset-password/page.tsx (success phase, Link /login ราว L239) |
| TC-PWD-14 | Change: ต้องใส่รหัสเดิม ยกเว้น first_login / must_reset | user ปกติ ไม่ส่ง old_password | 400 "Current password is required" | **PARITY** | - | v1 change-password.php:28-30 / v2 account/users-store.ts setUserPassword, route.ts:71-72 |
| TC-PWD-15 | Change: รหัสเดิมผิด → 401 | old_password ผิด | 401 "Current password is incorrect" | **PARITY** | - | v1 change-password.php:31-33 / v2 route.ts:73-80 |
| TC-PWD-16 | Change: รหัสใหม่อย่างน้อย 8 ตัว | ตั้ง 8-9 ตัว | ผ่าน | **PARTIAL** | v2 บังคับ 10+ พิมพ์ใหญ่ + ตัวเลข | v1 change-password.php:16-18 / v2 account/password-policy.ts:7,21-32 |
| TC-PWD-17 | Change: log password_change พร้อม flags first_login_reset / expired_reset | เปลี่ยนรหัสขณะ first_login | meta บันทึก flag จริง | **PARTIAL** | v2 hard-code เป็น false ทั้งคู่ | v1 change-password.php:66-69 / v2 app/api/v1/auth/change-password/route.ts:100-104 |
| TC-PWD-18 | Change: หลังเปลี่ยน ได้ session ใหม่ (token ที่ flags ถูกล้าง) | เปลี่ยนสำเร็จ | ได้ token ใหม่ | **PARITY** | v2 re-sign เป็น cookie แทนการคืน token | v1 change-password.php:71-87 / v2 route.ts:110-130 |

### 4.3 Profile (โปรไฟล์ตัวเอง / ผู้ใช้อื่น) (PROF)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-PROF-01 | GET โปรไฟล์ตัวเอง คืน DTO ครบ | login | ได้ id, name, nickname, username, email, role, avatar_url, name_th, emp_id, phone, tmn_id, net_home, net_mobile | **PARITY** | - | v1 api/auth/profile.php:101-121 / v2 app/api/v1/auth/profile/route.ts:22-34 |
| TC-PROF-02 | PATCH name 1-60 ตัว, nickname ≤30 | ส่งชื่อว่าง / ยาวเกิน | 400 "Name must be 1–60 characters" | **PARITY** | - | v1 profile.php:17-26 / v2 account/users-store.ts:241-252 |
| TC-PROF-03 | Avatar เป็น data:image (png/jpeg/gif/webp) หรือ https และ ≤280,000 ตัวอักษร | ส่ง avatar รูปแบบผิด | 400 | **PARITY** | UI v2 จำกัด 200KB (v1 เลือกไฟล์ได้ 5MB แล้วบีบ) | v1 profile.php:29-35, profile.js:403-407 / v2 account/users-store.ts:259-274, settings/_components/SettingsClient.tsx:340 |
| TC-PROF-04 | แก้ฟิลด์ติดต่อ: name_th, emp_id, phone, tmn_id, net_home, net_mobile พร้อมความยาวสูงสุด | แก้ net_home ยาว 101 ตัว | 400 "Net home too long (max 100 chars)" | **PARTIAL** | API รองรับ แต่ ProfileTab ไม่มีช่อง tmn_id, net_home, net_mobile | v1 profile.php:39-46, profile.js:439-457 / v2 account/users-store.ts:277-286, settings/_components/SettingsClient.tsx:411-416 |
| TC-PROF-05 | Email รูปแบบถูกต้องและไม่ซ้ำ | email ซ้ำกับ user อื่น | 400 "Email already in use" | **PARITY** | - | v1 profile.php:48-61 / v2 account/users-store.ts:287-301 |
| TC-PROF-06 | logActivity profile_update | PATCH สำเร็จ | มี activity profile_update | **PARITY** | - | v1 profile.php:71-76 / v2 app/api/v1/auth/profile/route.ts:71-76 |
| TC-PROF-07 | ดูโปรไฟล์ผู้ใช้อื่น (?user_id=) พร้อม achievements, posts, heatmap | เปิด profile?user_id=X | แสดงข้อมูลผู้ใช้นั้น | **MISSING** | ไม่มี route หรือ UI | v1 assets/pages/profile/profile.js:153-165, 481-491 / v2 ไม่มี |
| TC-PROF-08 | admin แก้โปรไฟล์ผู้ใช้อื่นจากหน้า profile (saveOtherProfile) | admin เปิดโปรไฟล์คนอื่น | PUT users บันทึก | **PARTIAL** | แก้ได้ในหน้า admin/users แต่ไม่มีในหน้าโปรไฟล์ | v1 profile.js:884-911 / v2 app/(admin)/admin/users/_components/UserDrawer.tsx |

### 4.4 Settings (การตั้งค่าส่วนตัว) (SETT)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-SETT-01 | เลือก nav style (เก็บใน localStorage som_nav_style) | เปลี่ยน style | จำค่าใน browser | **MISSING** | ไม่พบตัวเลือก nav style ใน v2 (ต้องยืนยันว่าตั้งใจตัด) | v1 assets/pages/settings/settings.js:11-35 / v2 settings/_components/SettingsClient.tsx:62-69 |
| TC-SETT-02 | เปิด/ปิดเสียงแจ้งเตือน (localStorage) | toggle เสียง | จำค่า | **PARTIAL** | ย้ายเป็น user-prefs ฝั่ง server (tab notifications); ยังไม่ยืนยันตัวเลือกเสียง | v1 settings.js:190-191 / v2 SettingsClient.tsx:170-172 |

### 4.5 Activity / My activity (ประวัติกิจกรรมของตัวเอง) (ACT)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-ACT-01 | GET my-activity: เฉพาะรายการของตัวเอง, limit ≤1000, offset | login, GET ?limit=20&offset=0 | items ของ user + total | **MISSING** | ไม่มี route | v1 api/auth/my-activity.php:8-28 / v2 ไม่มี |
| TC-ACT-02 | อ่าน log ตามทีม (SM ใช้ global, ทีมอื่นใช้ data/{team}/logs) | login ทีม dev | อ่านจาก log ของทีม dev | **MISSING** | เขียน log แล้ว (src/logging/activity.ts) แต่ไม่มี reader | v1 my-activity.php:13-16 / v2 src/logging/activity.ts |
| TC-ACT-03 | หน้า profile แสดง activity feed และสถิติ login / board_comment | เปิด profile | feed + ตัวนับ | **MISSING** | ไม่มี | v1 profile.js:177-232, 790-868 / v2 ไม่มี |
| TC-ACT-04 | หน้า profile แสดง 5 โพสต์ล่าสุดของตัวเอง | เปิด profile | รายการโพสต์ | **MISSING** | ไม่มี UI (board author_id filter ใน v1 board/index.php:32 ยังไม่ได้ใช้ใน v2 UI) | v1 profile.js:691-700 / v2 ไม่มี |

### 4.6 Notifications (กระดิ่งแจ้งเตือน) (NOTI)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-NOTI-01 | ดึงรายการแจ้งเตือนของตัวเองพร้อม unread count | login, เปิด bell | list + unread | **PARITY** | - | v1 api/notifications/index.php:9-15 / v2 app/api/notifications/route.ts:9-17 |
| TC-NOTI-02 | Mark read รายการเดียว | มี unread, คลิก | read=true | **PARITY** | HTTP method ต่าง (v1 PATCH, v2 POST) | v1 notifications/index.php:18-31 / v2 app/api/notifications/read/route.ts:10-16 |
| TC-NOTI-03 | Mark all read (id=all) | มี unread, กด 'อ่านทั้งหมด' | ทั้งหมด read | **PARITY** | - | v1 assets/js/api.js:752 / v2 notifications/read/route.ts:16 |
| TC-NOTI-04 | Clear read: ลบแจ้งเตือนที่อ่านแล้วของตัวเอง (DELETE) | มีรายการ read | ลบเฉพาะ read | **MISSING** | ไม่มี DELETE route และไม่มี UI (store.ts deleteRead ไม่ได้ใช้) | v1 api/notifications/index.php:34-41, assets/js/layout.js:3516,4066 / v2 src/notifications/store.ts:87 |
| TC-NOTI-05 | Poll เพื่ออัปเดต badge | เปิดหน้า | badge อัปเดตอัตโนมัติ | **PARITY** | v2 poll ทุก 30 วินาที (v1 60 วินาที และดึงใหม่เมื่อกลับมาที่แท็บ); มี component ซ้ำ 2 ไฟล์ (src/ui และ app/(app)/_components) | v1 assets/js/layout.js:3951-3957 / v2 app/(app)/_components/NotificationBell.tsx:53 |
| TC-NOTI-06 | สร้างแจ้งเตือน mention (@allsm หรือ user) เมื่อโพสต์หรือคอมเมนต์ | โพสต์ mention | ผู้ถูก mention ได้แจ้งเตือน | **PARITY** | - | v1 board/index.php:136-150, board-comments/index.php:77-140 / v2 board/service.ts:223-229, 546-552, 725-781 |
| TC-NOTI-07 | แจ้งเตือนเจ้าของโพสต์เมื่อมีคอมเมนต์ใหม่ (ถ้าไม่ใช่ตัวเอง) | ผู้อื่นคอมเมนต์ | เจ้าของได้แจ้งเตือน | **PARITY** | - | v1 board-comments/index.php:122-140 / v2 board/service.ts:554-562 |

### 4.7 Presence (ผู้ใช้ออนไลน์) (PRES)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-PRES-01 | Heartbeat ทุก role รวม super_viewer อัปเดต ts | login, ส่ง heartbeat ทุก N วินาที | 200 + ts | **MISSING** | ไม่มี route | v1 api/presence/heartbeat.php:5,49 / v2 ไม่มี |
| TC-PRES-02 | list ผู้ที่ online ภายใน 90 วินาที | มีคน online | รายชื่อ + seconds_ago | **MISSING** | ไม่มี route | v1 api/presence/list.php:11-25 / v2 ไม่มี |
| TC-PRES-03 | แสดงจุด presence ใน office / 3D view | เปิด office | เห็นผู้ใช้อยู่หน้าไหน | **MISSING** | ไม่มีและไม่อยู่ในแผน Phase 1-3 ของ PAGE-COMPARISON | v1 assets/js/layout.js:1702,3184 / v2 ไม่มี |

### 4.8 Search (ค้นหาทั่วระบบ) (SRCH)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-SRCH-01 | ค้นหาต้องพิมพ์อย่างน้อย 2 ตัว | พิมพ์ 1 ตัว | results ว่าง | **MISSING** | ไม่มี route; Topbar ไม่มีช่องค้นหา | v1 api/search/index.php:9-11 / v2 app/(app)/_components/Topbar.tsx (ไม่พบ input) |
| TC-SRCH-02 | ค้นหาโพสต์ sheet และผู้ใช้ (≤40 ผล เรียงตามชนิด) | มีข้อมูล, พิมพ์คำค้น | ผลแยกตาม type post / sheet / user | **MISSING** | ไม่มี | v1 api/search/index.php:7,17-70 / v2 ไม่มี |
| TC-SRCH-03 | บันทึก board_search เมื่อค้นในบอร์ด | search=x ในบอร์ด | activity board_search | **PARTIAL** | มีเฉพาะการค้นในบอร์ด (ไม่มี global search) | v1 board/index.php:28-53 / v2 board/service.ts:117 |

### 4.9 Dashboard (หน้าแดชบอร์ด) (DASH)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-DASH-01 | ทักทายด้วยชื่อที่แสดง และช่วงเวลาตามเวลา กทม. | login, เปิดหน้า | "สวัสดี <ชื่อ>" ตามช่วงเวลา | **PARTIAL** | ใช้ username แทนชื่อ; banner "All systems operational" เป็นข้อความ hard-code | v1 assets/pages/dashboard/dashboard.js:30-36 / v2 app/(app)/dashboard/page.tsx:44-46,56-57 |
| TC-DASH-02 | KPI จากข้อมูลจริง (incident analytics) | เปิดหน้า | ตัวเลขจริงจาก Jira analytics | **MISSING** | ค่า hard-code 4 / 18 / 7 / 2 (page.tsx:91-94) | v1 dashboard.js:1085 / v2 dashboard/page.tsx:91-94 |
| TC-DASH-03 | Activity feed รวมโพสต์บอร์ดกับ log ตาม whitelist FEED_ACTIONS | มีโพสต์และ log | feed ล่าสุดของจริง | **MISSING** | feed เป็น array mock 5 รายการ | v1 dashboard.js:658-690 + api/log/feed.php:9-44 / v2 dashboard/page.tsx:129-135 |
| TC-DASH-04 | ปุ่ม refresh feed, แสดงเวลาอัปเดต, ข้อความ error และ retry | กด refresh / จำลอง API error | ดึงใหม่ / แสดง error + retry | **MISSING** | ปุ่ม Refresh ไม่มี handler | v1 dashboard.js:658-685, 812-829 / v2 dashboard/page.tsx:74-78 |
| TC-DASH-05 | Learning hero (ซ่อนสำหรับ external) | user ไม่ใช่ external | แสดงการ์ด learning | **MISSING** | ไม่มี (อยู่ใน Phase 3 learn) | v1 dashboard.js:853-870 / v2 ไม่มี |
| TC-DASH-06 | Inbox widget และ compose / ส่งอีเมล | มี inbox | อ่านและส่งอีเมลได้ | **MISSING** | ไม่มี (inbox อยู่ Phase 3, send-email อยู่ Phase 2) | v1 dashboard.js:94-383 / v2 ไม่มี |
| TC-DASH-07 | SMC Jira ticket modal จาก dashboard | เปิด modal, โหลด field options, submit | สร้าง ticket ได้ | **MISSING** | ไม่มี (ใช้ create issue ได้เฉพาะหน้า jira-templates) | v1 dashboard.js:383-514 / v2 ไม่มี |
| TC-DASH-08 | Requests widget (สร้าง, ดูประวัติ, คอมเมนต์) | เปิด requests | list และสร้างได้ | **MISSING** | ไม่มี | v1 dashboard.js:1378-1640, api/requests/index.php / v2 ไม่มี |
| TC-DASH-09 | Roster วันนี้ (schedule + leave) | เปิดหน้า | รายชื่อผู้อยู่เวร | **MISSING** | ไม่มี (schedule / leave อยู่ Phase 3) | v1 dashboard.js:1152-1154 / v2 ไม่มี |
| TC-DASH-10 | Quick access tiles ตามสิทธิ์ | role / feature ต่างกัน | แสดงเฉพาะที่มีสิทธิ์ | **PARTIAL** | v2 รายการ hard-code ในไฟล์ไม่มีการกรองตาม canSeePage ในไฟล์นี้ | v1 dashboard + layout.js / v2 dashboard/page.tsx:167-172 |

### 4.10 Board (บอร์ดโพสต์บริการ) (BOARD)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-BOARD-01 | ดึงโพสต์พร้อม filter: search, board_type, status, starred, author_id; limit 1-50 (ค่าเริ่มต้น 12) | login ที่มี feature board | ผลกรองตามเงื่อนไข และ paging | **PARTIAL** | UI ไม่มี filter board_type / author_id; limit คงที่ 50, offset 0 (ไม่มี paging) | v1 board/index.php:28-35, 73-74 / v2 board/page.tsx:105-115, board/schema.ts:196-202, board/_components/BoardFilters.tsx |
| TC-BOARD-02 | มุมมอง Kanban 3 คอลัมน์ตาม status และ tab ตาม board_type | เปิดหน้า board | คอลัมน์ open / in_progress / resolved | **PARTIAL** | v2 เป็นรายการ (list) ไม่มี Kanban/tab | v1 board.html:54-62, assets/pages/board/board.js / v2 board/page.tsx:136-150 |
| TC-BOARD-03 | เรียงโพสต์ที่ pinned ก่อน แล้วตาม created_at ล่าสุด | มีโพสต์ pinned | ลำดับถูกต้อง | **PARITY** | - | v1 board/index.php:63-68 / v2 board/service.ts:126-127 |
| TC-BOARD-04 | สร้างโพสต์: title จำเป็น ≤300, content ≤20,000, status เริ่มต้น open | login มีสิทธิ์เขียน | 400 "Title is required" / "Title too long (max 300 chars)" | **PARITY** | - | v1 board/index.php:96-103 / v2 board/schema.ts:149-150, board/service.ts:180-233 |
| TC-BOARD-05 | สร้างโพสต์เก็บ board_type / service_type / subtype / image_url | สร้างโพสต์พร้อมประเภท | ข้อมูลครบใน board.json | **PARITY** | - | v1 board/index.php:107-125 / v2 board/_components/NewPostPanel.tsx:55-65, board/schema.ts:46 |
| TC-BOARD-06 | แก้โพสต์: เจ้าของหรือ lead เท่านั้น เก็บ edit_history สูงสุด 20 | user อื่นแก้โพสต์ | 403 "Not authorized to edit this post" | **PARTIAL** | service ตรง แต่ UI PostEditor ไม่ถูก render (ไม่มีหน้า board/[id]) | v1 board/index.php:187-214 / v2 board/service.ts:244-311; board/_components/PostEditor.tsx ไม่ถูก import |
| TC-BOARD-07 | เปลี่ยน status (open / in_progress / resolved) และ log board_status_change | กดเปลี่ยน status | status ใหม่ + activity | **PARTIAL** | service setPostStatus มี แต่ไม่มี UI (StatusSelect ไม่ถูก render) | v1 board/index.php:231-257 / v2 board/service.ts:311-322 |
| TC-BOARD-08 | ลากการ์ดข้ามคอลัมน์เพื่อเปลี่ยน status | canEdit = true | status เปลี่ยน | **MISSING** | ไม่มี drag and drop | v1 assets/pages/board/board.js:521,548,1141 / v2 ไม่มี |
| TC-BOARD-09 | ปักหมุด / ยกเลิกปักหมุด (lead ขึ้นไป) และ log board_pin | login เป็น lead | pinned สลับ | **PARTIAL** | service togglePin มี แต่ไม่มีปุ่ม UI | v1 board/index.php:265-286, board.js:522,564 / v2 board/service.ts:323-340 |
| TC-BOARD-10 | ลบโพสต์แบบ soft (เจ้าของหรือ lead) และ log board_delete | กดลบ | deleted_at ถูกตั้งค่า ไม่แสดงในบอร์ด | **PARTIAL** | service softDeletePost มี แต่ไม่มีปุ่ม UI | v1 board/index.php:290-318 / v2 board/service.ts:341-362 |
| TC-BOARD-11 | Star / unstar โพสต์ส่วนตัว และ log board_star | กดดาว | สถานะดาวเปลี่ยน | **PARITY** | - | v1 api/stars/index.php, board.js:1041 / v2 board/_components/StarToggle.tsx:27, board/actions.ts:180-200 |
| TC-BOARD-12 | Poll โพสต์ใหม่ (since) ทุกช่วงเวลาเมื่อแท็บ visible | เปิดหน้า | แบนเนอร์หรือรายการใหม่ | **PARTIAL** | service listPostsSince มี แต่ไม่มี poller ฝั่ง UI | v1 board.js:394-400, board/index.php:13-19 / v2 board/service.ts:152-160 |
| TC-BOARD-13 | อัปโหลดรูปในโพสต์ (paste / attach) เก็บเป็น image_url | paste รูปในช่อง | รูปแนบในโพสต์ | **MISSING** | ไม่มี upload endpoint หรือ UI (มีแค่ field image_url) | v1 board.js:1079-1106 / v2 board/schema.ts:46,158 |
| TC-BOARD-14 | จัดการ service type / category จากหน้า board (lead) | login เป็น lead | เพิ่มประเภทได้ | **MISSING** | หน้า board โหลด config แบบอ่านอย่างเดียว | v1 board.js:331,356, api/board-config / v2 board/page.tsx:24 |
| TC-BOARD-15 | page mode 'read' ของทีมทำให้เขียนไม่ได้ | page_modes.board = read | สร้างโพสต์ได้ 403 | **PARITY** | - | v1 board/index.php:6 / v2 board/access.ts:148-153, 206-212 |
| TC-BOARD-16 | Load more เมื่อมีมากกว่า 100 โพสต์ | มีมากกว่า 100 โพสต์ | โหลดเพิ่มได้ | **PARTIAL** | ไม่มี paging (limit 50 ตายตัว) | v1 board.js:32, 465-476 / v2 board/page.tsx:113-114 |

### 4.11 Board comments (คอมเมนต์บนโพสต์) (CMT)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-CMT-01 | ดูคอมเมนต์ของโพสต์ (ไม่รวมที่ถูกลบ) | โพสต์มีคอมเมนต์ | รายการคอมเมนต์ | **PARITY** | - | v1 board-comments/index.php:12-30 / v2 board/service.ts:490-500 |
| TC-CMT-02 | สร้างคอมเมนต์: content จำเป็น ≤5000, โพสต์ต้องมีอยู่ (404), log board_comment | POST คอมเมนต์ | 400 "Content required" / 404 "Post not found" | **PARTIAL** | service ตรง แต่ CommentComposer ไม่ถูก render | v1 board-comments/index.php:35-52, 142-147 / v2 board/service.ts:513-575; board/_components/CommentComposer.tsx |
| TC-CMT-03 | แก้คอมเมนต์ (เจ้าของเท่านั้น) ≤5000 และ log comment_edit | เจ้าของแก้ | 200; ผู้อื่นได้ 403 "Forbidden" | **PARTIAL** | service updateComment มี แต่ไม่มี server action และไม่มี UI | v1 board-comments/index.php:153-175 / v2 board/service.ts:578-600; board/actions.ts ไม่มี updateComment |
| TC-CMT-04 | ลบคอมเมนต์ (เจ้าของหรือ lead) แบบ soft และ log comment_delete | กดลบ | deleted_at ถูกตั้งค่า | **PARTIAL** | action deleteComment มี แต่ไม่มี UI ที่เรียกใช้ | v1 board-comments/index.php:181-205 / v2 board/actions.ts:166-178, board/service.ts:602-622 |

### 4.12 Trash / soft delete (ถังขยะ) (TRASH)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-TRASH-01 | ดูถังขยะ (lead ขึ้นไป) พร้อม days_left | login เป็น lead | รายการ + days_left | **PARITY** | - | v1 board/trash.php:5,18-43 / v2 board/service.ts:376-406; board/trash/page.tsx |
| TC-TRASH-02 | Restore โพสต์หรือคอมเมนต์ และ log | กด restore | deleted_at ถูกล้าง | **PARITY** | - | v1 board/trash.php:51-82 / v2 board/service.ts:408-431; board/trash/page.tsx:112,155 |
| TC-TRASH-03 | Hard delete (admin เท่านั้น) และ log board_hard_delete | login เป็น sm_admin | ลบถาวร | **PARITY** | - | v1 board/trash.php:123-137 / v2 board/service.ts:433-455; board/trash/page.tsx:120,163 |
| TC-TRASH-04 | Purge รายการที่หมดอายุทั้งหมด (admin) และ log board_auto_purge | login เป็น sm_admin | ลบรายการที่เกิน retention | **PARTIAL** | service purgeTrash มี แต่ไม่มี UI ที่เรียกใช้ | v1 board/trash.php:91-119 / v2 board/service.ts:458-490; board/actions.ts:203 |
| TC-TRASH-05 | retention อ่านจาก trash_retention_days | ตั้งค่า retention | days_left คำนวณตามค่านี้ | **PARITY** | - | v1 board/trash.php:12 / v2 board/service.ts:388 |
| TC-TRASH-06 | ผู้ที่ไม่ใช่ lead เข้าถังขยะไม่ได้ | login เป็น sm_user | 403 | **PARITY** | - | v1 board/trash.php:5 / v2 board/service.ts:376-380 |

### 4.13 Jira templates (แม่แบบ Jira) (JTPL)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-JTPL-01 | ดู template ต้องมี feature jira-templates หรือ -shared | ทีมไม่มี feature | 403 "Your team does not have access to jira templates" | **PARITY** | - | v1 api/templates/index.php:14-27 / v2 src/jira/access.ts:152-158 |
| TC-JTPL-02 | สร้าง template: name และ summary จำเป็น (เฉพาะ SM) | login เป็น sm_admin | 400 "Template name is required" / "Summary (case title) is required" | **PARTIAL** | API ตรง (route.ts:45-57) แต่ไม่มี UI สร้าง | v1 api/templates/index.php:34-40 / v2 app/api/v1/templates/route.ts:45-57 |
| TC-JTPL-03 | แก้ template (partial update) และ log template_update | PUT ข้อมูลบางส่วน | 200 / 404 | **PARTIAL** | API ตรง (route.ts:59-71) แต่ไม่มี UI แก้ไข | v1 templates/index.php:93-118 / v2 route.ts:59-71 |
| TC-JTPL-04 | ลบ template (lead ขึ้นไป) และ log template_delete | DELETE | 200 / 404 | **PARTIAL** | API ตรง (route.ts:73) แต่ไม่มี UI ลบ | v1 templates/index.php:122-136 / v2 route.ts:73 |
| TC-JTPL-05 | ไล่ดู service type → subtype (tree) พร้อมจำนวน template ต่อ node | มีข้อมูล | แสดง template ของ node นั้น | **MISSING** | ไม่มี tree; มีแค่ค้นหาและกรองหมวด | v1 assets/pages/jira-templates/jira-templates.js:212-300, 368-420 / v2 jira-templates/_components/TemplateBrowser.tsx:51-92 |
| TC-JTPL-06 | ดูรายละเอียด template (summary, fields) ก่อนสร้าง ticket | คลิก template | แสดงรายละเอียด | **PARTIAL** | มีการ์ดและ CreateIssueDialog แต่ไม่มี detail view | v1 jira-templates.js:421-489 / v2 TemplateBrowser.tsx:145-201 |
| TC-JTPL-07 | จัดการ service type และ category (เพิ่ม / ลบ type และ subtype) | login เป็น sm_admin | บันทึกได้ | **MISSING** | ไม่มี route และไม่มี UI | v1 jira-templates.js:690-742, api/service-types / v2 ไม่มี |
| TC-JTPL-08 | Modal แก้ template: worktype, category, issuetype tags, fields แบบ dynamic | เปิด modal | บันทึกได้ | **PARTIAL** | API รับ fields แต่ไม่มี editor UI | v1 jira-templates.js:493-660 / v2 ไม่มี UI |

### 4.14 Jira create issue (สร้าง ticket) (JIRA)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-JIRA-01 | สร้าง ticket จาก template: summary จำเป็น | POST ไม่มี summary | 400 "Summary is required" | **PARITY** | - | v1 api/jira/create.php:15 / v2 app/api/v1/jira/create-issue/route.ts:45-60 |
| TC-JIRA-02 | ผู้ใช้ที่ login แล้วสร้าง ticket ได้ (ไม่มี team gate) | user ทีมที่ไม่มี canCreateIssue | 201 | **PARTIAL** | v2 ต้องมีสิทธิ์ canCreateIssue (view-only share จะได้ 403) | v1 create.php:8 / v2 src/jira/access.ts:179-186 |
| TC-JIRA-03 | fault_start auto หรือว่าง → เวลาปัจจุบันเขตเวลา Asia/Bangkok | ส่ง fault auto | ค่า fault = now | **PARITY** | - | v1 create.php:27-29 / v2 src/jira/fields.ts:119-127 |
| TC-JIRA-04 | fault manual: แปลงเป็นวันเวลาจาก UI ก่อนส่ง | เลือก manual และกรอกเวลา | ส่งค่า ISO | **PARITY** | - | v1 assets/pages/jira-templates/jira-templates.js:806-810 / v2 jira-templates/_components/CreateIssueDialog.tsx:37-66 |
| TC-JIRA-05 | Mapping custom field ตาม type จาก jira_config (select, array, text) รวม IL fields และ batch fields | มี field config | payload ถูก type | **PARITY** | - | v1 create.php:34-106 / v2 src/jira/fields.ts:12-23, 113-180 |
| TC-JIRA-06 | description แปลงเป็น ADF (paragraph ต่อบรรทัด) | description หลายบรรทัด | ADF ถูกต้อง | **PARITY** | - | v1 create.php:43-52 / v2 src/jira/fields.ts:68-80 |
| TC-JIRA-07 | สำเร็จ: คืน issue_key และ issue_url และ log jira_create_ticket | POST สำเร็จ | 201 + activity | **PARITY** | - | v1 create.php:137-140 / v2 route.ts:85-89, src/jira/client.ts:238-244 |
| TC-JIRA-08 | Jira ตอบ error → 422 พร้อมข้อความรวมและ jira_errors | ข้อมูลไม่ผ่าน Jira | 422 | **PARITY** | - | v1 create.php:159-166 / v2 route.ts:73-81 |
| TC-JIRA-09 | เชื่อม Jira ไม่ได้ → 502 "Connection to Jira failed" | network ล้มเหลว | 502 | **PARITY** | - | v1 create.php:132 / v2 src/jira/client.ts:67 |
| TC-JIRA-10 | TLS verification: v1 ปิดไว้ (CURLOPT_SSL_VERIFYPEER=false) | - | - | **PARITY** | v2 เปิดตรวจ TLS (ปลอดภัยกว่า) บันทึกเป็นข้อสังเกต | v1 create.php:122 / v2 src/jira/client.ts:43-67 |
| TC-JIRA-11 | หลังสร้าง ticket เปิด email draft: subject "[KEY] - summary", to จาก subtype, cc จาก mail config, ส่งผ่าน mail | กด "ส่งอีเมล" หลังสร้าง ticket | draft พร้อมส่ง | **MISSING** | ไม่มี (mail/send มีที่ API แต่ไม่มี draft UI ในหน้านี้) | v1 assets/pages/jira-templates/jira-templates.js:882-1130 / v2 ไม่มี |
| TC-JIRA-12 | ดึง fields, field options, issue types ของ Jira | เปิด modal | dropdown ถูกต้อง | **PARITY** | - | v1 api/jira/fields.php, field-options.php, issue-types.php / v2 app/api/v1/jira/fields, field-options, issue-types |

### 4.15 Jenkins build (สร้าง build) (JNK)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-JNK-01 | หน้า Jenkins Build ต้องมี feature jenkins-build (external ต้องมี permission) | ทีมไม่มี feature jenkins-build | 403 | **PARTIAL** | หน้าใช้ canSeePage('jenkins-build') แต่ proxy ตรวจ feature 'jenkins' → ทีมที่มีเฉพาะ jenkins-build จะเปิดหน้าได้แต่เรียก proxy ไม่ได้ (ต้องยืนยัน) | v1 api/jenkins-build/index.php:30-46 / v2 app/(app)/jenkins-build/page.tsx:39, app/api/v1/jenkins-proxy/route.ts:24,29,62 |
| TC-JNK-02 | เลือก tool และ server ตาม team (tools catalog) | มี tools config | ได้ server และ job | **PARTIAL** | v2 browse job จาก Jenkins ผ่าน proxy ไม่มี tools catalog | v1 api/jenkins-build/index.php:19-22, 288-290 / v2 app/(app)/jenkins-build/JenkinsBuildClient.tsx, app/api/v1/jenkins-proxy/route.ts:26-57 |
| TC-JNK-03 | ตรวจ parameter: required, pattern (regex), auto_params (username / name) | tool มี param required | 422 "... จำเป็นต้องกรอก" | **MISSING** | v2 ตรวจแค่ schema (BuildSchema) ไม่มี required/pattern ของ tool | v1 api/jenkins-build/index.php:151-170, 389 / v2 app/api/v1/jenkins-proxy/route.ts:59-90 |
| TC-JNK-04 | Trigger: crumb แล้ว buildWithParameters หรือ build | Jenkins ปกติ | ได้ queue_id | **PARITY** | - | v1 api/jenkins-build/index.php:jb_triggerBuild / v2 src/jenkins/client.ts:269-307 |
| TC-JNK-05 | Error จาก Jenkins แปลเป็น status (401, 403, 404, 502) | Jenkins ตอบ error | ข้อความ error | **PARITY** | v2 แยก status ละเอียดกว่า | v1 api/jenkins-build/index.php:jb_jenkinsRequest / v2 src/jenkins/client.ts:291-296 |
| TC-JNK-06 | Host cooldown breaker หลัง error | host เสีย | trigger ถูกหยุดชั่วคราว | **PARITY** | - | v1 api/helpers.php:1278-1333 / v2 src/jenkins/cooldown.ts:57-130, src/jenkins/client.ts:113 |
| TC-JNK-07 | Maker / checker: maker submit แล้วเป็น pending; checker หรือ admin trigger ตรง | tool.approval.enabled = true | status pending_approval | **MISSING** | ไม่มี approval flow | v1 api/jenkins-build/index.php:376-420 / v2 ไม่มี |
| TC-JNK-08 | Checker อนุมัติหรือปฏิเสธ (403 / 404 / 409) | มี pending | approve → trigger + log; reject → log | **MISSING** | ไม่มี | v1 api/jenkins-build/index.php:450-528 / v2 ไม่มี |
| TC-JNK-09 | Checker submit โดยตรงไม่ได้ | jb_role = checker | 403 / log jenkins_build_checker_submit_blocked | **MISSING** | ไม่มี | v1 api/jenkins-build/index.php:376-381 / v2 ไม่มี |
| TC-JNK-10 | แสดงรายการรออนุมัติและประวัติ 50 รายการ พร้อม reconcile สถานะ | เปิดหน้า | list ครบ | **MISSING** | ไม่มี | v1 api/jenkins-build/index.php:297-353, assets/pages/jenkins-build/*.js:160,169 / v2 ไม่มี |
| TC-JNK-11 | Poll สถานะ build ทุก 2 วินาที สูงสุด 60 ครั้ง หยุดเมื่อ terminal | build queued | สถานะอัปเดต | **PARITY** | - | v1 api/jenkins-build/index.php:288-291 / v2 app/(app)/jenkins-build/JenkinsBuildClient.tsx:23,193-224 |
| TC-JNK-12 | log jenkins_build_trigger | trigger สำเร็จ | activity | **PARITY** | - | v1 api/jenkins-build/index.php:441 / v2 app/api/v1/jenkins-proxy/route.ts:84-89 |

### 4.16 Batch monitor (รายงาน batch) (BATCH)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-BATCH-01 | ดึง records รายเดือนและรายการเดือน | feature batch-monitor | records / months | **PARITY** | - | v1 api/batch-records.php:21-23, 67-80 / v2 app/api/v1/batch-records/route.ts:36-55 |
| TC-BATCH-02 | ส่ง batch report: reporter และ jobs จำเป็น + ต้องมี CSRF | POST ไม่มี CSRF token | 403 / 400 "Invalid payload" | **PARTIAL** | v2 ไม่มี CSRF | v1 api/batch-records.php:26-31 / v2 app/api/v1/batch-records/route.ts:67-90 |
| TC-BATCH-03 | Backfill ต้องเป็น SM coverage admin | sm_user ส่ง backfill=true | 403 | **PARITY** | - | v1 batch-records.php:43-46 / v2 route.ts:79 |
| TC-BATCH-04 | ดู coverage รายวัน (ตามสิทธิ์หน้า batch-monitor) | ผู้ใช้ที่มีสิทธิ์หน้า | ข้อมูล coverage | **PARTIAL** | v2 จำกัดเฉพาะ SM coverage admin (เข้มกว่า v1) | v1 batch-records.php:81-90 / v2 route.ts:22-25 |
| TC-BATCH-05 | หน้า Batch Monitor (UI) | เปิดหน้า | แสดง records และ coverage | **MISSING** | ไม่มีหน้า (มีแค่ menu) | v1 batch-monitor.html (390 บรรทัด), batch-monitor-v2.html / v2 config/menu-catalog.ts:115 |
| TC-BATCH-06 | ค้นหาไฟล์ batch (batch-file-search) | พิมพ์คำค้น | ผลลัพธ์ | **PARTIAL** | มี API v1/batch-file-index/search แต่ไม่มีหน้า | v1 batch-file-search.html / v2 app/api/v1/batch-file-index/search/route.ts |
| TC-BATCH-07 | log batch_report_submitted | submit สำเร็จ | activity | **PARITY** | - | v1 batch-records.php:55-62 / v2 route.ts:86-89 |
| TC-BATCH-08 | แจ้งเตือน batch monitor (config / state / log) | ตั้งค่า noti | ส่งแจ้งเตือนตามรอบ | **MISSING** | ไม่มี | v1 api/batch-monitor-noti/, data/batch-monitor-noti-*.json / v2 ไม่มี |

### 4.17 Admin users (จัดการผู้ใช้) (USR)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-USR-01 | List ผู้ใช้ตามบทบาท: super เห็นทั้งหมด (?team), sm_admin เห็นทีมตัวเอง, sm_user / sm_lead / external เห็นฟิลด์จำกัด | login คนละ role | ข้อมูลตาม role | **PARITY** | - | v1 api/users/index.php:9-137 / v2 src/admin/users-service.ts:155-190, :42 |
| TC-USR-02 | สร้าง user: name / username จำเป็น, email ถูกต้อง, role อยู่ใน allowlist | sm_admin POST ข้อมูลไม่ครบ | 400 messages ตาม v1 | **PARITY** | - | v1 api/users/index.php:143-149 / v2 src/admin/users-service.ts:296-331 |
| TC-USR-03 | จำกัด role ตามผู้สร้าง (sm_admin ได้ sm_user / sm_admin / dev_user; super_viewer เฉพาะ super) | sm_admin สร้าง role sm_lead | 403 "You can only assign the User, Admin, or Dev User role" | **PARITY** | - | v1 api/users/index.php:153-157 / v2 src/admin/users-service.ts:247-255 |
| TC-USR-04 | username ซ้ำ → 'Username already exists' | POST username ซ้ำ | 400 | **PARITY** | - | v1 api/users/index.php:163 / v2 src/admin/users-service.ts:373 |
| TC-USR-05 | สร้าง user: สร้างรหัสชั่วคราว SOM_xxxxxx และส่งอีเมลต้อนรับก่อนบันทึก (ส่งไม่ได้ = ไม่สร้าง) | SMTP ตั้งค่าแล้ว | อีเมลถึง user; ถ้า SMTP ล้มเหลว user ไม่ถูกสร้าง | **MISSING** | รหัสรูปแบบเดียวกัน แต่ไม่มีการส่งอีเมล; audit meta ระบุ sent_to และ UI hint บอกว่าส่งทางอีเมล (ข้อมูลไม่ตรงความจริง) | v1 api/users/index.php:168-170, 212-240 / v2 src/admin/users-service.ts:62-68, 378-382; app/(admin)/admin/users/_components/UserDrawer.tsx:200 |
| TC-USR-06 | รหัสชั่วคราวไม่แสดงให้ admin (v1 ส่งทางอีเมลอย่างเดียว) | สร้าง user | admin ไม่เห็นรหัส | **PARTIAL** | v2 คืน temp_password ให้ UI แสดงบนหน้าจอ (พฤติกรรมใหม่ มีความเสี่ยงด้านความปลอดภัย) | v1 api/users/index.php:212-240 / v2 src/admin/users-service.ts:~382, app/(admin)/admin/users/_components/UsersClient.tsx:116-137 |
| TC-USR-07 | first_login = true (ต้องเปลี่ยนรหัสตอน login ครั้งแรก) | สร้าง user | first_login=true | **PARITY** | v2 เพิ่ม must_reset_password=true ด้วย | v1 api/users/index.php:201 / v2 src/admin/users-service.ts:347-348 |
| TC-USR-08 | กำหนดทีมของ user: super ต้องระบุทีมที่ active, dev_user → dev, sm_admin → ทีมตัวเอง | สร้าง user หลายแบบ | ทีมถูกต้อง | **PARITY** | - | v1 api/users/index.php:172-186 / v2 src/admin/users-service.ts:296-331 (L319-322) |
| TC-USR-09 | แก้ user: name, nickname, email, avatar, contact fields | sm_admin PUT | 200 | **PARTIAL** | API ครบ แต่ UserDrawer ไม่มี avatar upload และไม่มี tmn/net fields | v1 api/users/index.php:262-335 / v2 src/admin/users-service.ts:422-545; app/(admin)/admin/users/_components/UserDrawer.tsx:173-200 |
| TC-USR-10 | ห้ามเปลี่ยน role ของตัวเอง | แก้ role ตัวเอง | 400 "Cannot change your own role" | **PARITY** | - | v1 api/users/index.php:285-288 / v2 src/admin/users-service.ts:446 |
| TC-USR-11 | non-super เปลี่ยน role ได้เฉพาะ sm_user / sm_admin / dev_user | sm_admin เปลี่ยนเป็น sm_lead | 403 | **PARITY** | - | v1 api/users/index.php:290-293 / v2 src/admin/users-service.ts:453-456 |
| TC-USR-12 | toggle schedule / course / exam include (ไม่ใช่ external) | sm_admin toggle | บันทึก | **PARITY** | - | v1 api/users/index.php:306-318 / v2 app/(admin)/admin/users/_components/UserDrawer.tsx:286-301 |
| TC-USR-13 | แก้สิทธิ์หน้าของ external (permissions grid) | external user | บันทึก permissions[] | **MISSING** | ไม่มี UI (ไม่พบใน UserDrawer) | v1 assets/pages/admin/users/users.js:625-646 / v2 ไม่พบ |
| TC-USR-14 | extra_pages ข้ามทีม (super เท่านั้น) | super แก้ extra_pages | บันทึก | **PARTIAL** | API มี แต่ไม่มี UI | v1 api/users/index.php:329-335, users.js:647-732 / v2 src/admin/users-service.ts:459 |
| TC-USR-15 | Force password reset toggle และ log user_force_password_reset | sm_admin เปิด force reset | must_reset_password=true | **PARITY** | - | v1 api/users/index.php:337-345 / v2 src/admin/users-service.ts:491-531; UserDrawer.tsx:312-318 |
| TC-USR-16 | ลบ user: ห้ามลบตัวเอง; ลบถาวร (hard delete) และ log user_delete | sm_admin DELETE | ลบออกจาก users.json | **PARTIAL** | v2 soft delete เป็นค่าเริ่มต้น (deleted_at, status=deleted); hard delete เฉพาะ super | v1 api/users/index.php:363-378 / v2 src/admin/users-service.ts:547-600 |
| TC-USR-17 | Admin reset password: ส่งลิงก์ 24 ชม. ทางอีเมล ไม่เปลี่ยนรหัสเดิม; ไม่มีอีเมล → 400; SMTP ไม่ได้ตั้งค่า → 400 | user มีอีเมล | อีเมลถึง user, รหัสเดิมยังใช้ได้ | **MISSING** | v2 เปลี่ยนรหัสทันทีเป็นรหัสชั่วคราวและคืนให้ admin; ไม่ส่งอีเมล (พฤติกรรมเปลี่ยนชัดเจน) | v1 api/users/index.php:380-447 / v2 src/admin/users-service.ts:612-665; app/api/v1/users/[id]/reset-password/route.ts:1-22 |
| TC-USR-18 | Bulk delete และ bulk reset password | เลือกหลาย user | ทำกับทุกคนที่เลือก | **MISSING** | ไม่มี | v1 assets/pages/admin/users/users.js:486-512 / v2 ไม่มี |
| TC-USR-19 | Reset login block (ปลดล็อก rate limit ของ username) | user ถูกล็อก | ลบ entry ออกจาก rate_limit.json | **MISSING** | ไม่มี (rate limit v2 เป็นต่อ IP) | v1 api/users/reset-login-block.php:1-29, users.js:1018-1024 / v2 ไม่มี |
| TC-USR-20 | Audit log user_create / user_update / user_delete / user_reset_password | แต่ละ action | มี activity | **PARITY** | user_create meta sent_to ไม่ตรงกับความจริง (ดู USR-05) | v1 api/users/index.php:244, 354, 376, 437 / v2 src/admin/users-service.ts:378, 516, 580, 644 |
| TC-USR-21 | กรองผู้ใช้ตามทีม / role / ค้นหา | admin เลือก filter | ผลตรง | **PARTIAL** | มีค้นหาและ role filter; ยังไม่พบ team filter ใน UI | v1 assets/pages/admin/users/users.js:57-60 / v2 app/(admin)/admin/users/_components/UsersClient.tsx:99-100, 238-255 |

### 4.18 Admin system-settings (ตั้งค่าระบบ) (SYS)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-SYS-01 | GET settings (ผู้ใช้ที่ login แล้วทุกคน) | login | ค่า settings | **PARITY** | - | v1 api/system-settings/index.php:35-37 / v2 app/api/v1/system-settings/route.ts:16-30 |
| TC-SYS-02 | PUT: role ใน ADMIN_ROLES (super / sm_admin / dev_sm) แก้ได้ทุก key | login เป็น sm_admin แก้ session_timeout_hours | บันทึกได้ | **PARTIAL** | sm_admin แก้ key นโยบายความปลอดภัยไม่ได้ (super เท่านั้น) | v1 api/system-settings/index.php:40-42 / v2 src/admin/system-settings-service.ts:61-70, 176-190 |
| TC-SYS-03 | Clamp ค่า: session 1-168, remember 1-90, pw expiry 7-365, history 1-20, login 3-20, lockout 5-1440, api rl 10-1000, window 10-3600, trash 1-365 | ส่งค่าเกินช่วง | ถูก clamp | **PARITY** | - | v1 api/system-settings/index.php:84-92 / v2 src/admin/system-settings-service.ts:43-50, 147-149 |
| TC-SYS-04 | Webhook URL: รับเฉพาะ chat.googleapis.com, dedup, กรอง URL ที่ไม่ถูกต้อง | ส่ง URL ผิด | URL ผิดถูกทิ้ง | **PARITY** | - | v1 system-settings/index.php:66-81 / v2 src/admin/system-settings-service.ts:83-100 |
| TC-SYS-05 | บันทึก activity settings_update | PUT สำเร็จ | activity | **PARITY** | - | v1 system-settings/index.php:95 / v2 src/admin/system-settings-service.ts:192-196 |
| TC-SYS-06 | เตือนเมื่อออกจากหน้าโดยยังไม่บันทึก (beforeunload) | แก้ค่าแล้วไม่บันทึก | มี confirm ก่อนออก | **MISSING** | ไม่พบ beforeunload ใน SettingsClient ของ v2 | v1 assets/pages/admin/system-settings/system-settings.js:117-119, 173 / v2 app/(admin)/admin/system-settings/_components/SettingsClient.tsx (ไม่พบ) |

### 4.19 Admin menu-permissions (สิทธิ์เมนูตาม role) (MENU)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-MENU-01 | resolve เมนูของผู้ใช้ปัจจุบัน (ทุก role) | login | allowed / mode | **PARITY** | - | v1 api/menu-permissions/index.php (?resolve) / v2 app/api/v1/menu-permissions/route.ts:43-61 |
| TC-MENU-02 | อ่าน config (admin) พร้อม default เมื่อยังไม่มีไฟล์ | sm_admin GET | config + known_menus + sub_pages | **PARITY** | - | v1 api/menu-permissions/index.php:97-112 / v2 route.ts:63-70, src/perms/store.ts:42-56 |
| TC-MENU-03 | บันทึก roles map: ไม่มี roles → 400 "Invalid config: roles map required" | PUT ไม่มี roles | 400 | **PARTIAL** | v2 ใช้ Zod error (ข้อความต่าง) | v1 api/menu-permissions/index.php:116-118 / v2 route.ts:31-36, 79-80 |
| TC-MENU-04 | Sanitise: '*' หรือ true → '*', array → unique string, อื่น → [] | PUT ค่าหลายรูปแบบ | ค่าที่บันทึกถูกต้อง | **PARITY** | - | v1 api/menu-permissions/index.php:121-132 / v2 route.ts:84-90 |
| TC-MENU-05 | always_visible ค่าเริ่มต้น ['profile','change-password'] | PUT ไม่ส่ง always_visible | ใช้ default | **PARITY** | - | v1 api/menu-permissions/index.php:134-135 / v2 route.ts:92-96 |
| TC-MENU-06 | log menu_permissions_update | PUT สำเร็จ | activity | **PARITY** | - | v1 api/menu-permissions/index.php:141-146 / v2 route.ts:115-118 |
| TC-MENU-07 | Editor UI: wildcard toggle, เปิด/ปิดเมนูรายตัว, badge always-visible | sm_admin เปิดหน้า | toggle ได้ | **PARITY** | - | v1 assets/pages/admin/menu-permissions/menu-permissions.js / v2 app/(admin)/admin/menu-permissions/_components/MenuPermsEditor.tsx:207-261 |

### 4.20 Admin nav-groups (กลุ่มเมนู) (NAV)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-NAV-01 | GET nav groups; ถ้าไม่มีไฟล์ใช้ default และ is_default=true | ไม่มี nav-groups.json | default groups | **PARITY** | - | v1 api/nav-groups/index.php:8-29 / v2 app/api/v1/nav-groups/route.ts:40-50 |
| TC-NAV-02 | บันทึกกลุ่ม: groups[] จำเป็น, แต่ละกลุ่มต้องมี id / label / items | PATCH กลุ่มไม่มี items | 400 "Each group needs id, label, items[]" | **PARTIAL** | ข้อความ error ต่าง (Zod) | v1 api/nav-groups/index.php:37-50 / v2 app/api/v1/nav-groups/route.ts:51-70 |
| TC-NAV-03 | Sanitise id / icon / items (a-z0-9_-), label ≤32 ตัว | label ยาว | ตัดเหลือ 32 | **PARITY** | - | v1 api/nav-groups/index.php:57-62 / v2 route.ts:56-61 (sanitiseSlug, sanitiseGroupLabel) |
| TC-NAV-04 | Reset กลับค่า default (DELETE) | sm_admin กดปุ่ม Reset | ลบไฟล์ → default | **PARTIAL** | API DELETE มี แต่ NavGroupsEditor ไม่มีปุ่ม reset | v1 api/nav-groups/index.php:68-76, assets/pages/admin/nav-groups/*.js:274-278 / v2 app/(admin)/admin/nav-groups/_components/NavGroupsEditor.tsx |
| TC-NAV-05 | สิทธิ์เขียน: sm_admin / dev_sm / super_admin | sm_lead ส่ง PATCH | 403 | **PARITY** | - | v1 api/nav-groups/index.php:28, 69 / v2 route.ts:53 (NAV_GROUPS_WRITE_ROLES) |
| TC-NAV-06 | log nav_groups_update | บันทึกสำเร็จ | activity | **PARITY** | - | v1 api/nav-groups/index.php:69-70 / v2 route.ts:71-74 |

### 4.21 Super team permissions (สิทธิ์ทีม และสร้าง / ลบทีม) (TEAM)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-TEAM-01 | super_admin แก้ features / feature_pages / page_modes / active ของทีม และ log team_permissions_updated | login เป็น super_admin | บันทึกได้ | **PARITY** | - | v1 api/teams/index.php:78-126 / v2 app/api/v1/teams/[id]/route.ts:39-80 |
| TC-TEAM-02 | สร้างทีม: slug regex, ≤32 ตัว, name จำเป็น, slug ซ้ำ → 409 | super POST | 201 / 409 | **MISSING** | ไม่มี POST (teams/route.ts มีแค่ GET) | v1 api/teams/index.php:33-71 / v2 app/api/v1/teams/route.ts:15 |
| TC-TEAM-03 | ปิดใช้งานทีม (soft: active=false) และ log team_deactivated | super DELETE | active=false | **MISSING** | ไม่มี | v1 api/teams/index.php:170-181 / v2 ไม่มี |
| TC-TEAM-04 | ลบทีมถาวร ?force=true (ห้ามลบ sm) | super DELETE force | ลบ / 403 | **MISSING** | ไม่มี | v1 api/teams/index.php:138-167 / v2 ไม่มี |
| TC-TEAM-05 | Copy config ของ feature จาก SM (ไม่ทับไฟล์เดิมถ้าไม่ระบุ overwrite) | super POST copy-config | copied / skipped | **MISSING** | ไม่มี route และไม่มีปุ่ม Copy from SM | v1 api/teams/copy-config.php:17-72, assets/pages/admin/super-team-permissions/super-team-permissions.js:361-388 / v2 ไม่มี |
| TC-TEAM-06 | ผู้ที่ไม่ใช่ super เห็นเฉพาะทีมตัวเอง | sm_admin GET teams | ได้เฉพาะทีมตัวเอง | **PARITY** | - | v1 api/teams/index.php (GET) / v2 app/api/v1/teams/route.ts:15-25 |

### 4.22 Backup (สำรองข้อมูล) (BKP)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-BKP-01 | ดูรายการ backup (ADMIN_ROLES) | sm_admin | list | **MISSING** | ไม่มี route หรือหน้า | v1 api/backup/index.php:12, 22-32 / v2 ไม่มี |
| TC-BKP-02 | สร้าง zip backup (ZipArchive) และ log backup_created | sm_admin POST | ไฟล์ zip ใน data/backups | **MISSING** | ไม่มี | v1 api/backup/index.php:36-101 / v2 ไม่มี |
| TC-BKP-03 | ดาวน์โหลด backup | sm_admin GET download | ไฟล์ zip | **MISSING** | ไม่มี | v1 api/backup/download.php:8 / v2 ไม่มี |
| TC-BKP-04 | ลบ backup (ตรวจชื่อไฟล์) และ log backup_deleted | DELETE ชื่อไม่ถูกต้อง / ถูกต้อง | 400 'Invalid filename' / ลบ | **MISSING** | ไม่มี | v1 api/backup/index.php:103-119 / v2 ไม่มี |
| TC-BKP-05 | Restore จาก backup | sm_admin POST restore | กู้คืนข้อมูล | **MISSING** | ไม่มี | v1 api/backup/restore.php / v2 ไม่มี |

### 4.23 Activity / security log (บันทึกและดูบันทึก) (LOG)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-LOG-01 | หน้าดู log (super_admin) | login super_admin | รายการ log | **MISSING** | ไม่มี route หรือหน้า | v1 api/log/index.php:5 / v2 ไม่มี |
| TC-LOG-02 | Feed กิจกรรมของ dashboard (whitelist FEED_ACTIONS, limit ≤100) | login ทุก role | รายการ feed | **MISSING** | ไม่มี (ดู DASH-03) | v1 api/log/feed.php:4-44 / v2 ไม่มี |
| TC-LOG-03 | ดู security log | super_admin | รายการ security | **MISSING** | v2 เขียน security log (src/logging/security.ts) แต่ไม่มี reader | v1 api/log/security.php / v2 src/logging/security.ts |
| TC-LOG-04 | เขียน activity และ security log ตาม mutation | ทำ action | มี log | **PARITY** | v2 เขียนแล้ว แต่ไม่ครบทุกจุด (ดู LOGIN-10, SESS-04) | v1 api/helpers.php:1217-1256 / v2 src/logging/activity.ts, src/logging/security.ts |
| TC-LOG-05 | รับ client error log | client เกิด error | บันทึกลงไฟล์ | **MISSING** | ไม่มี | v1 api/log/client-error.php, client-error-public.php / v2 ไม่มี |

### 4.24 Admin index (หน้าแอดมินหลัก) (ADMIN)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-ADMIN-01 | KPI: จำนวน user, board, template, link, health | sm_admin เปิดหน้า | ตัวเลขจริง | **PARTIAL** | v2 มีเฉพาะ user / teams / session timeout | v1 assets/pages/admin/index/index.js:25-60 / v2 app/(admin)/admin/page.tsx:44-57 |
| TC-ADMIN-02 | การ์ดเมนูกรองตาม feature / role / team | role ต่างกัน | แสดงเฉพาะที่มีสิทธิ์ | **PARTIAL** | v2 มี grid การ์ดแต่ยังไม่ยืนยันการกรองตาม canSeePage | v1 assets/pages/admin/index/index.js:57-80 / v2 app/(admin)/admin/page.tsx |
| TC-ADMIN-03 | Health check (Jira / Jenkins) จากหน้า admin | sm_admin เปิดหน้า | สถานะ health | **MISSING** | API /api/health มี แต่หน้า admin ไม่เรียก | v1 assets/pages/admin/index/index.js:261 / v2 app/api/health/route.ts |

### 4.25 Session และความปลอดภัยระดับระบบ (SESS)

| ID | พฤติกรรม v1 | Precondition / Steps | Expected (ตาม v1) | สถานะ v2 | ช่องว่างใน v2 | หลักฐาน |
|---|---|---|---|---|---|---|
| TC-SESS-01 | super_viewer เขียนไม่ได้ทุก endpoint (ถูกบล็อก 403) ยกเว้นที่อนุญาต | login super_viewer, POST board | 403 | **MISSING** | v2 ไม่มี global read-only guard; board อนุญาตเขียนถ้า page mode ไม่ใช่ read (resolveWriteMode คืน true) | v1 api/helpers.php:625-637 / v2 src/board/access.ts:148-153, 194; src/auth/policy.ts:27 |
| TC-SESS-02 | CSRF: GET csrf.php หมุน token และ requireCsrf บน POST / PUT / PATCH / DELETE | login, POST ไม่มี token | 403 | **MISSING** | v2 ไม่มี CSRF (พึ่ง SameSite=lax และ JSON) | v1 api/auth/csrf.php, api/helpers.php:661-674 / v2 ไม่มี |
| TC-SESS-03 | requireAuth ตรวจ password หมดอายุ / ต้องรีเซ็ตทุก API → 403 PASSWORD_EXPIRED / MUST_RESET_PASSWORD | session เก่า เรียก API | 403 | **MISSING** | middleware v2 ตรวจแค่ JWT (src/auth/middleware.ts:19-30) | v1 api/helpers.php:640-658 / v2 src/auth/policy.ts:30-34 |
| TC-SESS-04 | Logout บันทึก activity และ security log | login แล้ว logout | activity logout + security logout | **PARTIAL** | v2 บันทึกแค่ activity | v1 api/auth/logout.php:8-9 / v2 app/api/auth/logout/route.ts:23-37 |
| TC-SESS-05 | Session bootstrap (me.php) คืน first_login / password_expired / team / is_genz | login แล้วโหลดหน้า | สถานะ user | **PARTIAL** | v2 ไม่มี me endpoint; อ่าน session จาก cookie ฝั่ง server (getSession) | v1 api/auth/me.php:6-39 / v2 src/auth/session.ts |
| TC-SESS-06 | ส่ง token เป็น Bearer header (localStorage) | - | - | **PARTIAL** | เปลี่ยนเป็น HttpOnly cookie (เป็นการออกแบบ ไม่ใช่ข้อบกพร่อง) | v1 api/helpers.php:599-612, assets/js/auth.js / v2 src/auth/cookies.ts, middleware.ts |

## 5. v1 หน้าและ API ที่ไม่มีใน v2 — จัดตาม phase

ใช้การแบ่ง phase จาก `nextjs-v2-plan/PAGE-COMPARISON.md` เป็นหลัก หมายเหตุ: รายการที่ระบุ "(อนุมาน)" ไม่ได้อยู่ในเอกสารเดิม

### 5.1 ในขอบเขต Phase 1 แต่ยังไม่มีใน v2

- **หน้า (UI)**: `profile.html` ส่วนดูโปรไฟล์ผู้ใช้อื่น (`assets/pages/profile/profile.js:153`), `batch-monitor.html`, `batch-monitor-v2.html`, `batch-file-search.html`, `admin/backup.html`, `admin/logs.html`, `admin/trash.html` (ต้องยืนยันว่าซ้ำกับ `/v2/board/trash`), ส่วน activity และ achievements ใน profile
- **API**: `api/auth/my-activity.php`, `api/auth/me.php` (v2 ใช้ server session แทน), `api/presence/heartbeat.php`, `api/presence/list.php`, `api/search/index.php`, `api/backup/*` (index, create, download, restore, delete), `api/log/index.php`, `api/log/feed.php`, `api/log/security.php`, `api/log/client-error*.php`, `api/users/profile.php`, `api/users/avatars.php`, `api/users/reset-login-block.php`, `api/board-config/index.php` (ส่วนเขียน), `api/service-types/index.php`, `api/dev-subteams/index.php`, `upload.php` (รูปในโพสต์), `api/jenkins-build` ส่วน history / approvals, `api/teams/index.php` (POST, ?force, soft delete), `api/teams/copy-config.php`, `api/batch-monitor-noti/*`
- **หมายเหตุการจัดเฟส**: PAGE-COMPARISON.md วาง backup ไว้ Phase 3 (system group) แต่ขอบเขต Phase 1 ที่ผู้ใช้ระบุรวม backup ไว้ ต้องตัดสินใจ; presence, search, notifications clear-read, my-activity และ log viewer ไม่ได้อยู่ในเอกสารแผนเลย

### 5.2 Phase 2 (ตาม PAGE-COMPARISON.md) ที่ยังไม่มีหน้าใน v2

- **หน้าผู้ใช้**: `send-email.html`, `case-incidents.html`
- **หน้า admin integrations (9 หน้า)**: `admin/jira-config.html`, `admin/jenkins-servers.html` (มี API `v1/jenkins-servers` แล้ว), `admin/grafana-sources.html`, `admin/opensearch-config.html` (มี API `opensearch/config` แล้ว), `admin/service-inventory.html`, `admin/mail-logs.html` (มี API `mail/logs` แล้ว), `admin/email-noti.html`, `admin/n8n-oncall-config.html`; `admin/mail-config.html` มีหน้าแล้ว
- **หน้าที่อนุมาน**: `admin/incident-launcher-config.html` ผูกกับ incident-launcher ที่มีหน้าแล้วบนดิสก์ ควรอยู่ Phase 2
- **API ที่ยังไม่มี**: `api/grafana-sources/`, `api/n8n-oncall.php`, `api/n8n-oncall-config.php`, `api/n8n-severity-config.php`, `api/n8n-severity-sync.php`, `api/email-noti/`, `api/fh-email-config/`, `api/service-inventory/`, `api/service-severity/`, `api/sms-gateway/`, `api/rundeck-proxy.php`
- **หมายเหตุ**: Phase 2 pages ที่ PAGE-COMPARISON ระบุว่า "not started" มีอยู่บนดิสก์แล้ว (ดูหัวข้อ 6) จึงไม่ได้ audit ลึกในไฟล์นี้

### 5.3 Phase 3 (ทุกอย่างที่เหลือ)

- **หน้าผู้ใช้**: `about-som`, `alert-monitor`, `analytics`, `begin-grafana`, `collection-lead-flow`, `compare`, `dev-hub`, `documentation`, `exam`, `exam-reports`, `genz-hub`, `genz-notes`, `holiday-plans`, `import-ma`, `inbox`, `jenkins-portal`, `knowledge-base`, `learn`, `learn-course`, `learn-phase`, `learn-reports`, `ma-planwork`, `ma-test`, `maintenance` (หน้า public พิเศษ, ควรพิจารณาก่อน cutover), `migrate-user`, `monitoring`, `my-team`, `onboarding`, `ops-runbook`, `pipeline-flow`, `pw-schedule`, `report`, `report-center`, `sabai`, `schedule`, `setup-guide`, `sheets`, `sms-gateway-switches`, `so-jenkins`, `syncup`, `test-service`, `uptime`, `weekly-report`, `weekly-report-form`
- **หน้า admin**: `about-page`, `achievements`, `alert-monitor-config`, `analytics`, `announcements`, `batch-file-index`, `batch-meta`, `batch-monitor`, `batch-monitor-noti`, `courses`, `dev-api`, `dev-data`, `dev-email`, `dev-logs`, `dev-system`, `devtools`, `exams`, `feature-requests`, `fh-config`, `genz-team`, `holiday-plans`, `knowledge-base`, `leave-approval`, `links`, `logs`, `ma-config`, `ma-test-catalog`, `ma-test-overview`, `ma-test-plans`, `maintenance`, `onboarding`, `ops-runbook`, `pw-schedule`, `requests`, `schedule`, `service-severity`, `sheets`, `sms-gateway-config`, `super-admin`, `super-email-templates`, `super-feature-requests`, `super-viewer`, `syncup-config`, `system-monitor`, `templates`, `test-service`, `tools`, `weekly-report`
- **API**: `achievements`, `alerts`, `announcements`, `chat-proxy.php`, `courses`, `exams`, `feature-requests`, `genz-*`, `holiday-plans`, `inbox`, `knowledge-base`, `links`, `ma-modules`, `ma-test`, `migrate-user`, `migrate-monthly.php`, `monitoring`, `my-team`, `ops-runbook`, `pipeline-flows`, `pw-schedule(-config)`, `requests`, `super-viewer(-config)`, `syncup`, `team-config`, `test-records*`, `test-service-config.php`, `uptime`, `weekly-report`, `dashboard/learning-status.php`, `collection-lead-flow`, `cutoff-services`, `downstream-health`, `dev`, `fundout-proxy.php`, `ai`, `sidebar-tools`, `version.php`

### 5.4 Dead / mockup ที่ไม่ต้อง port

`office`, `presentation`, `report-center-mockup`, `card-mockups-v2`, `dashboard-back`, `monitoring-back`, `service-performance-back`, `onboarding-backold`, `onboarding-backnew`, `jira-templates-backup`, `mockup-endpoint-designs`, `mockup-genz-1-y2k`, `mockup-genz-2-bento`, `mockup-genz-3-glass`, `mockup-genz-4-zine`, `navbar-ma-indicator-mockups`, `_dcl`, `cron-builder`, `debug-nano-ma`, `test-incident-launcher`, `command-center-real` (experimental), `admin/email-footer-mockups`, `admin/email-logo-mockups`, `admin/email-logo-typewriter`, `admin/email-mockups`

### 5.5 v1 ที่มี counterpart ใน v2 แล้วแต่อยู่คนละ path

API ของ v1 เช่น `api/board/`, `api/board-comments/`, `api/stars/`, `api/notifications/`, `api/jira/create.php`, `api/templates/`, `api/users/`, `api/system-settings/`, `api/teams/`, `api/nav-groups/`, `api/menu-permissions/`, `api/mail/*`, `api/restart-monitor/*`, `api/service-performance/*`, `api/opensearch-*`, `api/ma-*`, `api/scheduled-noti/` มี counterpart ใน v2 (ใน `app/api/*` หรือ `app/api/v1/*` หรือ server actions) ดูคอลัมน์หลักฐานในหัวข้อ 4 สำหรับ Phase 1

## 6. เอกสารเดิมที่ไม่ตรงกับดิสก์

- `nextjs-v2-plan/PAGE-COMPARISON.md` แถว forgot-password และ reset-password ระบุ "empty dir" แต่บนดิสก์มี `som-portal-v2/app/(public)/forgot-password/page.tsx` และ `som-portal-v2/app/(public)/reset-password/page.tsx` แล้ว
- `PAGE-COMPARISON.md` นับ v2 ที่ shipped เป็น 14 หน้า แต่ `find app -name page.tsx` พบ 24 ไฟล์ (ไม่รวม `bridge` และ `preview`) รวมหน้า Phase 2 ที่มีอยู่แล้ว: service-performance, restart-monitor, restart-analyzer, log-explorer, incident-launcher, ma-services, ma-status, admin/mail-config, admin/scheduled-noti
- `PAGE-COMPARISON.md` และ `HANDOFF.md` ระบุว่า dashboard ✅ shipped แต่หน้าเป็น mock (ดู Gap 1)
- `HANDOFF.md` ระบุว่ามี `/v2/board/[id]` แต่ไม่มีไฟล์ `app/(app)/board/[id]/` บนดิสก์
- `PAGE-COMPARISON.md` ระบุ "v2 ships 31 API routes" แต่ `app/api/**/route.ts` มี 85 ไฟล์
- `HANDOFF.md` สถานะ "Phase 1 SHIPPED" ควรปรับเป็น partial ตามผล audit นี้ (ดูสรุปหัวข้อ 1)
- PAGE-COMPARISON.md และ HANDOFF.md ไม่ได้กล่าวถึง: presence, global search, backup, log viewer, my-activity, notifications clear-read, teams create / copy-config, jenkins approval, batch-monitor UI

## 7. ข้อจำกัดของ audit นี้

- อ่านซอร์สอย่างเดียว ไม่ได้รัน dev server, Playwright หรือ e2e ดังนั้น PARITY หมายถึงตรรกะในซอร์สตรงกัน ไม่ได้รับรองพฤติกรรมจริงบน browser
- ไฟล์ UI ของ v1 ยาว (`dashboard.js` 1702 บรรทัด, `board.js` 1277, `profile.js` 974) ไม่ได้อ่านทุกบรรทัด บางรายละเอียด UI ระบุว่า "ยืนยันไม่ได้" หรือ "ต้องยืนยัน" ในตาราง
- ไม่ได้ตรวจ `data/` ของจริง และไม่ได้ตรวจ Phase 2 pages บนดิสก์ในเชิงลึก
- Jenkins-build และ batch monitor ใน v1 มี config แยกต่อทีม (`data/ss/`, `data/sm/`); การเทียบเป็นการเทียบตรรกะ ไม่ใช่ข้อมูล

