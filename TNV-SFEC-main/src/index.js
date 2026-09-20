const ADMIN_EMAIL = 'skyfirst.ec@gmail.com';
const APPLICATION_RECEIVER_EMAIL = 'nhansu.sfn@gmail.com';
const DEFAULT_MAIL_FROM = 'Sky First · Tình nguyện viên <tnv@skyfirst.io.vn>';
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000; // Giữ nguyên để tương thích Cloudflare và dữ liệu hiện hữu.
const SFEC_CODE = 'SFEC';
const SFEC_NAME = 'Câu lạc bộ Tiếng Anh The Sky First (SFEC)';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('SFN TNV Portal Error:', error);
      return json({ ok:false, error:'Lỗi hệ thống.', details:String(error?.message || error) }, 500);
    }
  }
};

async function api(request, env, url) {
  await ensureSchema(env);
  const method = request.method.toUpperCase();

  if (url.pathname === '/api/status' && method === 'GET') {
    const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
    return json({ ok:true, setupRequired:!admin });
  }

  if (url.pathname === '/api/public/units' && method === 'GET') {
    const {results} = await env.DB.prepare("SELECT id,name,code,description FROM units WHERE status='active' ORDER BY name").all();
    return json({ok:true,items:results||[]});
  }

  if (url.pathname === '/api/opportunities' && method === 'GET') {
    const type = ['class','activity','event','training'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : null;
    const sql = `SELECT o.id,o.type,o.title,o.description,o.start_at,o.end_at,o.registration_deadline,o.status,o.unit_id,u.name unit_name,u.code unit_code
      FROM opportunities o LEFT JOIN units u ON u.id=o.unit_id WHERE o.status='open' ${type?'AND o.type=?':''}
      ORDER BY COALESCE(o.start_at,o.created_at) ASC`;
    const q = type ? env.DB.prepare(sql).bind(type) : env.DB.prepare(sql);
    const {results} = await q.all();
    return json({ok:true,items:results||[]});
  }

  if (url.pathname === '/api/public/applications/lookup' && method === 'GET') {
    const code=clean(url.searchParams.get('code'),80).toUpperCase();
    const email=normalizeEmail(url.searchParams.get('email'));
    if(!code || !isValidEmail(email)) return json({ok:false,error:'Vui lòng nhập đúng mã hồ sơ và email đã đăng ký.'},400);
    const x=await env.DB.prepare(`SELECT a.application_code,a.full_name,a.status,a.created_at,o.title opportunity_title,u.name unit_name FROM volunteer_applications a JOIN opportunities o ON o.id=a.opportunity_id LEFT JOIN units u ON u.id=a.unit_id WHERE UPPER(a.application_code)=? AND LOWER(a.email)=? LIMIT 1`).bind(code,email).first();
    if(!x) return json({ok:false,error:'Không tìm thấy hồ sơ phù hợp với mã và email này.'},404);
    return json({ok:true,application:{applicationCode:x.application_code,fullName:x.full_name,status:x.status,createdAt:x.created_at,opportunityTitle:x.opportunity_title,unitName:x.unit_name}});
  }

  if (url.pathname === '/api/public/applications' && method === 'POST') {
    const contentType=request.headers.get('Content-Type')||'';
    let b={}, profilePhoto=null;
    if(contentType.includes('multipart/form-data')){
      const fd=await request.formData();
      b=Object.fromEntries([...fd.entries()].filter(([k,v])=>!(v instanceof File)));
      const f=fd.get('profilePhoto');
      if(f instanceof File && f.size) profilePhoto=f;
    }else{
      b=await readJson(request);
    }
    const opportunityId = Number(b.opportunityId);
    const fullName = clean(b.fullName,120), email=normalizeEmail(b.email), phone=clean(b.phone,40), school=clean(b.schoolClassUnit,180);
    if (!Number.isInteger(opportunityId)||opportunityId<1) return json({ok:false,error:'Cơ hội đăng ký không hợp lệ.'},400);
    if (!fullName || !isValidEmail(email) || !phone || !school) return json({ok:false,error:'Họ tên, email, số điện thoại và trường/lớp/đơn vị là thông tin bắt buộc.'},400);
    if(!profilePhoto) return json({ok:false,error:'Vui lòng tải lên ảnh cá nhân để hoàn tất đăng ký.'},400);
    const photoError=validateProfilePhoto(profilePhoto); if(photoError) return json({ok:false,error:photoError},400);
    const opp = await env.DB.prepare(`SELECT o.id,o.type,o.title,o.unit_id,o.start_at,o.end_at,o.registration_deadline,u.name unit_name,u.notification_email FROM opportunities o LEFT JOIN units u ON u.id=o.unit_id WHERE o.id=? AND o.status='open' LIMIT 1`).bind(opportunityId).first();
    if (!opp) return json({ok:false,error:'Cơ hội này hiện không mở đăng ký.'},404);
    if (opp.registration_deadline && Date.parse(opp.registration_deadline) < Date.now()) return json({ok:false,error:'Đã hết thời hạn đăng ký.'},409);
    if(!env.FILES) return json({ok:false,error:'Kho lưu trữ ảnh TNV chưa được cấu hình (R2 binding FILES).'},503);
    const code = await newApplicationCode(env);
    const photoToken=randomToken(24), photoExt=imageExtension(profilePhoto.type), photoKey=`applications/${code}/profile-${crypto.randomUUID()}.${photoExt}`;
    await env.FILES.put(photoKey,profilePhoto.stream(),{httpMetadata:{contentType:profilePhoto.type},customMetadata:{applicationCode:code,kind:'profile-photo'}});
    try{
      await env.DB.prepare(`INSERT INTO volunteer_applications(application_code,opportunity_id,unit_id,full_name,date_of_birth,email,phone,school_class_unit,experience,motivation,note,profile_photo_key,profile_photo_token,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'received')`)
        .bind(code,opp.id,opp.unit_id||null,fullName,nullableText(b.dateOfBirth),email,phone,school,clean(b.experience,2000)||null,clean(b.motivation,2000)||null,clean(b.note,1000)||null,photoKey,photoToken).run();
    }catch(e){await env.FILES.delete(photoKey).catch(()=>{});throw e;}
    await sendApplicationEmails(env,{code,opportunity:opp,fullName,email,phone,school,profilePhotoKey:photoKey,profilePhotoToken:photoToken});
    return json({ok:true,applicationCode:code,message:`Hồ sơ đã được tiếp nhận. Mã hồ sơ: ${code}`},201);
  }

  const photoMatch=url.pathname.match(/^\/api\/public\/application-photo\/([^/]+)$/);
  if(photoMatch && method==='GET'){
    const code=decodeURIComponent(photoMatch[1]), token=clean(url.searchParams.get('token'),160);
    const a=await env.DB.prepare('SELECT profile_photo_key,profile_photo_token FROM volunteer_applications WHERE application_code=? LIMIT 1').bind(code).first();
    if(!a?.profile_photo_key || !token || token!==a.profile_photo_token) return new Response('Not found',{status:404});
    const obj=await env.FILES.get(a.profile_photo_key); if(!obj) return new Response('Not found',{status:404});
    const h=new Headers(); obj.writeHttpMetadata(h); h.set('Cache-Control','private, max-age=86400'); h.set('X-Content-Type-Options','nosniff');
    return new Response(obj.body,{headers:h});
  }

  // Tra cứu GCN công khai. Nếu Cổng CTT trung tâm được cấu hình, chuyển truy vấn tới CTT; không gắn GCN vào tài khoản TNV.
  if (url.pathname === '/api/public/certificates/lookup' && method === 'GET') {
    const code = clean(url.searchParams.get('code'),120);
    if (!code) return json({ok:false,error:'Vui lòng nhập mã Giấy chứng nhận.'},400,{'Access-Control-Allow-Origin':'*','Vary':'Origin'});
    if (env.CERTIFICATE_LOOKUP_URL) {
      const target = new URL(env.CERTIFICATE_LOOKUP_URL); target.searchParams.set('code',code);
      const r = await fetch(target.toString(),{headers:{Accept:'application/json'}});
      const data = await r.json().catch(()=>({}));
      return json(data,r.status,{'Access-Control-Allow-Origin':'*','Vary':'Origin'});
    }
    // Tương thích dữ liệu GCN cũ nếu CTT chưa được nối. Chỉ trả thông tin xác minh tối thiểu.
    const c = await env.DB.prepare(`SELECT code,title,issued_at,status FROM certificates WHERE code=? LIMIT 1`).bind(code).first();
    if (!c) return json({ok:false,error:'Không tìm thấy Giấy chứng nhận với mã này.'},404,{'Access-Control-Allow-Origin':'*','Vary':'Origin'});
    return json({ok:true,certificate:{code:c.code,title:c.title,issuedAt:c.issued_at,status:c.status}},200,{'Access-Control-Allow-Origin':'*','Vary':'Origin'});
  }

  if (url.pathname === '/api/setup' && method === 'POST') {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
    if (existing) return json({ok:false,error:'Hệ thống đã được thiết lập.'},409);
    const b=await readJson(request), email=normalizeEmail(b.email), fullName=clean(b.fullName,120), password=String(b.password||'');
    if (email!==ADMIN_EMAIL) return json({ok:false,error:'Email Quản trị viên không hợp lệ.'},403);
    if (!fullName) return json({ok:false,error:'Vui lòng nhập họ và tên.'},400);
    const pe=validatePassword(password); if(pe) return json({ok:false,error:pe},400);
    const {hash,salt}=await hashPassword(password);
    await env.DB.prepare(`INSERT INTO users(email,full_name,role,password_hash,salt,status,admin_scope) VALUES(?,?,'admin',?,?,'active','system')`).bind(email,fullName,hash,salt).run();
    return json({ok:true,message:'Khởi tạo hệ thống thành công.'});
  }

  if (url.pathname === '/api/login' && method === 'POST') {
    const b=await readJson(request), email=normalizeEmail(b.email), password=String(b.password||'');
    const u=await env.DB.prepare('SELECT * FROM users WHERE email=? LIMIT 1').bind(email).first();
    if(!u||u.status!=='active'||!u.salt||!(await verifyPassword(password,u.salt,u.password_hash))) return json({ok:false,error:'Email hoặc mật khẩu không đúng.'},401);
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(new Date().toISOString()).run();
    const token=randomToken(32), tokenHash=await hashSessionToken(token), expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
    await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(tokenHash,u.id,expires).run();
    return json({ok:true,user:publicUser(u)},200,{'Set-Cookie':sessionCookie(token,SESSION_DAYS)});
  }

  if (url.pathname === '/api/logout' && method === 'POST') {
    const token=getCookie(request,'sfn_session'); if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hashSessionToken(token)).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie('',-1)});
  }

  const user=await requireUser(request,env);
  if(!user) return json({ok:false,error:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'},401);
  if(url.pathname==='/api/me'&&method==='GET') return json({ok:true,user:publicUser(user)});

  if(url.pathname==='/api/profile'&&method==='GET') {
    const p=await env.DB.prepare(`SELECT p.*,u.name unit_name FROM volunteer_profiles p LEFT JOIN units u ON u.id=p.unit_id WHERE p.user_id=? LIMIT 1`).bind(user.id).first()||{};
    const fields=[p.phone,p.date_of_birth,p.school_class_unit,p.bio,p.joined_at];
    return json({ok:true,profile:p,completion:Math.round(fields.filter(Boolean).length/fields.length*100)});
  }
  if(url.pathname==='/api/profile'&&method==='PATCH') {
    const b=await readJson(request); const phone=clean(b.phone,40), dob=nullableText(b.dateOfBirth), school=clean(b.schoolClassUnit,180), bio=clean(b.bio,2000);
    await env.DB.prepare(`INSERT INTO volunteer_profiles(user_id,phone,date_of_birth,school_class_unit,bio,joined_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,date_of_birth=excluded.date_of_birth,school_class_unit=excluded.school_class_unit,bio=excluded.bio,updated_at=CURRENT_TIMESTAMP`).bind(user.id,phone||null,dob,school||null,bio||null).run();
    return json({ok:true});
  }
  if(url.pathname==='/api/my-activities'&&method==='GET') {
    const {results}=await env.DB.prepare(`SELECT r.status registration_status,o.title,o.type,o.start_at,o.end_at,u.name unit_name FROM registrations r JOIN opportunities o ON o.id=r.opportunity_id LEFT JOIN units u ON u.id=o.unit_id WHERE r.user_id=? ORDER BY COALESCE(o.start_at,r.created_at) DESC`).bind(user.id).all();
    return json({ok:true,items:results||[]});
  }

  if(url.pathname==='/api/dashboard'&&method==='GET') {
    const a=await env.DB.prepare("SELECT COUNT(*) total FROM registrations WHERE user_id=? AND status='approved'").bind(user.id).first();
    const t=await env.DB.prepare("SELECT COUNT(*) total FROM tasks WHERE user_id=? AND status NOT IN ('done','cancelled')").bind(user.id).first();
    return json({ok:true,stats:{activities:Number(a?.total||0),tasks:Number(t?.total||0)}});
  }

  if(url.pathname==='/api/tasks'&&method==='GET') {
    const {results}=await env.DB.prepare(`SELECT id,opportunity_id,title,description,due_at,status,created_at FROM tasks WHERE user_id=? ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,due_at ASC`).bind(user.id).all();
    return json({ok:true,items:results||[]});
  }

  if(url.pathname.startsWith('/api/admin/')) {
    if(user.role!=='admin') return json({ok:false,error:'Bạn không có quyền thực hiện thao tác này.'},403);
    const systemAdmin=(user.admin_scope||'system')==='system', scopedUnitId=user.unit_id?Number(user.unit_id):null;
    const scope=(alias='')=>systemAdmin?{sql:'',bind:[]}:{sql:`${alias?' AND '+alias+'.':' AND '}unit_id=?`,bind:[scopedUnitId]};
    if(url.pathname==='/api/admin/dashboard'&&method==='GET'){
      const q=async(sql,bind=[])=>await env.DB.prepare(sql).bind(...bind).first();
      const os=systemAdmin?await q("SELECT COUNT(*) total FROM opportunities WHERE status='open'"):await q("SELECT COUNT(*) total FROM opportunities WHERE status='open' AND unit_id=?",[scopedUnitId]);
      const pa=systemAdmin?await q("SELECT COUNT(*) total FROM volunteer_applications WHERE status IN ('received','reviewing')"):await q("SELECT COUNT(*) total FROM volunteer_applications WHERE status IN ('received','reviewing') AND unit_id=?",[scopedUnitId]);
      const av=systemAdmin?await q("SELECT COUNT(*) total FROM users WHERE role='volunteer' AND status='active'"):await q("SELECT COUNT(*) total FROM users WHERE role='volunteer' AND status='active' AND unit_id=?",[scopedUnitId]);
      const at=systemAdmin?await q("SELECT COUNT(*) total FROM tasks WHERE status IN ('todo','doing')"):await q("SELECT COUNT(*) total FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.status IN ('todo','doing') AND u.unit_id=?",[scopedUnitId]);
      const au=systemAdmin?await q("SELECT COUNT(*) total FROM units WHERE status='active'"):{total:scopedUnitId?1:0};
      const sql=`SELECT a.*,o.title opportunity_title,u.name unit_name FROM volunteer_applications a JOIN opportunities o ON o.id=a.opportunity_id LEFT JOIN units u ON u.id=a.unit_id ${systemAdmin?'':'WHERE a.unit_id=?'} ORDER BY a.created_at DESC LIMIT 5`;
      const {results}=systemAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(scopedUnitId).all();
      return json({ok:true,stats:{openOpportunities:+(os?.total||0),pendingApplications:+(pa?.total||0),activeVolunteers:+(av?.total||0),activeTasks:+(at?.total||0),activeUnits:+(au?.total||0)},recent:results||[]});
    }
    if(url.pathname==='/api/admin/units'&&method==='GET'){const {results}=systemAdmin?await env.DB.prepare('SELECT id,name,code,description,notification_email,status,created_at FROM units ORDER BY name').all():await env.DB.prepare('SELECT id,name,code,description,notification_email,status,created_at FROM units WHERE id=?').bind(scopedUnitId).all();return json({ok:true,items:results||[]})}
    if(url.pathname==='/api/admin/units'&&method==='POST'){if(!systemAdmin)return json({ok:false,error:'Chỉ Quản trị hệ thống được tạo đơn vị.'},403);const b=await readJson(request),name=clean(b.name,180),code=clean(b.code,50).toUpperCase();if(!name)return json({ok:false,error:'Vui lòng nhập tên đơn vị.'},400);await env.DB.prepare(`INSERT INTO units(name,code,description,notification_email,status) VALUES(?,?,?,?, 'active')`).bind(name,code||null,clean(b.description,1500)||null,normalizeEmail(b.notificationEmail)||null).run();return json({ok:true})}
    if(url.pathname==='/api/admin/users'&&method==='GET'){const kind=url.searchParams.get('kind');let extra=kind==='admin'?" AND u.role='admin'":kind==='volunteer'?" AND u.role='volunteer'":'';const sql=`SELECT u.id,u.email,u.full_name,u.role,u.status,u.unit_id,u.admin_scope,x.name unit_name,u.created_at FROM users u LEFT JOIN units x ON x.id=u.unit_id WHERE 1=1 ${systemAdmin?'':'AND u.unit_id=?'} ${extra} ORDER BY u.created_at DESC`;const {results}=systemAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(scopedUnitId).all();return json({ok:true,items:results||[]})}
    if(url.pathname==='/api/admin/users'&&method==='POST'){const b=await readJson(request),email=normalizeEmail(b.email),fullName=clean(b.fullName,120),password=String(b.password||''),accountType=b.accountType==='unit_admin'?'unit_admin':'volunteer';let unitId=Number(b.unitId||0)||null;if(!systemAdmin)unitId=scopedUnitId;if(!isValidEmail(email)||!fullName||!unitId)return json({ok:false,error:'Họ tên, email và đơn vị là bắt buộc.'},400);if(accountType==='unit_admin'&&!systemAdmin)return json({ok:false,error:'Chỉ Quản trị hệ thống được cấp tài khoản quản trị đơn vị.'},403);const pe=validatePassword(password);if(pe)return json({ok:false,error:pe},400);const {hash,salt}=await hashPassword(password);await env.DB.prepare(`INSERT INTO users(email,full_name,role,password_hash,salt,status,unit_id,admin_scope) VALUES(?,?,?, ?,?,'active',?,?)`).bind(email,fullName,accountType==='unit_admin'?'admin':'volunteer',hash,salt,unitId,accountType==='unit_admin'?'unit':'none').run();return json({ok:true})}
    let m=url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);if(m&&method==='PATCH'){const b=await readJson(request),st=['active','locked'].includes(b.status)?b.status:null;if(!st)return json({ok:false,error:'Trạng thái không hợp lệ.'},400);const sql=`UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? ${systemAdmin?'':'AND unit_id=?'} AND NOT (role='admin' AND admin_scope='system')`;const r=systemAdmin?await env.DB.prepare(sql).bind(st,+m[1]).run():await env.DB.prepare(sql).bind(st,+m[1],scopedUnitId).run();if(!r.meta?.changes)return json({ok:false,error:'Không thể cập nhật tài khoản này.'},404);return json({ok:true})}
    if(url.pathname==='/api/admin/opportunities'&&method==='GET'){const sql=`SELECT o.*,u.name unit_name,u.code unit_code FROM opportunities o LEFT JOIN units u ON u.id=o.unit_id ${systemAdmin?'':'WHERE o.unit_id=?'} ORDER BY o.created_at DESC`;const {results}=systemAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(scopedUnitId).all();return json({ok:true,items:results||[]})}
    if(url.pathname==='/api/admin/opportunities'&&method==='POST'){const b=await readJson(request),type=String(b.type||''),title=clean(b.title,180);let unitId=Number(b.unitId||0)||null;if(!systemAdmin)unitId=scopedUnitId;const st=['draft','open','closed','cancelled'].includes(b.status)?b.status:'open';if(!['class','activity','event','training'].includes(type)||!title||!unitId)return json({ok:false,error:'Loại, tên và đơn vị là bắt buộc.'},400);await env.DB.prepare(`INSERT INTO opportunities(type,title,unit_id,description,start_at,end_at,registration_deadline,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`).bind(type,title,unitId,clean(b.description,5000)||null,nullableText(b.startAt),nullableText(b.endAt),nullableText(b.registrationDeadline),st,user.id).run();return json({ok:true})}
    m=url.pathname.match(/^\/api\/admin\/opportunities\/(\d+)$/);if(m&&method==='PATCH'){const old=await env.DB.prepare(`SELECT * FROM opportunities WHERE id=? ${systemAdmin?'':'AND unit_id=?'}`).bind(+m[1],...(!systemAdmin?[scopedUnitId]:[])).first();if(!old)return json({ok:false,error:'Không tìm thấy hoạt động trong phạm vi quản lý.'},404);const b=await readJson(request),type=['class','activity','event','training'].includes(b.type)?b.type:old.type,title=b.title!==undefined?clean(b.title,180):old.title,st=['draft','open','closed','cancelled'].includes(b.status)?b.status:old.status;let unitId=systemAdmin?(Number(b.unitId||old.unit_id)||old.unit_id):scopedUnitId;await env.DB.prepare(`UPDATE opportunities SET type=?,title=?,unit_id=?,description=?,start_at=?,end_at=?,registration_deadline=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(type,title,unitId,b.description!==undefined?clean(b.description,5000):old.description,b.startAt!==undefined?nullableText(b.startAt):old.start_at,b.endAt!==undefined?nullableText(b.endAt):old.end_at,b.registrationDeadline!==undefined?nullableText(b.registrationDeadline):old.registration_deadline,st,+m[1]).run();return json({ok:true})}
    if(m&&method==='DELETE'){const id=+m[1];const old=await env.DB.prepare(`SELECT id FROM opportunities WHERE id=? ${systemAdmin?'':'AND unit_id=?'}`).bind(id,...(!systemAdmin?[scopedUnitId]:[])).first();if(!old)return json({ok:false,error:'Không tìm thấy hoạt động.'},404);const a=await env.DB.prepare('SELECT COUNT(*) total FROM volunteer_applications WHERE opportunity_id=?').bind(id).first(),r=await env.DB.prepare('SELECT COUNT(*) total FROM registrations WHERE opportunity_id=?').bind(id).first(),t=await env.DB.prepare('SELECT COUNT(*) total FROM tasks WHERE opportunity_id=?').bind(id).first();if(+(a?.total||0)+ +(r?.total||0)+ +(t?.total||0)>0)return json({ok:false,error:'Hoạt động đã có dữ liệu liên quan. Hãy đóng hoạt động thay vì xóa để bảo toàn lịch sử.'},409);await env.DB.prepare('DELETE FROM opportunities WHERE id=?').bind(id).run();return json({ok:true})}
    if(url.pathname==='/api/admin/applications'&&method==='GET'){const sql=`SELECT a.*,o.title opportunity_title,u.name unit_name FROM volunteer_applications a JOIN opportunities o ON o.id=a.opportunity_id LEFT JOIN units u ON u.id=a.unit_id ${systemAdmin?'':'WHERE a.unit_id=?'} ORDER BY CASE a.status WHEN 'received' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,a.created_at DESC`;const {results}=systemAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(scopedUnitId).all();return json({ok:true,items:results||[]})}
    m=url.pathname.match(/^\/api\/admin\/applications\/(\d+)$/);if(m&&method==='PATCH'){const b=await readJson(request),st=String(b.status||'');if(!['reviewing','approved','rejected','account_issued'].includes(st))return json({ok:false,error:'Trạng thái không hợp lệ.'},400);const sql=`UPDATE volunteer_applications SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? ${systemAdmin?'':'AND unit_id=?'}`;const r=systemAdmin?await env.DB.prepare(sql).bind(st,user.id,+m[1]).run():await env.DB.prepare(sql).bind(st,user.id,+m[1],scopedUnitId).run();if(!r.meta?.changes)return json({ok:false,error:'Không tìm thấy hồ sơ trong phạm vi quản lý.'},404);return json({ok:true})}
    if(url.pathname==='/api/admin/tasks'&&method==='GET'){const sql=`SELECT t.*,u.full_name volunteer_name,u.unit_id,o.title opportunity_title FROM tasks t JOIN users u ON u.id=t.user_id LEFT JOIN opportunities o ON o.id=t.opportunity_id ${systemAdmin?'':'WHERE u.unit_id=?'} ORDER BY t.created_at DESC`;const {results}=systemAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(scopedUnitId).all();return json({ok:true,items:results||[]})}
    if(url.pathname==='/api/admin/tasks'&&method==='POST'){const b=await readJson(request),uid=+b.userId,title=clean(b.title,180);const target=await env.DB.prepare(`SELECT id,unit_id FROM users WHERE id=? AND role='volunteer' ${systemAdmin?'':'AND unit_id=?'}`).bind(uid,...(!systemAdmin?[scopedUnitId]:[])).first();if(!target||!title)return json({ok:false,error:'TNV hoặc tên nhiệm vụ không hợp lệ.'},400);await env.DB.prepare(`INSERT INTO tasks(user_id,opportunity_id,title,description,due_at,status,assigned_by) VALUES(?,?,?,?,?,'todo',?)`).bind(uid,Number(b.opportunityId)||null,title,clean(b.description,2000)||null,nullableText(b.dueAt),user.id).run();return json({ok:true})}
    m=url.pathname.match(/^\/api\/admin\/tasks\/(\d+)$/);if(m&&method==='PATCH'){const b=await readJson(request),st=String(b.status||'');if(!['todo','doing','done','cancelled'].includes(st))return json({ok:false,error:'Trạng thái không hợp lệ.'},400);const sql=systemAdmin?`UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`:`UPDATE tasks SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id IN (SELECT id FROM users WHERE unit_id=?)`;const r=systemAdmin?await env.DB.prepare(sql).bind(st,+m[1]).run():await env.DB.prepare(sql).bind(st,+m[1],scopedUnitId).run();if(!r.meta?.changes)return json({ok:false,error:'Không tìm thấy nhiệm vụ.'},404);return json({ok:true})}
  }
  return json({ok:false,error:'Không tìm thấy chức năng.'},404);
}

async function ensureSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS volunteer_applications(id INTEGER PRIMARY KEY AUTOINCREMENT,application_code TEXT NOT NULL UNIQUE,opportunity_id INTEGER NOT NULL,unit_id INTEGER,full_name TEXT NOT NULL,date_of_birth TEXT,email TEXT NOT NULL,phone TEXT NOT NULL,school_class_unit TEXT NOT NULL,experience TEXT,motivation TEXT,note TEXT,status TEXT NOT NULL DEFAULT 'received',reviewed_by INTEGER,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  const alters=[
    `ALTER TABLE users ADD COLUMN unit_id INTEGER`,
    `ALTER TABLE users ADD COLUMN admin_scope TEXT NOT NULL DEFAULT 'none'`,
    `ALTER TABLE units ADD COLUMN notification_email TEXT`,
    `ALTER TABLE volunteer_profiles ADD COLUMN school_class_unit TEXT`,
    `ALTER TABLE volunteer_applications ADD COLUMN profile_photo_key TEXT`,
    `ALTER TABLE volunteer_applications ADD COLUMN profile_photo_token TEXT`
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run();}catch(e){if(!String(e).toLowerCase().includes('duplicate column')) console.log('schema compatibility:',String(e));}}
  // Nâng tài khoản admin cũ thành quản trị hệ thống, không đổi ID/tài khoản.
  try{await env.DB.prepare(`UPDATE users SET admin_scope='system' WHERE role='admin' AND (admin_scope IS NULL OR admin_scope='none') AND email=?`).bind(ADMIN_EMAIL).run();}catch{}
}

async function sendApplicationEmails(env,x){
  if(!env.RESEND_API_KEY) return;
  const configured=normalizeEmail(x.opportunity.notification_email||'');
  const to=(!configured || configured==='skyfirst.ec@gmail.com') ? APPLICATION_RECEIVER_EMAIL : configured;
  const headers={'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'};
  const from=env.MAIL_FROM||DEFAULT_MAIL_FROM;
  const appUrl=(env.APP_URL||'https://tnv.skyfirst.io.vn').replace(/\/$/,'');
  const photoUrl=`${appUrl}/api/public/application-photo/${encodeURIComponent(x.code)}?token=${encodeURIComponent(x.profilePhotoToken)}`;
  const profileImageBlock=`<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin-top:20px;\"><tr><td align=\"center\"><img src=\"${escapeHtml(photoUrl)}\" alt=\"Ảnh cá nhân\" width=\"150\" style=\"display:block;width:150px;height:150px;object-fit:cover;border-radius:20px;border:5px solid #fff;box-shadow:0 8px 26px rgba(83,32,100,.18);\"></td></tr></table>`;
  const applicantHtml=renderTemplate(TNV_CONFIRMATION_EMAIL_TEMPLATE,{
    FULL_NAME:escapeHtml(x.fullName), VOLUNTEER_ID:escapeHtml(x.code), PROGRAM_NAME:escapeHtml(x.opportunity.title),
    ACTIVITY_TYPE:escapeHtml(opportunityTypeName(x.opportunity.type)), ROLE_NAME:'Tình nguyện viên', TEAM_NAME:escapeHtml(x.opportunity.unit_name||'Sky First Network'),
    START_TIME:escapeHtml(formatViDateTime(x.opportunity.start_at)||'Theo thông báo của Ban Tổ chức'), END_TIME:escapeHtml(formatViDateTime(x.opportunity.end_at)||''),
    LOCATION:'Theo thông tin chương trình', MODE:escapeHtml(x.opportunity.type==='class'?'Theo hình thức lớp học':'Theo kế hoạch hoạt động'),
    EMAIL:escapeHtml(x.email), PHONE:escapeHtml(x.phone), SUBMITTED_AT:escapeHtml(formatViDateTime(new Date().toISOString())), STATUS:'ĐÃ TIẾP NHẬN',
    VOLUNTEER_NOTE:'Ban phụ trách sẽ xem xét hồ sơ và liên hệ qua email hoặc số điện thoại/Zalo bạn đã đăng ký khi có cập nhật.',
    ACTION_URL:'https://tnv.skyfirst.io.vn/#application-lookup', ACTION_LABEL:'TRA CỨU HỒ SƠ TNV', PROFILE_IMAGE_BLOCK:profileImageBlock
  });
  const adminText=`Có hồ sơ TNV mới\nMã hồ sơ: ${x.code}\nCơ hội: ${x.opportunity.title}\nHọ tên: ${x.fullName}\nEmail: ${x.email}\nSố điện thoại: ${x.phone}\nTrường/Lớp/Đơn vị: ${x.school}\nẢnh cá nhân: ${photoUrl}`;
  const applicantText=`Sky First Network đã tiếp nhận đăng ký tình nguyện viên của bạn.\nMã hồ sơ: ${x.code}\nChương trình: ${x.opportunity.title}\nTra cứu tại: ${appUrl}`;
  await Promise.allSettled([
    fetch('https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify({from,to:[to],subject:`[TNV] Hồ sơ mới ${x.code}`,text:adminText})}),
    fetch('https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify({from,to:[x.email],subject:`Sky First | Xác nhận đăng ký ${x.code}`,html:applicantHtml,text:applicantText})})
  ]);
}
const TNV_CONFIRMATION_EMAIL_TEMPLATE = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sky First Network — Xác nhận Tình nguyện viên</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#203244;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:32px 12px;">
<tr>
<td align="center">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:720px;background:#ffffff;border-radius:26px;overflow:hidden;box-shadow:0 18px 50px rgba(31,54,82,.14);">

<!-- HERO -->
<tr>
<td style="padding:40px 42px;background:linear-gradient(120deg,#5b21b6 0%,#9333ea 34%,#db2777 67%,#f97316 100%);color:#ffffff;">
<div style="font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;opacity:.92;">SKY FIRST NETWORK</div>
<h1 style="margin:10px 0 8px;font-size:30px;line-height:1.25;">Xác nhận đăng ký Tình nguyện viên</h1>
<p style="margin:0;font-size:15px;line-height:1.7;opacity:.95;">Thông tin đăng ký của bạn đã được hệ thống tiếp nhận.</p>
</td>
</tr>

<tr>
<td style="height:7px;background:linear-gradient(90deg,#6d28d9,#c026d3,#ef4444,#f97316);font-size:0;">&nbsp;</td>
</tr>

<!-- CONTENT -->
<tr>
<td style="padding:36px 42px 14px;">

<p style="margin:0 0 18px;font-size:16px;line-height:1.75;">
Xin chào <strong style="color:#7e22ce;">{{FULL_NAME}}</strong>,
</p>

<p style="margin:0 0 24px;font-size:16px;line-height:1.75;">
Sky First Network xác nhận đã tiếp nhận đăng ký của bạn cho
<strong>{{PROGRAM_NAME}}</strong>.
Thông tin dưới đây được tự động điền theo nội dung bạn đã đăng ký.
</p>

<!-- CODE -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:linear-gradient(120deg,#f5ecff,#fff0f5,#fff6e9);border:1px solid #eadcf4;border-radius:20px;">
<tr>
<td align="center" style="padding:24px 18px;">
<div style="font-size:12px;color:#765d7c;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">MÃ ĐĂNG KÝ TNV</div>
<div style="margin-top:9px;font-size:26px;font-weight:800;color:#7b278e;letter-spacing:.7px;">{{VOLUNTEER_ID}}</div>
</td>
</tr>
</table>

{{PROFILE_IMAGE_BLOCK}}

<!-- 4 CARDS -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;">
<tr>
<td width="49%" valign="top" style="padding:18px;border:1px solid #e4e8ef;border-radius:17px;background:#ffffff;">
<div style="font-size:12px;color:#7b8794;font-weight:800;letter-spacing:.8px;text-transform:uppercase;">CHƯƠNG TRÌNH</div>
<div style="margin-top:8px;font-size:16px;font-weight:800;color:#552064;line-height:1.45;">{{PROGRAM_NAME}}</div>
<div style="margin-top:6px;font-size:13px;color:#75879a;line-height:1.55;">{{ACTIVITY_TYPE}}</div>
</td>
<td width="2%">&nbsp;</td>
<td width="49%" valign="top" style="padding:18px;border:1px solid #e4e8ef;border-radius:17px;background:#ffffff;">
<div style="font-size:12px;color:#7b8794;font-weight:800;letter-spacing:.8px;text-transform:uppercase;">VAI TRÒ</div>
<div style="margin-top:8px;font-size:16px;font-weight:800;color:#552064;line-height:1.45;">{{ROLE_NAME}}</div>
<div style="margin-top:6px;font-size:13px;color:#75879a;line-height:1.55;">{{TEAM_NAME}}</div>
</td>
</tr>

<tr><td colspan="3" style="height:12px;"></td></tr>

<tr>
<td width="49%" valign="top" style="padding:18px;border:1px solid #e4e8ef;border-radius:17px;background:#ffffff;">
<div style="font-size:12px;color:#7b8794;font-weight:800;letter-spacing:.8px;text-transform:uppercase;">THỜI GIAN</div>
<div style="margin-top:8px;font-size:16px;font-weight:800;color:#552064;line-height:1.45;">{{START_TIME}}</div>
<div style="margin-top:6px;font-size:13px;color:#75879a;line-height:1.55;">{{END_TIME}}</div>
</td>
<td width="2%">&nbsp;</td>
<td width="49%" valign="top" style="padding:18px;border:1px solid #e4e8ef;border-radius:17px;background:#ffffff;">
<div style="font-size:12px;color:#7b8794;font-weight:800;letter-spacing:.8px;text-transform:uppercase;">ĐỊA ĐIỂM / HÌNH THỨC</div>
<div style="margin-top:8px;font-size:16px;font-weight:800;color:#552064;line-height:1.45;">{{LOCATION}}</div>
<div style="margin-top:6px;font-size:13px;color:#75879a;line-height:1.55;">{{MODE}}</div>
</td>
</tr>
</table>

<!-- DETAILS -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;border:1px solid #e1e8ef;border-radius:18px;background:#fff;">
<tr>
<td style="padding:22px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td style="padding:9px 0;color:#687d90;font-size:14px;">Họ và tên</td>
<td align="right" style="padding:9px 0;font-size:14px;font-weight:700;">{{FULL_NAME}}</td>
</tr>
<tr>
<td style="padding:9px 0;color:#687d90;font-size:14px;">Email</td>
<td align="right" style="padding:9px 0;font-size:14px;font-weight:700;">{{EMAIL}}</td>
</tr>
<tr>
<td style="padding:9px 0;color:#687d90;font-size:14px;">Số điện thoại</td>
<td align="right" style="padding:9px 0;font-size:14px;font-weight:700;">{{PHONE}}</td>
</tr>
<tr>
<td style="padding:9px 0;color:#687d90;font-size:14px;">Ngày đăng ký</td>
<td align="right" style="padding:9px 0;font-size:14px;font-weight:700;">{{SUBMITTED_AT}}</td>
</tr>
<tr>
<td style="padding:9px 0;color:#687d90;font-size:14px;">Trạng thái</td>
<td align="right" style="padding:9px 0;">
<span style="display:inline-block;padding:8px 13px;border-radius:999px;background:#f2e8ff;color:#672b8b;font-size:12px;font-weight:800;">{{STATUS}}</span>
</td>
</tr>
</table>
</td>
</tr>
</table>

<!-- DYNAMIC NOTE -->
<div style="margin-top:20px;padding:18px 20px;border-radius:16px;background:linear-gradient(100deg,#faf3ff,#fff4f0);border-left:4px solid #a63886;">
<div style="font-size:13px;font-weight:800;color:#6b2d73;margin-bottom:6px;">THÔNG TIN DÀNH CHO TÌNH NGUYỆN VIÊN</div>
<div style="font-size:14px;line-height:1.7;color:#65546b;">{{VOLUNTEER_NOTE}}</div>
</div>

<!-- CTA -->
<div style="text-align:center;padding:31px 0 15px;">
<a href="{{ACTION_URL}}" style="display:inline-block;padding:15px 31px;border-radius:13px;background:linear-gradient(100deg,#762b82,#c23872,#f4511e);color:#fff;text-decoration:none;font-size:14px;font-weight:800;letter-spacing:.3px;box-shadow:0 9px 22px rgba(174,52,91,.22);">{{ACTION_LABEL}}</a>
</div>

<p style="margin:0;text-align:center;color:#738597;font-size:13px;line-height:1.65;">
Thông tin đăng ký của bạn đã được gửi đến địa chỉ email đăng ký.
</p>

</td>
</tr>

<!-- SKY FIRST ECOSYSTEM -->
<tr>
<td style="padding:10px 42px 34px;">
<div style="border-top:1px solid #e7edf3;padding-top:25px;">
<div style="font-size:12px;font-weight:800;letter-spacing:1.4px;color:#64788b;text-transform:uppercase;margin-bottom:8px;">HỆ SINH THÁI TRỰC TUYẾN SKY FIRST</div>
<div style="font-size:14px;line-height:1.65;color:#6d8091;margin-bottom:18px;">Các không gian trực tuyến được tách theo từng nhu cầu để bạn dễ truy cập đúng nơi cần thiết.</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td width="49%" valign="top" style="padding:18px;border:1px solid #dbe7f0;border-radius:17px;background:linear-gradient(145deg,#fff,#faf4ff);">
<div style="font-size:16px;font-weight:800;color:#552064;margin-bottom:7px;">Cổng Thông tin</div>
<div style="font-size:13px;line-height:1.55;color:#687d90;margin-bottom:8px;">Tra cứu thông tin, đăng ký và trạng thái xử lý.</div>
<a href="https://ctt.skyfirst.io.vn" style="font-size:12px;font-weight:800;color:#f4511e;text-decoration:none;">ctt.skyfirst.io.vn</a>
</td>
<td width="2%">&nbsp;</td>
<td width="49%" valign="top" style="padding:18px;border:1px solid #dbe7f0;border-radius:17px;background:linear-gradient(145deg,#fff,#fff5f8);">
<div style="font-size:16px;font-weight:800;color:#552064;margin-bottom:7px;">Cổng Thành viên</div>
<div style="font-size:13px;line-height:1.55;color:#687d90;margin-bottom:8px;">Không gian dành cho thành viên và phối hợp nội bộ.</div>
<a href="https://member.skyfirst.io.vn" style="font-size:12px;font-weight:800;color:#f4511e;text-decoration:none;">member.skyfirst.io.vn</a>
</td>
</tr>

<tr><td colspan="3" style="height:12px;"></td></tr>

<tr>
<td width="49%" valign="top" style="padding:18px;border:1px solid #dbe7f0;border-radius:17px;background:linear-gradient(145deg,#fff,#f4f8ff);">
<div style="font-size:16px;font-weight:800;color:#552064;margin-bottom:7px;">Cổng Tình nguyện viên</div>
<div style="font-size:13px;line-height:1.55;color:#687d90;margin-bottom:8px;">Thông tin, lịch hoạt động và nội dung dành cho TNV.</div>
<a href="https://tnv.skyfirst.io.vn" style="font-size:12px;font-weight:800;color:#f4511e;text-decoration:none;">tnv.skyfirst.io.vn</a>
</td>
<td width="2%">&nbsp;</td>
<td width="49%" valign="top" style="padding:18px;border:1px solid #dbe7f0;border-radius:17px;background:linear-gradient(145deg,#fff,#fff8ef);">
<div style="font-size:16px;font-weight:800;color:#552064;margin-bottom:7px;">Trang Sky First</div>
<div style="font-size:13px;line-height:1.55;color:#687d90;margin-bottom:8px;">Thông tin chung, hoạt động và nội dung công khai.</div>
<a href="https://skyfirst.io.vn" style="font-size:12px;font-weight:800;color:#f4511e;text-decoration:none;">skyfirst.io.vn</a>
</td>
</tr>
</table>

</div>
</td>
</tr>

<!-- NOTE -->
<tr>
<td style="padding:0 42px 30px;">
<div style="padding:17px 19px;border-radius:15px;background:#f8f4fb;border-left:4px solid #8b3a91;">
<p style="margin:0;color:#66536a;font-size:13px;line-height:1.7;"><strong>Lưu ý:</strong> Đây là email tự động. Vui lòng không phản hồi trực tiếp email này.</p>
</div>
</td>
</tr>

<!-- FOOTER -->
<tr>
<td style="padding:24px 30px;text-align:center;background:linear-gradient(110deg,#35145d,#55206e,#762b5f);color:#dcd0e5;">
<div style="font-size:13px;font-weight:700;color:#fff;">Sky First Network</div>
<div style="margin-top:6px;font-size:12px;line-height:1.65;">Cổng Tình nguyện viên · tnv.skyfirst.io.vn</div>
<div style="margin-top:11px;font-size:11px;opacity:.75;">© 2026 Sky First Network. All rights reserved.</div>
</td>
</tr>

</table>

</td>
</tr>
</table>
</body>
</html>
`;
function renderTemplate(t,vars){return String(t).replace(/\{\{([A-Z0-9_]+)\}\}/g,(_,k)=>vars[k]??'');}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function validateProfilePhoto(f){if(!f || !(f instanceof File))return 'Vui lòng tải lên ảnh cá nhân để hoàn tất đăng ký.';if(!['image/jpeg','image/png','image/webp'].includes(f.type))return 'Ảnh cá nhân chỉ hỗ trợ JPG, PNG hoặc WEBP.';if(f.size>MAX_PROFILE_PHOTO_BYTES)return 'Ảnh cá nhân tối đa 5 MB.';return '';}
function imageExtension(t){return t==='image/png'?'png':t==='image/webp'?'webp':'jpg';}
function opportunityTypeName(t){return ({class:'Lớp học',training:'Đào tạo / Tập huấn',activity:'Hoạt động',event:'Sự kiện'})[t]||'Hoạt động tình nguyện';}
function formatViDateTime(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(d);}
async function newApplicationCode(env){for(let i=0;i<5;i++){const d=new Date(), code=`TNV-${d.getFullYear()}-${randomToken(4).toUpperCase()}`;const e=await env.DB.prepare('SELECT id FROM volunteer_applications WHERE application_code=?').bind(code).first();if(!e)return code;}return `TNV-${Date.now()}`;}
async function requireUser(request,env){const token=getCookie(request,'sfn_session');if(!token)return null;const h=await hashSessionToken(token);return await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' LIMIT 1`).bind(h,new Date().toISOString()).first();}
function publicUser(u){return{id:u.id,email:u.email,fullName:u.full_name,role:u.role,status:u.status,unitId:u.unit_id||null,adminScope:u.admin_scope||'none'};}
async function hashPassword(password,saltB64=null){const salt=saltB64?b64ToBytes(saltB64):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:PBKDF2_ITERATIONS},key,256);return{hash:bytesToB64(new Uint8Array(bits)),salt:bytesToB64(salt)};}
async function verifyPassword(p,s,h){return timingSafeEqual((await hashPassword(p,s)).hash,h);}
async function hashSessionToken(t){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function timingSafeEqual(a,b){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function randomToken(n=32){return [...crypto.getRandomValues(new Uint8Array(n))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function bytesToB64(b){let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s);} function b64ToBytes(s){const x=atob(s);return Uint8Array.from(x,c=>c.charCodeAt(0));}
function getCookie(req,name){const c=req.headers.get('Cookie')||'';for(const p of c.split(';')){const [k,...v]=p.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));}return null;}
function sessionCookie(v,days){return `sfn_session=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0,Math.floor(days*86400))}`;}
async function readJson(r){try{return await r.json();}catch{return {};}} function clean(v,n=500){return String(v??'').trim().slice(0,n);} function nullableText(v){const s=String(v??'').trim();return s||null;} function normalizeEmail(v){return String(v??'').trim().toLowerCase();} function isValidEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);} function validatePassword(v){if(v.length<10)return'Mật khẩu cần ít nhất 10 ký tự.';return null;}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
