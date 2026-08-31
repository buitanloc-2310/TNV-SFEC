const ADMIN_EMAIL = 'skyfirst.ec@gmail.com';
const SESSION_DAYS = 7;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: 'Lỗi hệ thống. Vui lòng thử lại.' }, 500);
    }
  }
};

async function api(request, env, url) {
  const method = request.method.toUpperCase();
  if (url.pathname === '/api/status' && method === 'GET') {
    const admin = await env.DB.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').bind('admin').first();
    return json({ ok: true, setupRequired: !admin });
  }

  if (url.pathname === '/api/setup' && method === 'POST') {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').bind('admin').first();
    if (existing) return json({ ok: false, error: 'Hệ thống đã được thiết lập.' }, 409);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const fullName = clean(body.fullName, 120);
    const password = String(body.password || '');
    if (email !== ADMIN_EMAIL) return json({ ok: false, error: 'Email Quản trị viên không hợp lệ.' }, 403);
    if (!fullName) return json({ ok: false, error: 'Vui lòng nhập họ và tên.' }, 400);
    const passwordError = validatePassword(password);
    if (passwordError) return json({ ok: false, error: passwordError }, 400);
    const { hash, salt } = await hashPassword(password);
    await env.DB.prepare('INSERT INTO users(email,full_name,role,password_hash,salt,status) VALUES(?,?,?,?,?,?)')
      .bind(email, fullName, 'admin', hash, salt, 'active').run();
    return json({ ok: true });
  }

  if (url.pathname === '/api/login' && method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(email).first();
    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.salt, user.password_hash))) {
      return json({ ok: false, error: 'Email hoặc mật khẩu không đúng.' }, 401);
    }
    const token = randomToken(32);
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await env.DB.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').bind(token, user.id, expires).run();
    return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS) });
  }

  if (url.pathname === '/api/logout' && method === 'POST') {
    const token = getCookie(request, 'sfn_session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', -1) });
  }

  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: 'Phiên đăng nhập không hợp lệ.' }, 401);

  if (url.pathname === '/api/me' && method === 'GET') return json({ ok: true, user: publicUser(user) });

  if (url.pathname === '/api/dashboard' && method === 'GET') {
    const [registrations, tasks, minutes, certificates] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) c FROM registrations WHERE user_id=? AND status='approved'").bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) c FROM tasks WHERE user_id=? AND status!='done'").bind(user.id).first(),
      env.DB.prepare('SELECT COALESCE(SUM(minutes),0) m FROM contributions WHERE user_id=? AND verified_at IS NOT NULL').bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) c FROM certificates WHERE user_id=? AND status='valid'").bind(user.id).first()
    ]);
    return json({ ok:true, stats:{ activities:registrations.c||0, tasks:tasks.c||0, minutes:minutes.m||0, certificates:certificates.c||0 } });
  }

  if (url.pathname === '/api/opportunities' && method === 'GET') {
    const type = ['class','activity','event','training'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : null;
    const q = type
      ? env.DB.prepare("SELECT id,type,title,unit_name,description,start_at,end_at FROM opportunities WHERE status='open' AND type=? ORDER BY COALESCE(start_at,created_at) ASC").bind(type)
      : env.DB.prepare("SELECT id,type,title,unit_name,description,start_at,end_at FROM opportunities WHERE status='open' ORDER BY COALESCE(start_at,created_at) ASC");
    const { results } = await q.all();
    return json({ ok:true, items:results });
  }

  if (url.pathname === '/api/registrations' && method === 'POST') {
    const body = await readJson(request);
    const opportunityId = Number(body.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId < 1) return json({ok:false,error:'Hoạt động không hợp lệ.'},400);
    const opportunity = await env.DB.prepare("SELECT id FROM opportunities WHERE id=? AND status='open'").bind(opportunityId).first();
    if (!opportunity) return json({ok:false,error:'Nội dung đăng ký hiện không mở.'},404);
    try {
      await env.DB.prepare('INSERT INTO registrations(opportunity_id,user_id,note) VALUES(?,?,?)').bind(opportunityId,user.id,clean(body.note,1000)).run();
    } catch (e) {
      if (String(e).includes('UNIQUE')) return json({ok:false,error:'Bạn đã đăng ký nội dung này.'},409);
      throw e;
    }
    return json({ok:true});
  }

  if (url.pathname === '/api/tasks' && method === 'GET') {
    const {results} = await env.DB.prepare('SELECT id,title,description,due_at,status FROM tasks WHERE user_id=? ORDER BY CASE status WHEN \'doing\' THEN 0 WHEN \'todo\' THEN 1 ELSE 2 END, due_at ASC').bind(user.id).all();
    return json({ok:true,items:results});
  }

  if (url.pathname === '/api/certificates' && method === 'GET') {
    const {results} = await env.DB.prepare('SELECT code,title,issued_at,status FROM certificates WHERE user_id=? ORDER BY issued_at DESC').bind(user.id).all();
    return json({ok:true,items:results});
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return json({ok:false,error:'Bạn không có quyền thực hiện thao tác này.'},403);

    if (url.pathname === '/api/admin/users' && method === 'GET') {
      const {results} = await env.DB.prepare('SELECT id,email,full_name,role,status,created_at FROM users ORDER BY created_at DESC').all();
      return json({ok:true,items:results});
    }
    if (url.pathname === '/api/admin/users' && method === 'POST') {
      const body = await readJson(request);
      const email = normalizeEmail(body.email), fullName = clean(body.fullName,120), password=String(body.password||'');
      if (!email || !fullName) return json({ok:false,error:'Vui lòng nhập đầy đủ họ tên và email.'},400);
      const passwordError=validatePassword(password); if(passwordError) return json({ok:false,error:passwordError},400);
      const {hash,salt}=await hashPassword(password);
      try {
        await env.DB.prepare('INSERT INTO users(email,full_name,role,password_hash,salt,status) VALUES(?,?,?,?,?,?)').bind(email,fullName,'volunteer',hash,salt,'active').run();
      } catch(e){ if(String(e).includes('UNIQUE')) return json({ok:false,error:'Email này đã tồn tại.'},409); throw e; }
      return json({ok:true});
    }
    if (url.pathname === '/api/admin/opportunities' && method === 'POST') {
      const body=await readJson(request); const type=String(body.type||''); const title=clean(body.title,180);
      if(!['class','activity','event','training'].includes(type)||!title) return json({ok:false,error:'Loại hoặc tên nội dung không hợp lệ.'},400);
      await env.DB.prepare('INSERT INTO opportunities(type,title,unit_name,description,start_at,end_at,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
        .bind(type,title,clean(body.unitName,160),clean(body.description,1500),body.startAt||null,body.endAt||null,'open',user.id).run();
      return json({ok:true});
    }
  }

  return json({ ok:false, error:'Không tìm thấy chức năng.' },404);
}

async function requireUser(request, env){
  const token=getCookie(request,'sfn_session'); if(!token) return null;
  const row=await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>datetime('now') AND u.status='active' LIMIT 1`).bind(token).first();
  return row||null;
}
function publicUser(u){return {id:u.id,email:u.email,fullName:u.full_name,role:u.role,status:u.status}}
function normalizeEmail(v){return String(v||'').trim().toLowerCase()}
function clean(v,max){return String(v||'').trim().slice(0,max)}
function validatePassword(p){if(p.length<10)return 'Mật khẩu phải có ít nhất 10 ký tự.';if(!/[A-Z]/.test(p)||!/[a-z]/.test(p)||!/[0-9]/.test(p))return 'Mật khẩu cần có chữ hoa, chữ thường và số.';return ''}
async function readJson(request){try{return await request.json()}catch{return {}}}
function getCookie(request,name){const h=request.headers.get('Cookie')||'';for(const part of h.split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='))}return ''}
function sessionCookie(token,days){const maxAge=days<0?0:days*86400;return `sfn_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`}
function randomToken(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return b64(a)}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
async function hashPassword(password,saltB64){const salt=saltB64?Uint8Array.from(atob(saltB64),c=>c.charCodeAt(0)):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},key,256);return {hash:b64(new Uint8Array(bits)),salt:b64(salt)}}
async function verifyPassword(password,salt,expected){const x=await hashPassword(password,salt);return timingSafe(x.hash,expected)}
function timingSafe(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}})}
