
let staff=[];
let exceptions=[];

const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  initMonthOptions();
  initDate();
  bindEvents();
  checkApi();
  loadStaff();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
});

function bindEvents(){
  $('reloadStaffBtn').addEventListener('click',loadStaff);
  $('addExceptionBtn').addEventListener('click',()=>addException());
  $('previewBtn').addEventListener('click',previewRoster);
  $('generateBtn').addEventListener('click',generateRoster);
  $('loadCurrentBtn').addEventListener('click',loadCurrentRoster);
  $('year').addEventListener('change',syncExceptionDateBounds);
  $('month').addEventListener('change',syncExceptionDateBounds);
}

function initMonthOptions(){
  $('month').innerHTML=
    Array.from({length:12},(_,i)=>
      `<option value="${i+1}">${i+1}月</option>`
    ).join('');
}

function initDate(){
  const now=new Date();
  $('year').value=now.getFullYear();
  $('month').value=now.getMonth()+1;
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
  $(id).innerHTML=msg?`<div class="status ${type}">${esc(msg)}</div>`:'';
}

function apiCall(action,payload={}){
  return new Promise((resolve,reject)=>{
    if(!ROSTER_API_URL || ROSTER_API_URL.includes('PASTE_YOUR')){
      reject(new Error('請先在 config.js 填入排班 Apps Script 的 /exec 網址。'));
      return;
    }

    const requestId='r_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const frame='f_'+requestId;

    const iframe=document.createElement('iframe');
    iframe.name=frame;
    iframe.style.display='none';

    const form=document.createElement('form');
    form.method='POST';
    form.action=ROSTER_API_URL;
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

    let done=false;

    const cleanup=()=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      setTimeout(()=>{
        try{form.remove()}catch(e){}
        try{iframe.remove()}catch(e){}
      },50);
    };

    const onMessage=e=>{
      const d=e.data;
      if(!d||d.source!=='ksp-roster-api'||d.requestId!==requestId)return;

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

async function loadStaff(){
  status('staffMessage','正在讀取人員資料…','info');

  try{
    const r=await apiCall('staff',{});
    staff=r.staff||[];

    if(staff.length<3){
      throw new Error('啟用人員少於3人，無法建立基本排班。');
    }

    populateMainStaffSelects();
    refreshExceptionPersonSelects();

    status('staffMessage',`已讀取 ${staff.length} 位啟用人員。`,'ok');
  }catch(e){
    status('staffMessage',e.message,'err');
  }
}

function staffOptions(allowBlank=false){
  const blank=allowBlank?'<option value="">不設定</option>':'<option value="">請選擇</option>';

  return blank+staff.map(s=>
    `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.id)}）</option>`
  ).join('');
}

function populateMainStaffSelects(){
  const old={
    early1:$('early1').value,
    early2:$('early2').value,
    night1:$('night1').value,
    mobile1:$('mobile1').value
  };

  $('early1').innerHTML=staffOptions(false);
  $('early2').innerHTML=staffOptions(false);
  $('night1').innerHTML=staffOptions(false);
  $('mobile1').innerHTML=staffOptions(true);

  for(const [id,val] of Object.entries(old)){
    if(val && [...$(id).options].some(o=>o.value===val)){
      $(id).value=val;
    }
  }
}

function addException(data={}){
  const tpl=$('exceptionTemplate').content.cloneNode(true);
  const item=tpl.querySelector('.exception-item');

  const dateInput=item.querySelector('.ex-date');
  const slotSelect=item.querySelector('.ex-slot');
  const personSelect=item.querySelector('.ex-person');

  personSelect.innerHTML=staffOptions(false);

  const bounds=getMonthBounds();
  dateInput.min=bounds.min;
  dateInput.max=bounds.max;
  dateInput.value=data.date||bounds.min;
  slotSelect.value=data.slot||'early1';
  personSelect.value=data.personId||'';

  item.querySelector('.remove-ex').addEventListener('click',()=>{
    item.remove();
  });

  $('exceptionList').appendChild(item);
}

function refreshExceptionPersonSelects(){
  document.querySelectorAll('.ex-person').forEach(sel=>{
    const old=sel.value;
    sel.innerHTML=staffOptions(false);
    if(old && [...sel.options].some(o=>o.value===old)){
      sel.value=old;
    }
  });
}

function getMonthBounds(){
  const year=Number($('year').value);
  const month=Number($('month').value);
  const mm=String(month).padStart(2,'0');
  const lastDay=new Date(year,month,0).getDate();

  return {
    min:`${year}-${mm}-01`,
    max:`${year}-${mm}-${String(lastDay).padStart(2,'0')}`
  };
}

function syncExceptionDateBounds(){
  const b=getMonthBounds();

  document.querySelectorAll('.ex-date').forEach(inp=>{
    inp.min=b.min;
    inp.max=b.max;

    if(!inp.value || inp.value<b.min || inp.value>b.max){
      inp.value=b.min;
    }
  });
}

function collectPayload(){
  const year=Number($('year').value);
  const month=Number($('month').value);

  const fixed={
    early1:$('early1').value,
    early2:$('early2').value,
    night1:$('night1').value,
    mobile1:$('mobile1').value
  };

  const exceptions=[...document.querySelectorAll('.exception-item')].map(item=>{
    const date=item.querySelector('.ex-date').value.replaceAll('-','/');
    const slot=item.querySelector('.ex-slot').value;
    const personId=item.querySelector('.ex-person').value;

    return {date,slot,personId};
  }).filter(x=>x.date&&x.slot&&x.personId);

  return {year,month,fixed,exceptions};
}

async function previewRoster(){
  status('generateMessage','正在產生預覽…','info');

  try{
    const r=await apiCall('preview',collectPayload());
    renderPreview(r);
    status('generateMessage','預覽完成，確認無誤後即可一鍵寫入月排班表。','ok');
  }catch(e){
    status('generateMessage',e.message,'err');
  }
}

async function generateRoster(){
  if(!window.confirm('確定要依目前固定班底與例外設定，覆蓋本月「月排班表」嗎？')){
    return;
  }

  $('generateBtn').disabled=true;
  $('generateBtn').textContent='一鍵排班中…';
  status('generateMessage','正在寫入 Google 試算表…','info');

  try{
    const r=await apiCall('generate',collectPayload());

    status(
      'generateMessage',
      `${r.message}\n例外調整：${r.exceptionCount||0} 筆`,
      'ok'
    );

    await loadCurrentRoster();
  }catch(e){
    status('generateMessage',e.message,'err');
  }finally{
    $('generateBtn').disabled=false;
    $('generateBtn').textContent='一鍵產生本月排班';
  }
}

function renderPreview(r){
  $('previewSection').classList.remove('hidden');
  $('previewCount').textContent=`${r.totalDays||0}天`;

  const warnings=r.warnings||[];

  $('warningList').innerHTML=warnings.map(w=>
    `<div class="warning-item ${esc(w.level)}">${esc(w.date)}｜${esc(w.message)}</div>`
  ).join('');

  $('previewList').innerHTML=(r.rows||[]).map(renderPreviewItem).join('');
}

function renderPreviewItem(r){
  const cls=String(r.check||'').startsWith('OK')?'check-ok':'check-warn';

  return `
    <div class="preview-item">
      <div class="preview-head">
        <div>
          <div class="preview-date">${esc(r.date)}｜${esc(r.weekday)}</div>
          <div class="preview-type">${esc(r.dayType)}</div>
        </div>
        <strong class="${cls}">${esc(r.check)}</strong>
      </div>

      <div class="shift-line"><span>早班1</span><strong>${esc(r.early1Name)}（${esc(r.early1Id)}）</strong></div>
      <div class="shift-line"><span>早班2</span><strong>${esc(r.early2Name)}（${esc(r.early2Id)}）</strong></div>
      <div class="shift-line"><span>晚班1</span><strong>${esc(r.night1Name)}（${esc(r.night1Id)}）</strong></div>
      ${r.mobile1Id?`<div class="shift-line"><span>機動</span><strong>${esc(r.mobile1Name)}（${esc(r.mobile1Id)}）</strong></div>`:''}
      ${r.note?`<div class="preview-type">${esc(r.note)}</div>`:''}
    </div>
  `;
}

async function loadCurrentRoster(){
  $('currentList').innerHTML='<div class="status info">讀取中…</div>';

  try{
    const r=await apiCall('currentMonth',{});

    if(!(r.rows||[]).length){
      $('currentList').innerHTML='<div class="status info">目前月排班表沒有資料。</div>';
      return;
    }

    $('currentList').innerHTML=r.rows.map(x=>`
      <div class="preview-item">
        <div class="preview-head">
          <div>
            <div class="preview-date">${esc(x.date)}｜${esc(x.weekday)}</div>
            <div class="preview-type">${esc(x.dayType)}</div>
          </div>
          <strong class="${String(x.check).startsWith('OK')?'check-ok':'check-warn'}">${esc(x.check)}</strong>
        </div>
        <div class="shift-line"><span>早班1</span><strong>${esc(x.early1)}</strong></div>
        <div class="shift-line"><span>早班2</span><strong>${esc(x.early2)}</strong></div>
        <div class="shift-line"><span>晚班1</span><strong>${esc(x.night1)}</strong></div>
        ${x.mobile1?`<div class="shift-line"><span>機動</span><strong>${esc(x.mobile1)}</strong></div>`:''}
        ${x.note?`<div class="preview-type">${esc(x.note)}</div>`:''}
      </div>
    `).join('');
  }catch(e){
    $('currentList').innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}
