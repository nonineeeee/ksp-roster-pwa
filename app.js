
let staff=[];
let currentMonth={year:null,month:null};
let batchAssignments=[];

const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  initMonthOptions();
  initDefaultDates();
  bindEvents();
  updateRangeText();
  checkApi();
  loadStaff();
  loadMonthInfo().then(loadMonthRoster);

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
});

function bindEvents(){
  $('prepareMonthBtn').addEventListener('click',prepareMonth);
  $('reloadStaffBtn').addEventListener('click',loadStaff);
  $('startDate').addEventListener('change',updateRangeText);
  $('chooseDayBtn').addEventListener('click',()=>addBatchAssignment('白班'));
  $('chooseNightBtn').addEventListener('click',()=>addBatchAssignment('晚班'));
  $('save4Btn').addEventListener('click',save4Days);
  $('singleSlot').addEventListener('change',toggleSingleMobileShift);
  $('saveSingleBtn').addEventListener('click',saveSingle);
  $('loadMonthBtn').addEventListener('click',loadMonthRoster);
}

function initMonthOptions(){
  $('month').innerHTML=
    Array.from({length:12},(_,i)=>
      `<option value="${i+1}">${i+1}月</option>`
    ).join('');
}

function initDefaultDates(){
  const now=new Date();
  $('year').value=now.getFullYear();
  $('month').value=now.getMonth()+1;
  const iso=toIso(now);
  $('startDate').value=iso;
  $('singleDate').value=iso;
}

function toIso(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function parseIso(s){
  const [y,m,d]=String(s||'').split('-').map(Number);
  if(!y||!m||!d)return null;
  return new Date(y,m-1,d);
}

function esc(v){
  return String(v??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function status(id,msg,type='info'){
  $(id).innerHTML=
    msg
      ? `<div class="status ${type}">${esc(msg)}</div>`
      : '';
}

function apiCall(action,payload={}){
  return new Promise((resolve,reject)=>{
    if(!ROSTER4_API_URL || ROSTER4_API_URL.includes('PASTE_YOUR')){
      reject(new Error('請先在 config.js 填入排班 API 的 /exec 網址。'));
      return;
    }

    const requestId='r4_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const frame='f_'+requestId;

    const iframe=document.createElement('iframe');
    iframe.name=frame;
    iframe.style.display='none';

    const form=document.createElement('form');
    form.method='POST';
    form.action=ROSTER4_API_URL;
    form.target=frame;
    form.style.display='none';

    for(const [name,value] of Object.entries({
      requestId,
      action,
      payload:JSON.stringify(payload)
    })){
      const input=document.createElement('input');
      input.type='hidden';
      input.name=name;
      input.value=value;
      form.appendChild(input);
    }

    let finished=false;

    const cleanup=()=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      setTimeout(()=>{
        try{form.remove()}catch(e){}
        try{iframe.remove()}catch(e){}
      },50);
    };

    const onMessage=e=>{
      const d=e.data;
      if(!d||d.source!=='ksp-roster4-api'||d.requestId!==requestId)return;
      cleanup();

      if(d.response&&d.response.ok){
        resolve(d.response);
      }else{
        reject(new Error(d.response?.message||'排班 API 執行失敗'));
      }
    };

    window.addEventListener('message',onMessage);

    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error('排班 API 連線逾時。'));
    },API_TIMEOUT_MS);

    document.body.append(iframe,form);
    form.submit();
  });
}

async function checkApi(){
  const b=$('apiStatus');

  try{
    await apiCall('ping',{});
    b.className='badge ok';
    b.textContent='已連線';
  }catch(e){
    b.className='badge err';
    b.textContent='未連線';
  }
}

async function loadMonthInfo(){
  try{
    const r=await apiCall('monthInfo',{});
    currentMonth={year:r.year||null,month:r.month||null};

    $('monthStatus').textContent=
      r.prepared
        ? `${r.year}年${r.month}月`
        : '尚未建立';

    if(r.prepared){
      $('year').value=r.year;
      $('month').value=r.month;
      syncDateBounds();
    }
  }catch(e){
    $('monthStatus').textContent='讀取失敗';
  }
}

function syncDateBounds(){
  if(!currentMonth.year||!currentMonth.month)return;

  const y=currentMonth.year;
  const m=String(currentMonth.month).padStart(2,'0');
  const last=new Date(y,currentMonth.month,0).getDate();

  const min=`${y}-${m}-01`;
  const max=`${y}-${m}-${String(last).padStart(2,'0')}`;

  for(const id of ['startDate','singleDate']){
    $(id).min=min;
    $(id).max=max;

    if(!$(id).value||$(id).value<min||$(id).value>max){
      $(id).value=min;
    }
  }

  updateRangeText();
}

async function prepareMonth(){
  const year=Number($('year').value);
  const month=Number($('month').value);

  if(!window.confirm(`確定建立／切換為 ${year}年${month}月？\n月排班表 A:W 會清空，X:Y 保留。`)){
    return;
  }

  status('monthMessage','正在建立月份框架…','info');

  try{
    const r=await apiCall('prepareMonth',{
      year,
      month,
      confirmText:'PREPARE'
    });

    status('monthMessage',r.message,'ok');
    batchAssignments=[];
    renderBatchAssignments();
    await loadMonthInfo();
    await loadMonthRoster();

  }catch(e){
    status('monthMessage',e.message,'err');
  }
}

async function loadStaff(){
  try{
    const r=await apiCall('staff',{});
    staff=r.staff||[];

    if(staff.length<3){
      throw new Error('啟用人員少於3人。');
    }

    populateStaffSelects();

  }catch(e){
    status('fourDayMessage',e.message,'err');
  }
}

function personOptions(allowBlank=false){
  const first=
    allowBlank
      ? '<option value="">不排／清空</option>'
      : '<option value="">請選擇人員</option>';

  return first+
    staff.map(s=>
      `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.id)}）</option>`
    ).join('');
}

function populateStaffSelects(){
  const batchOld=$('batchPerson').value;
  const singleOld=$('singlePerson').value;

  $('batchPerson').innerHTML=personOptions(false);
  $('singlePerson').innerHTML=personOptions(true);

  if(batchOld&&[...$('batchPerson').options].some(o=>o.value===batchOld)){
    $('batchPerson').value=batchOld;
  }

  if(singleOld&&[...$('singlePerson').options].some(o=>o.value===singleOld)){
    $('singlePerson').value=singleOld;
  }
}

function updateRangeText(){
  const start=parseIso($('startDate').value);

  if(!start){
    $('rangeText').textContent='請選擇起始日期';
    return;
  }

  const end=new Date(start);
  end.setDate(end.getDate()+3);

  if(end.getMonth()!==start.getMonth()){
    $('rangeText').textContent='此起始日會跨月，請改用零星調整完成月底剩餘日期';
    return;
  }

  $('rangeText').textContent=`${toIso(start)} ～ ${toIso(end)}｜共4天`;
}

function addBatchAssignment(shift){
  const personId=$('batchPerson').value;

  if(!personId){
    status('fourDayMessage','請先選擇人員。','warn');
    return;
  }

  if(batchAssignments.some(x=>x.personId===personId)){
    status('fourDayMessage','同一位人員不可重複加入4天班。','warn');
    return;
  }

  if(batchAssignments.length>=4){
    status('fourDayMessage','每批最多4位人員。','warn');
    return;
  }

  const dayCount=batchAssignments.filter(x=>x.shift==='白班').length;
  const nightCount=batchAssignments.filter(x=>x.shift==='晚班').length;

  if(shift==='白班' && dayCount>=3){
    status('fourDayMessage','白班最多3人（第3人會列為機動白班）。','warn');
    return;
  }

  if(shift==='晚班' && nightCount>=2){
    status('fourDayMessage','晚班最多2人（第2人會列為機動晚班）。','warn');
    return;
  }

  batchAssignments.push({personId,shift});
  $('batchPerson').value='';
  renderBatchAssignments();
  status('fourDayMessage','','info');
}

function renderBatchAssignments(){
  const box=$('batchAssignments');

  if(!batchAssignments.length){
    box.innerHTML='<div class="status info">尚未加入人員。請逐一選人，再點白班或晚班。</div>';
    return;
  }

  box.innerHTML=batchAssignments.map((x,i)=>{
    const s=staff.find(v=>v.id===x.personId);
    return `
      <div class="assignment-item">
        <div class="assignment-main">
          <span class="shift-pill ${x.shift==='白班'?'day':'night'}">${esc(x.shift)}</span>
          <strong>${esc(s?.name||x.personId)}（${esc(x.personId)}）</strong>
        </div>
        <button class="remove-assignment" type="button" data-i="${i}">移除</button>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.remove-assignment').forEach(btn=>{
    btn.addEventListener('click',()=>{
      batchAssignments.splice(Number(btn.dataset.i),1);
      renderBatchAssignments();
    });
  });
}

function build4DayPayload(){
  const start=parseIso($('startDate').value);

  if(!start){
    throw new Error('請選擇4天排班起始日。');
  }

  const end=new Date(start);
  end.setDate(end.getDate()+3);

  if(end.getMonth()!==start.getMonth()){
    throw new Error('4天班不可跨月；月底剩餘日期請用「零星調整」。');
  }

  if(batchAssignments.length<3){
    throw new Error('至少要加入3位人員。');
  }

  const dayPeople=batchAssignments.filter(x=>x.shift==='白班');
  const nightPeople=batchAssignments.filter(x=>x.shift==='晚班');

  if(dayPeople.length<2){
    throw new Error('基本勤務至少需要2位白班人員。');
  }

  if(nightPeople.length<1){
    throw new Error('基本勤務至少需要1位晚班人員。');
  }

  if(batchAssignments.length>4){
    throw new Error('每批最多4位人員。');
  }

  const base={
    early1:dayPeople[0]?.personId||'',
    early2:dayPeople[1]?.personId||'',
    night1:nightPeople[0]?.personId||'',
    mobile1:'',
    mobileShift:''
  };

  if(batchAssignments.length===4){
    if(dayPeople.length===3 && nightPeople.length===1){
      base.mobile1=dayPeople[2].personId;
      base.mobileShift='白班';
    }else if(dayPeople.length===2 && nightPeople.length===2){
      base.mobile1=nightPeople[1].personId;
      base.mobileShift='晚班';
    }else{
      throw new Error('4人排班需為「3白1晚」或「2白2晚」。');
    }
  }

  const days=[];

  for(let i=0;i<4;i++){
    const d=new Date(start);
    d.setDate(d.getDate()+i);

    days.push({
      date:toIso(d).replaceAll('-','/'),
      early1:base.early1,
      early2:base.early2,
      night1:base.night1,
      mobile1:base.mobile1,
      mobileShift:base.mobileShift
    });
  }

  return {days};
}

async function save4Days(){
  let payload;

  try{
    payload=build4DayPayload();
  }catch(e){
    status('fourDayMessage',e.message,'warn');
    return;
  }

  const first=payload.days[0].date;
  const last=payload.days[3].date;

  if(!window.confirm(`確定把目前人員班別套用到 ${first} ～ ${last} 共4天？`)){
    return;
  }

  $('save4Btn').disabled=true;
  $('save4Btn').textContent='套用中…';

  try{
    const r=await apiCall('save4Days',payload);
    status('fourDayMessage',r.message,'ok');
    await loadMonthRoster();
  }catch(e){
    status('fourDayMessage',e.message,'err');
  }finally{
    $('save4Btn').disabled=false;
    $('save4Btn').textContent='套用此班表到4天';
  }
}

function toggleSingleMobileShift(){
  $('singleMobileShiftWrap')
    .classList
    .toggle(
      'hidden',
      $('singleSlot').value!=='mobile1'
    );
}

async function saveSingle(){
  const date=$('singleDate').value;
  const slot=$('singleSlot').value;
  const personId=$('singlePerson').value;
  const mobileShift=
    slot==='mobile1'
      ? $('singleMobileShift').value
      : '';

  if(!window.confirm('確定套用這筆零星調整？只會修改指定日期的指定位置。')){
    return;
  }

  $('saveSingleBtn').disabled=true;

  try{
    const r=await apiCall('saveSingle',{
      date,
      slot,
      personId,
      mobileShift
    });

    status('singleMessage',r.message,'ok');
    await loadMonthRoster();

  }catch(e){
    status('singleMessage',e.message,'err');
  }finally{
    $('saveSingleBtn').disabled=false;
  }
}

async function loadMonthRoster(){
  const box=$('monthRoster');
  box.innerHTML='<div class="status info">讀取中…</div>';

  try{
    const r=await apiCall('monthRoster',{});
    const rows=r.rows||[];

    if(!rows.length){
      box.innerHTML='<div class="status info">目前沒有月排班資料。</div>';
      return;
    }

    box.innerHTML=rows.map(x=>`
      <div class="month-item">
        <div class="month-head">
          <div>
            <div class="month-date">${esc(x.date)}｜${esc(x.weekday)}</div>
            <div class="day-sub">${esc(x.dayType)}${x.note?`｜${esc(x.note)}`:''}</div>
          </div>
          <strong class="month-check ${String(x.check).startsWith('OK')?'oktxt':'warntext'}">${esc(x.check||'未排')}</strong>
        </div>

        <div class="shift"><span>白班1</span><strong>${esc(x.early1||'—')}</strong></div>
        <div class="shift"><span>白班2</span><strong>${esc(x.early2||'—')}</strong></div>
        <div class="shift"><span>晚班1</span><strong>${esc(x.night1||'—')}</strong></div>
        ${x.mobile1?`<div class="shift"><span>機動${esc(x.mobileShift||'')}</span><strong>${esc(x.mobile1)}</strong></div>`:''}
      </div>
    `).join('');

  }catch(e){
    box.innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}
