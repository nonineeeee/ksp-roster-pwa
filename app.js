
let staff=[];
let currentMonth={year:null,month:null};

const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  initMonthOptions();
  initDefaultDates();
  bindEvents();
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
  $('load4Btn').addEventListener('click',load4Days);
  $('save4Btn').addEventListener('click',save4Days);
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

    populateSinglePerson();
    refresh4DayPersonSelects();

  }catch(e){
    status('fourDayMessage',e.message,'err');
  }
}

function personOptions(allowBlank=false){
  const first=
    allowBlank
      ? '<option value="">不排／清空</option>'
      : '<option value="">請選擇</option>';

  return first+
    staff.map(s=>
      `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.id)}）</option>`
    ).join('');
}

function populateSinglePerson(){
  const old=$('singlePerson').value;
  $('singlePerson').innerHTML=personOptions(true);

  if(old&&[...$('singlePerson').options].some(o=>o.value===old)){
    $('singlePerson').value=old;
  }
}

function refresh4DayPersonSelects(){
  document.querySelectorAll('.day-person').forEach(sel=>{
    const old=sel.value;
    const allowBlank=sel.dataset.slot==='mobile1';
    sel.innerHTML=personOptions(allowBlank);

    if(old&&[...sel.options].some(o=>o.value===old)){
      sel.value=old;
    }
  });
}

async function load4Days(){
  status('fourDayMessage','正在載入4天排班…','info');

  try{
    const r=await apiCall('load4Days',{
      startDate:$('startDate').value
    });

    render4Days(r.days||[]);
    status('fourDayMessage','已載入，可直接修改4天後儲存。','ok');

  }catch(e){
    $('fourDayList').innerHTML='';
    $('save4Btn').classList.add('hidden');
    status('fourDayMessage',e.message,'err');
  }
}

function render4Days(days){
  const box=$('fourDayList');

  box.innerHTML=days.map((d,i)=>`
    <div class="day-card" data-date="${esc(d.date)}">
      <div class="day-title">第${i+1}天｜${esc(d.date)}</div>
      <div class="day-sub">${esc(d.weekday)}｜${esc(d.dayType)}</div>

      <div class="day-grid">
        <div>
          <label>早班1</label>
          <select class="day-person" data-slot="early1" data-current="${esc(d.early1Id)}"></select>
        </div>

        <div>
          <label>早班2</label>
          <select class="day-person" data-slot="early2" data-current="${esc(d.early2Id)}"></select>
        </div>

        <div>
          <label>晚班1</label>
          <select class="day-person" data-slot="night1" data-current="${esc(d.night1Id)}"></select>
        </div>

        <div>
          <label>機動班1</label>
          <select class="day-person" data-slot="mobile1" data-current="${esc(d.mobile1Id)}"></select>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.day-person').forEach(sel=>{
    const allowBlank=sel.dataset.slot==='mobile1';
    sel.innerHTML=personOptions(allowBlank);
    const current=sel.dataset.current;

    if(current&&[...sel.options].some(o=>o.value===current)){
      sel.value=current;
    }
  });

  $('save4Btn').classList.remove('hidden');
}

async function save4Days(){
  const cards=[...document.querySelectorAll('.day-card')];

  if(cards.length!==4){
    status('fourDayMessage','請先載入4天排班。','warn');
    return;
  }

  const days=cards.map(card=>{
    const get=slot=>card.querySelector(`[data-slot="${slot}"]`).value;

    return {
      date:card.dataset.date,
      early1:get('early1'),
      early2:get('early2'),
      night1:get('night1'),
      mobile1:get('mobile1')
    };
  });

  if(!window.confirm(`確定儲存 ${days[0].date} ～ ${days[3].date} 共4天排班？`)){
    return;
  }

  $('save4Btn').disabled=true;
  $('save4Btn').textContent='儲存中…';

  try{
    const r=await apiCall('save4Days',{days});
    status('fourDayMessage',r.message,'ok');
    await loadMonthRoster();
  }catch(e){
    status('fourDayMessage',e.message,'err');
  }finally{
    $('save4Btn').disabled=false;
    $('save4Btn').textContent='儲存這4天排班';
  }
}

async function saveSingle(){
  const date=$('singleDate').value;
  const slot=$('singleSlot').value;
  const personId=$('singlePerson').value;

  if(!window.confirm('確定套用這筆零散排班？只會修改指定日期的指定席次。')){
    return;
  }

  $('saveSingleBtn').disabled=true;

  try{
    const r=await apiCall('saveSingle',{
      date,
      slot,
      personId
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

        <div class="shift"><span>早班1</span><strong>${esc(x.early1||'—')}</strong></div>
        <div class="shift"><span>早班2</span><strong>${esc(x.early2||'—')}</strong></div>
        <div class="shift"><span>晚班1</span><strong>${esc(x.night1||'—')}</strong></div>
        ${x.mobile1?`<div class="shift"><span>機動</span><strong>${esc(x.mobile1)}</strong></div>`:''}
      </div>
    `).join('');

  }catch(e){
    box.innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}
