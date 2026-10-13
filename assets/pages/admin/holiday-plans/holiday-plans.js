// admin/holiday-plans — page script, extracted from admin/holiday-plans.html.
//
// Wrapped in an IIFE on purpose. When this code lived inline it was run through
// Layout's indirect eval, which kept const/let/class LOCAL; as a plain external
// script those would become global lexical bindings and collide with other pages'
// scripts (both stay loaded across SPA navigation). The IIFE restores that scoping.
//
// Top-level function/var declarations DID leak to global under eval, and inline
// on*="" handlers in the HTML call them, so they are re-published on window below
// via accessor bridges (get + set, so later reassignment stays in sync).
(function () {
'use strict';

if (!Auth.requireAuth()) {}
Layout.render('admin-holiday-plans');

const _today = new Date();
let curYear  = _today.getFullYear(), curMonth = _today.getMonth()+1;
let plansData={}, usersData=[], quotaData={}, leaveData=[], holidayMap=new Map();
let fullYearScheduleData={}, _fullYearLoadedFor=null;

const MTH=['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const DTH=['อา','จ','อ','พ','พฤ','ศ','ส'];
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const p2=n=>String(n).padStart(2,'0');
const ds=(y,m,d)=>`${y}-${p2(m)}-${p2(d)}`;

function changeMonth(d){const py=curYear;curMonth+=d;if(curMonth>12){curMonth=1;curYear++;}if(curMonth<1){curMonth=12;curYear--;}loadMonthData();if(curYear!==py)loadFullYearSchedule();}
function changeYear(d){curYear+=d;loadAll();}
function goToday(){const py=curYear;curYear=_today.getFullYear();curMonth=_today.getMonth()+1;loadMonthData();if(curYear!==py)loadFullYearSchedule();}

async function loadAll(){
  const[uR,qR,lR,hR]=await Promise.all([API.users.list(),API.vacation.getQuotas(),API.leave.list({admin:true}),API.holidays.list()]);
  usersData=uR?.ok?(uR.data.data||[]):[];
  quotaData=qR?.ok?(qR.data.data||{}):{};
  leaveData=lR?.ok?(lR.data.data||[]):[];
  holidayMap=new Map((hR?.ok?(hR.data.data||[]):[]).map(h=>[h.date,h.name]));
  await loadMonthData();
  loadFullYearSchedule();
}
async function loadMonthData(){
  const r=await API.holidayPlans.get(curYear,curMonth);
  plansData=r?.ok?(r.data.data?.plans||{}):{};
  renderAll();
}
async function loadFullYearSchedule(){
  if(_fullYearLoadedFor===curYear)return;
  _fullYearLoadedFor=curYear;
  fullYearScheduleData={};
  const results=await Promise.all(Array.from({length:12},(_,i)=>API.schedule.get(curYear,i+1)));
  results.forEach(r=>{if(r?.ok)Object.assign(fullYearScheduleData,r.data.data||{});});
  renderAll();
}
function getRemaining(uid){
  const q=parseFloat(quotaData[uid])||0; if(!q)return null;
  const yearStr=String(curYear);
  const cov=new Set();
  const usedFromLeaves=leaveData.filter(l=>l.user_id===uid&&l.status==='approved'&&l.type==='vacation')
    .reduce((s,l)=>{
      let yearDates=[];
      if(l.dates?.length) yearDates=l.dates.filter(d=>d.startsWith(yearStr));
      else if(l.start_date&&l.end_date){
        for(let d=new Date(l.start_date);d<=new Date(l.end_date);d.setDate(d.getDate()+1)){
          const ds=d.toISOString().slice(0,10);
          if(ds.startsWith(yearStr)) yearDates.push(ds);
        }
      }
      yearDates.forEach(d=>cov.add(d));
      if(!yearDates.length)return s;
      return s+(l.duration==='half'?yearDates.length*0.5:yearDates.length);
    },0);
  const extraFromSchedule=Object.entries(fullYearScheduleData).reduce((s,[date,day])=>{
    if(!date.startsWith(yearStr)||cov.has(date))return s;
    return s+(day.vacation||[]).reduce((ss,v)=>
      ss+(typeof v==='object'&&v.user_id===uid?(v.days||1):v===uid?1:0),0);
  },0);
  const r=q-usedFromLeaves-extraFromSchedule;
  return r%1===0?r:parseFloat(r.toFixed(1));
}

function renderAll(){
  const todStr=ds(_today.getFullYear(),_today.getMonth()+1,_today.getDate());
  const dim=new Date(curYear,curMonth,0).getDate(), label=`${MTH[curMonth]} ${curYear+543}`;
  document.getElementById('adm-title').textContent=label;
  document.getElementById('adm-status-label').textContent=label;

  const planners=usersData.filter(u=>(plansData[u.id]||[]).length>0);
  const missing=usersData.filter(u=>(plansData[u.id]||[]).length===0);
  document.getElementById('chip-done').innerHTML=`<i data-icon=\"check\"></i> ${planners.length} คนกรอกแล้ว`;
  document.getElementById('chip-missing').innerHTML=`<i data-icon=\"x\"></i> ${missing.length} ยังไม่กรอก`;

  document.getElementById('status-grid').innerHTML=usersData.length?usersData.map(u=>{
    const cnt=(plansData[u.id]||[]).length, rem=getRemaining(u.id);
    return`<div class="status-cell">
      <div class="status-dot" style="background:${cnt>0?'var(--orange)':'#e5e7eb'}"></div>
      <div><div class="status-name">${esc(u.nickname||u.name.split(' ')[0]||u.name)}</div>
      <div class="status-sub">${rem!==null?`เหลือ ${rem} วัน`:'ยังไม่ตั้งโควต้า'}</div></div>
      <span class="status-badge ${cnt>0?'done':'none'}">${cnt>0?cnt+' วัน':'—'}</span>
    </div>`;
  }).join(''):'<div style="padding:24px;color:#aaa;font-size:12px;background:white;grid-column:1/-1">ยังไม่มีสมาชิก</div>';

  let hd=`<tr><th class="cal-th-name">ชื่อ</th>`;
  for(let d=1;d<=dim;d++){
    const date=ds(curYear,curMonth,d),dw=new Date(curYear,curMonth-1,d).getDay();
    let c='cal-th-day';
    if(date===todStr)c+=' tod'; else if(holidayMap.has(date))c+=' hol'; else if(dw===0||dw===6)c+=' wkd';
    hd+=`<th class="${c}" ${holidayMap.has(date)?`title="${esc(holidayMap.get(date))}"`:''}><div>${p2(d)}</div><div style="font-size:8px;opacity:.7">${DTH[dw]}</div></th>`;
  }
  hd+=`<th class="cal-th-total">วันแผน</th></tr>`;
  document.getElementById('cal-thead').innerHTML=hd;

  document.getElementById('cal-tbody').innerHTML=usersData.length?usersData.map(u=>{
    const rem=getRemaining(u.id), remOvr=rem!==null&&rem<0?`color:#ef4444;border-color:#ef4444;background:#ef444422`:rem!==null&&rem<=3?`color:#f97316;border-color:#f97316;background:#f9731622`:'';
    const plan=new Set(plansData[u.id]||[]);
    let cells='';
    for(let d=1;d<=dim;d++){
      const date=ds(curYear,curMonth,d),dw=new Date(curYear,curMonth-1,d).getDay();
      let c='cal-td-cell';
      if(plan.has(date))c+=' plan'; else if(holidayMap.has(date))c+=' hol'; else if(dw===0||dw===6)c+=' wkd';
      cells+=`<td class="${c}" onclick="adminToggle('${u.id}','${date}')"></td>`;
    }
    return`<tr>
      <td class="cal-td-name">
        <span class="rem-badge" style="${remOvr}">${rem!==null?rem:'—'}</span>
        <div><div style="font-weight:700;font-size:12px;color:var(--text)">${esc(u.nickname||u.name.split(' ')[0]||u.name)}</div>${u.nickname?`<div style="font-size:9px;color:#aaa">${esc(u.name)}</div>`:''}</div>
      </td>${cells}
      <td class="cal-td-total">${plan.size>0?`<strong>${plan.size}</strong>`:`<span style="color:#ddd">—</span>`}</td>
    </tr>`;
  }).join(''):'<tr><td colspan="40" style="text-align:center;padding:32px;color:#aaa;font-size:12px">ยังไม่มีสมาชิก</td></tr>';
}

async function adminToggle(userId,date){
  const[y,m]=date.split('-').map(Number);
  if(y!==curYear||m!==curMonth)return;
  const cur=new Set(plansData[userId]||[]);
  cur.has(date)?cur.delete(date):cur.add(date);
  const dates=[...cur].sort();
  const res=await API.holidayPlans.save({year:curYear,month:curMonth,dates,user_id:userId});
  if(!res?.ok){Toast.error('บันทึกไม่สำเร็จ');return;}
  plansData[userId]=dates; renderAll();
}

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "adminToggle", { configurable: true, get: () => adminToggle, set: (v) => { adminToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeMonth", { configurable: true, get: () => changeMonth, set: (v) => { changeMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeYear", { configurable: true, get: () => changeYear, set: (v) => { changeYear = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getRemaining", { configurable: true, get: () => getRemaining, set: (v) => { getRemaining = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goToday", { configurable: true, get: () => goToday, set: (v) => { goToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFullYearSchedule", { configurable: true, get: () => loadFullYearSchedule, set: (v) => { loadFullYearSchedule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMonthData", { configurable: true, get: () => loadMonthData, set: (v) => { loadMonthData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAll", { configurable: true, get: () => renderAll, set: (v) => { renderAll = v; } }); } catch (e) {}
})();
