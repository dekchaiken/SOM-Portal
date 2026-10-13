/**
 * External On-Call Apps Script (Version 2)
 * 
 * โครงสร้าง Sheet:
 * Column A: ชื่อ - ทีม - เบอร์ (เช่น "Narin - TMN - 0998132540")
 * Column B onwards: วันที่ที่คนนั้น on-call (เช่น "2/1/2026", "2/15/2026")
 * 
 * วิธีใช้:
 * 1. เปิด Google Sheets → Extensions → Apps Script
 * 2. คัดลอกโค้ดนี้ทั้งหมด แล้ววางแทนโค้ดเดิม
 * 3. แก้ไข SHEET_ID ให้ตรงกับ Sheet ของคุณ
 * 4. บันทึก (Ctrl+S)
 * 5. Deploy → Manage deployments → Edit → Version: New version → Deploy
 */

// ═══════════════════════════════════════════════════════════════════
// ⚙️ Configuration
// ═══════════════════════════════════════════════════════════════════
const SHEET_ID = '17v6_tVYzP9s1RAPj_oOpYRUiVJMq82aP29NgiyDUuRM';

// ═══════════════════════════════════════════════════════════════════
// 🌐 Main Handler
// ═══════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = e.parameter.action || '';
  const date = e.parameter.date || '';

  try {
    if (action === 'sheets') {
      return jsonResponse(getSheetList());
    }
    
    if (action === 'raw') {
      return jsonResponse(getAllRawData());
    }
    
    // Default: get on-call for specific date
    const targetDate = date || getTodayDateString();
    const oncall = getOncallForDate(targetDate);
    
    return jsonResponse({
      date: targetDate,
      oncall: oncall,
      count: oncall.length
    });
    
  } catch (err) {
    return jsonResponse({
      error: err.toString(),
      stack: err.stack
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 Get list of sheet tabs
// ═══════════════════════════════════════════════════════════════════
function getSheetList() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = ss.getSheets();
  
  return {
    sheets: sheets.map(s => ({
      name: s.getName(),
      index: s.getIndex(),
      rowCount: s.getLastRow(),
      colCount: s.getLastColumn()
    }))
  };
}

// ═══════════════════════════════════════════════════════════════════
// 🔬 Get raw data from all tabs (for debugging)
// ═══════════════════════════════════════════════════════════════════
function getAllRawData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = ss.getSheets();
  const result = {};
  
  sheets.forEach(sheet => {
    const name = sheet.getName();
    const data = sheet.getDataRange().getValues();
    result[name] = data;
  });
  
  return { raw: result };
}

// ═══════════════════════════════════════════════════════════════════
// 👥 Get on-call people for specific date
// ═══════════════════════════════════════════════════════════════════
function getOncallForDate(dateString) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = ss.getSheets();
  const oncallList = [];
  
  sheets.forEach(sheet => {
    const teamName = sheet.getName();
    const data = sheet.getDataRange().getValues();
    
    if (data.length < 1) return; // Skip empty sheets
    
    // Loop through each row (each person)
    for (let row = 0; row < data.length; row++) {
      const nameInfo = String(data[row][0] || '').trim(); // Column A
      
      if (!nameInfo) continue; // Skip empty rows
      
      // Parse name info: "Name - Team - Phone"
      const parts = nameInfo.split('-').map(p => p.trim());
      const name = parts[0] || nameInfo;
      const subTeam = parts[1] || '';
      const phone = parts[2] || '';
      
      // Check columns B onwards for dates
      for (let col = 1; col < data[row].length; col++) {
        const cellValue = data[row][col];
        if (!cellValue) continue;
        
        const cellDate = parseDateFromCell(cellValue);
        
        // If this cell's date matches target date, this person is on-call
        if (cellDate === dateString) {
          oncallList.push({
            team: teamName,
            sub_team: subTeam,
            name: name,
            phone: phone,
            date: dateString
          });
          break; // Found match, no need to check other columns for this person
        }
      }
    }
  });
  
  return oncallList;
}

// ═══════════════════════════════════════════════════════════════════
// 📅 Parse date from cell (handle various formats)
// ═══════════════════════════════════════════════════════════════════
function parseDateFromCell(cellValue) {
  if (!cellValue) return '';
  
  // If it's a Date object
  if (cellValue instanceof Date) {
    return formatDate(cellValue);
  }
  
  // If it's a string
  const str = String(cellValue).trim();
  
  // Try YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  
  // Try M/D/YYYY format (e.g., "2/1/2026" or "12/31/2026")
  const match1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match1) {
    const month = match1[1].padStart(2, '0');
    const day = match1[2].padStart(2, '0');
    const year = match1[3];
    return `${year}-${month}-${day}`;
  }
  
  // Try DD/MM/YYYY format
  const match2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match2) {
    // Ambiguous - assume M/D/YYYY (US format) since that's what you mentioned
    const month = match2[1].padStart(2, '0');
    const day = match2[2].padStart(2, '0');
    const year = match2[3];
    return `${year}-${month}-${day}`;
  }
  
  return '';
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 Format Date object to YYYY-MM-DD
// ═══════════════════════════════════════════════════════════════════
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ═══════════════════════════════════════════════════════════════════
// 📆 Get today's date as YYYY-MM-DD
// ═══════════════════════════════════════════════════════════════════
function getTodayDateString() {
  return formatDate(new Date());
}

// ═══════════════════════════════════════════════════════════════════
// 📤 JSON response helper
// ═══════════════════════════════════════════════════════════════════
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
