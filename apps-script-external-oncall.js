/**
 * External On-Call Apps Script
 * 
 * วิธีใช้:
 * 1. เปิด Google Sheets → Extensions → Apps Script
 * 2. คัดลอกโค้ดนี้ทั้งหมด แล้ววางแทนโค้ดเดิม
 * 3. แก้ไข SHEET_ID ให้ตรงกับ Sheet ของคุณ
 * 4. บันทึก (Ctrl+S)
 * 5. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone within Ascend Corp (หรือ Anyone)
 * 6. คัดลอก URL ที่ได้ไปใส่ใน SOM-Portal
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
    
    if (data.length < 2) return; // Skip empty sheets
    
    // Row 1 = headers (Column C onwards = dates)
    const headers = data[0];
    let dateColIndex = -1;
    
    // Find column that matches target date
    for (let col = 2; col < headers.length; col++) { // Start from column C (index 2)
      const cellValue = headers[col];
      const cellDate = parseDateFromCell(cellValue);
      
      if (cellDate === dateString) {
        dateColIndex = col;
        break;
      }
    }
    
    if (dateColIndex === -1) return; // Date not found in this sheet
    
    // Find person with 'X' or 'x' in that date column
    for (let row = 1; row < data.length; row++) {
      const marker = String(data[row][dateColIndex]).trim().toUpperCase();
      
      if (marker === 'X') {
        const nameInfo = String(data[row][0] || '').trim(); // Column A
        const phone = String(data[row][1] || '').trim();    // Column B
        
        if (nameInfo) {
          oncallList.push({
            team: teamName,
            name: nameInfo,
            phone: phone,
            date: dateString
          });
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
  
  // If it's a string like "2024-01-15" or "15/01/2024"
  const str = String(cellValue).trim();
  
  // Try YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  
  // Try DD/MM/YYYY format
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
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
