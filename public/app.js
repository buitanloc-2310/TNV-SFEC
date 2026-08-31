const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
let currentUser=null, currentType='activity';
const labels={class:'Các lớp học',activity:'Hoạt động',event:'Sự kiện',training:'Đào tạo / Training'};

async function api(path,opts={}){const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||'Không thể xử lý yêu cầu.');return data}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),3000)}
function showAuth(){ $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden') }
function showApp(){ $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden') }
function roleName(role){return role==='admin'?'Quản trị viên':'Tình nguyện viên'}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

async function init(){
  try{const status=await api('/api/status');$('#showSetup').classList.toggle('hidden',!status.setupRequired)}catch(e){toast(e.message)}
  try{const me=await api('/api/me');currentUser=me.user;await enterApp()}catch{showAuth()}
}
async function enterApp(){showApp();$('#userName').textContent=currentUser.fullName;$('#userRole').textContent=roleName(currentUser.role);$('#adminMenuBtn').classList.toggle('hidden',currentUser.role!=='admin');await Promise.all([loadDashboard(),loadOpportunities(),loadTasks(),loadCertificates()])}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#loginPassword').value})});currentUser=d.user;$('#loginPassword').value='';await enterApp()}catch(err){toast(err.message)}});
$('#showSetup').addEventListener('click',()=>{$('#loginPane').classList.add('hidden');$('#setupPane').classList.remove('hidden')});
$('#backLogin').addEventListener('click',()=>{$('#setupPane').classList.add('hidden');$('#loginPane').classList.remove('hidden')});
$('#setupForm').addEventListener('submit',async e=>{e.preventDefault();const p=$('#setupPassword').value;if(p!==$('#setupPassword2').value)return toast('Hai mật khẩu chưa trùng khớp.');try{await api('/api/setup',{method:'POST',body:JSON.stringify({fullName:$('#setupName').value,email:$('#setupEmail').value,password:p})});toast('Khởi tạo thành công. Hãy đăng nhập.');$('#setupPane').classList.add('hidden');$('#loginPane').classList.remove('hidden');$('#showSetup').classList.add('hidden');$('#loginEmail').value='skyfirst.ec@gmail.com'}catch(err){toast(err.message)}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}finally{currentUser=null;showAuth()}});

$('.dropdown-toggle').addEventListener('click',()=>$('#registerMenu').classList.toggle('show'));
$$('.subnav button,.quick button,.open-register').forEach(b=>b.addEventListener('click',()=>openRegister(b.dataset.type)));
$$('.modal-close').forEach(b=>b.addEventListener('click',()=>b.closest('.modal').classList.remove('show')));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show')}));
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#adminMenuBtn').addEventListener('click',()=>$('#adminModal').classList.add('show'));

async function loadDashboard(){try{const d=await api('/api/dashboard');$('#statActivities').textContent=d.stats.activities;$('#statTasks').textContent=d.stats.tasks;$('#statHours').textContent=(d.stats.minutes/60).toLocaleString('vi-VN',{maximumFractionDigits:1})+' giờ';$('#statCertificates').textContent=d.stats.certificates}catch(e){toast(e.message)}}
async function loadOpportunities(){try{const d=await api('/api/opportunities');const box=$('#opportunityList');if(!d.items.length){box.innerHTML='<div class="empty">Chưa có nội dung đang mở.</div>';return}box.innerHTML=d.items.map(x=>`<article class="op-card"><span class="badge">${esc(labels[x.type]||x.type).toUpperCase()}</span><h3>${esc(x.title)}</h3><p>${esc(x.unit_name||'Sky First Network')}</p><p>${esc(x.description||'')}</p><button class="btn secondary" data-opp="${x.id}" data-type="${x.type}">Đăng ký</button></article>`).join('');box.querySelectorAll('[data-opp]').forEach(b=>b.addEventListener('click',()=>openRegister(b.dataset.type,Number(b.dataset.opp))))}catch(e){toast(e.message)}}
async function loadTasks(){try{const d=await api('/api/tasks');const box=$('#taskList');box.innerHTML=d.items.length?d.items.map(x=>`<div class="list-item"><b>${esc(x.title)}</b><small>Trạng thái: ${esc(x.status)}${x.due_at?' · Hạn: '+esc(x.due_at):''}</small></div>`).join(''):'<div class="empty">Chưa có nhiệm vụ được giao.</div>'}catch(e){toast(e.message)}}
async function loadCertificates(){try{const d=await api('/api/certificates');const box=$('#certificateList');box.innerHTML=d.items.length?d.items.map(x=>`<div class="list-item"><b>${esc(x.title)}</b><small>Mã: ${esc(x.code)} · Ngày cấp: ${esc(x.issued_at)} · ${esc(x.status)}</small></div>`).join(''):'<div class="empty">Chưa có Giấy chứng nhận.</div>'}catch(e){toast(e.message)}}
$('#refreshOpp').addEventListener('click',loadOpportunities);

async function openRegister(type,selectedId=null){currentType=type;$('#registerTitle').textContent='Đăng ký '+labels[type];$('#registerDesc').textContent='Chọn nội dung đang mở trong hệ thống Sky First.';const select=$('#registerOpportunity');select.innerHTML='<option value="">Đang tải...</option>';$('#registerModal').classList.add('show');try{const d=await api('/api/opportunities?type='+encodeURIComponent(type));select.innerHTML=d.items.length?'<option value="">— Chọn nội dung —</option>'+d.items.map(x=>`<option value="${x.id}">${esc(x.title)}${x.unit_name?' — '+esc(x.unit_name):''}</option>`).join(''):'<option value="">Hiện chưa có nội dung mở đăng ký</option>';if(selectedId)select.value=String(selectedId)}catch(e){select.innerHTML='<option value="">Không tải được dữ liệu</option>';toast(e.message)}}
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const id=Number($('#registerOpportunity').value);if(!id)return toast('Vui lòng chọn nội dung đăng ký.');try{await api('/api/registrations',{method:'POST',body:JSON.stringify({opportunityId:id,note:$('#registerNote').value})});toast('Đã gửi đăng ký.');$('#registerModal').classList.remove('show');$('#registerNote').value='';await loadDashboard()}catch(err){toast(err.message)}});

$('#createUserForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/users',{method:'POST',body:JSON.stringify({fullName:$('#newUserName').value,email:$('#newUserEmail').value,password:$('#newUserPassword').value})});toast('Đã cấp tài khoản TNV.');e.target.reset()}catch(err){toast(err.message)}});
$('#createOpportunityForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/opportunities',{method:'POST',body:JSON.stringify({type:$('#newOppType').value,title:$('#newOppTitle').value,unitName:$('#newOppUnit').value,description:$('#newOppDescription').value})});toast('Đã mở nội dung đăng ký.');e.target.reset();await loadOpportunities()}catch(err){toast(err.message)}});

init();
