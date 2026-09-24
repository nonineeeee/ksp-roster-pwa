
let staff=[];
let currentMonth={year:null,month:null};
let person4Days=[];

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
  $('startDate').addEventListener('change',()=>{
    updateRangeText();
    buildPerson4DayEditor();
  });
  $('batchPerson').addEventListener('change',buildPerson4DayEditor);
  $('allDayBtn').addEventListener('click',()=>setAll4('白班'));
  $('allNightBtn').addEventListener('click',()=>setAll4('晚班'));
  $('allOffBtn').addEventListener('click',()=>setAll4('不排'));
  $('savePerson4Btn').addEventListener('click',savePerson4Days);
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
    person4Days=[];
    buildPerson4DayEditor();
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

  buildPerson4DayEditor();
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
    $('rangeText').textContent='此起始日會跨月，月底剩餘日期請使用零星調整';
    return;
  }

  $('rangeText').textContent=
    `${toIso(start)} ～ ${toIso(end)}｜共4天`;
}


function buildPerson4DayEditor(){
  const start=
    parseIso(
      $('startDate').value
    );

  const personId=
    $('batchPerson').value;

  const box=
    $('person4DayList');

  person4Days=[];

  if(!start){
    box.innerHTML=
      '<div class="status info">請先選擇起始日期。</div>';
    return;
  }

  const end=
    new Date(start);

  end.setDate(
    end.getDate()+3
  );

  if(
    end.getMonth() !==
    start.getMonth()
  ){
    box.innerHTML=
      '<div class="status warn">4天不可跨月，月底剩餘日期請用零星調整。</div>';
    return;
  }

  if(!personId){
    box.innerHTML=
      '<div class="status info">請先選擇一位保全。</div>';
    return;
  }

  for(let i=0;i<4;i++){
    const d=
      new Date(start);

    d.setDate(
      d.getDate()+i
    );

    person4Days.push({
      date:
        toIso(d),
      shift:
        '不排'
    });
  }

  renderPerson4Days();
}


function renderPerson4Days(){
  const box=
    $('person4DayList');

  if(!person4Days.length){
    box.innerHTML=
      '<div class="status info">請選擇保全與起始日期。</div>';
    return;
  }

  box.innerHTML=
    person4Days.map(
      (x,i)=>`
        <div class="person4-item">
          <div class="person4-head">
            <div>
              <div class="person4-date">第${i+1}天｜${esc(x.date)}</div>
              <div class="person4-current">目前設定：${esc(x.shift)}</div>
            </div>
          </div>

          <div class="person4-shifts">
            <button
              type="button"
              data-i="${i}"
              data-shift="白班"
              class="${x.shift==='白班'?'active-day':''}"
            >白班</button>

            <button
              type="button"
              data-i="${i}"
              data-shift="晚班"
              class="${x.shift==='晚班'?'active-night':''}"
            >晚班</button>

            <button
              type="button"
              data-i="${i}"
              data-shift="不排"
              class="${x.shift==='不排'?'active-off':''}"
            >不排</button>
          </div>
        </div>
      `
    ).join('');

  box.querySelectorAll(
    '[data-shift]'
  ).forEach(btn=>{
    btn.addEventListener(
      'click',
      ()=>{
        const i=
          Number(
            btn.dataset.i
          );

        person4Days[i].shift=
          btn.dataset.shift;

        renderPerson4Days();
      }
    );
  });
}


function setAll4(
  shift
){
  if(!person4Days.length){
    buildPerson4DayEditor();
  }

  if(!person4Days.length){
    return;
  }

  person4Days=
    person4Days.map(
      x=>({
        ...x,
        shift:shift
      })
    );

  renderPerson4Days();
}


async function savePerson4Days(){
  const personId=
    $('batchPerson').value;

  if(!personId){
    status(
      'fourDayMessage',
      '請先選擇保全。',
      'warn'
    );
    return;
  }

  if(
    person4Days.length !== 4
  ){
    status(
      'fourDayMessage',
      '請先設定4天班表。',
      'warn'
    );
    return;
  }

  const staffInfo=
    staff.find(
      s=>
        s.id===personId
    );

  const summary=
    person4Days
      .map(
        x=>
          `${x.date} ${x.shift}`
      )
      .join('\n');

  if(
    !window.confirm(
      `確定更新 ${staffInfo?.name||personId}（${personId}）的4天班表？\n\n${summary}\n\n其他保全既有排班不會變動。`
    )
  ){
    return;
  }

  $('savePerson4Btn')
    .disabled=true;

  $('savePerson4Btn')
    .textContent=
    '更新中…';

  try{
    const r=
      await apiCall(
        'updatePerson4Days',
        {
          personId:
            personId,
          days:
            person4Days.map(
              x=>({
                date:
                  x.date.replaceAll(
                    '-',
                    '/'
                  ),
                shift:
                  x.shift
              })
            )
        }
      );

    status(
      'fourDayMessage',
      r.message,
      'ok'
    );

    await loadMonthRoster();

  }catch(e){
    status(
      'fourDayMessage',
      e.message,
      'err'
    );

  }finally{
    $('savePerson4Btn')
      .disabled=false;

    $('savePerson4Btn')
      .textContent=
      '更新此保全的4天班表';
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
