const ADMIN_EMAIL = 'skyfirst.ec@gmail.com';
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
  await seedBaseData(env);
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

  if (url.pathname === '/api/public/applications' && method === 'POST') {
    const b = await readJson(request);
    const opportunityId = Number(b.opportunityId);
    const fullName = clean(b.fullName,120), email=normalizeEmail(b.email), phone=clean(b.phone,40), school=clean(b.schoolClassUnit,180);
    if (!Number.isInteger(opportunityId)||opportunityId<1) return json({ok:false,error:'Cơ hội đăng ký không hợp lệ.'},400);
    if (!fullName || !isValidEmail(email) || !phone || !school) return json({ok:false,error:'Họ tên, email, số điện thoại và trường/lớp/đơn vị là thông tin bắt buộc.'},400);
    const opp = await env.DB.prepare(`SELECT o.id,o.title,o.unit_id,o.registration_deadline,u.name unit_name,u.notification_email FROM opportunities o LEFT JOIN units u ON u.id=o.unit_id WHERE o.id=? AND o.status='open' LIMIT 1`).bind(opportunityId).first();
    if (!opp) return json({ok:false,error:'Cơ hội này hiện không mở đăng ký.'},404);
    if (opp.registration_deadline && Date.parse(opp.registration_deadline) < Date.now()) return json({ok:false,error:'Đã hết thời hạn đăng ký.'},409);
    const code = await newApplicationCode(env);
    await env.DB.prepare(`INSERT INTO volunteer_applications(application_code,opportunity_id,unit_id,full_name,date_of_birth,email,phone,school_class_unit,experience,motivation,note,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'received')`)
      .bind(code,opp.id,opp.unit_id||null,fullName,nullableText(b.dateOfBirth),email,phone,school,clean(b.experience,2000)||null,clean(b.motivation,2000)||null,clean(b.note,1000)||null).run();
    await sendApplicationEmails(env,{code,opportunity:opp,fullName,email,phone,school});
    return json({ok:true,applicationCode:code,message:`Hồ sơ đã được tiếp nhận. Mã hồ sơ: ${code}`},201);
  }

  // Tra cứu GCN công khai. Nếu Cổng CTT trung tâm được cấu hình, chuyển truy vấn tới CTT; không gắn GCN vào tài khoản TNV.
  if (url.pathname === '/api/public/certificates/lookup' && method === 'GET') {
    const code = clean(url.searchParams.get('code'),120);
    if (!code) return json({ok:false,error:'Vui lòng nhập mã Giấy chứng nhận.'},400);
    if (env.CERTIFICATE_LOOKUP_URL) {
      const target = new URL(env.CERTIFICATE_LOOKUP_URL); target.searchParams.set('code',code);
      const r = await fetch(target.toString(),{headers:{Accept:'application/json'}});
      const data = await r.json().catch(()=>({}));
      return json(data,r.status);
    }
    // Tương thích dữ liệu GCN cũ nếu CTT chưa được nối. Chỉ trả thông tin xác minh tối thiểu.
    const c = await env.DB.prepare(`SELECT code,title,issued_at,status FROM certificates WHERE code=? LIMIT 1`).bind(code).first();
    if (!c) return json({ok:false,error:'Không tìm thấy Giấy chứng nhận với mã này.'},404);
    return json({ok:true,certificate:{code:c.code,title:c.title,issuedAt:c.issued_at,status:c.status}});
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
    `ALTER TABLE volunteer_profiles ADD COLUMN school_class_unit TEXT`
  ];
  for(const sql of alters){try{await env.DB.prepare(sql).run();}catch(e){if(!String(e).toLowerCase().includes('duplicate column')) console.log('schema compatibility:',String(e));}}
  // Nâng tài khoản admin cũ thành quản trị hệ thống, không đổi ID/tài khoản.
  try{await env.DB.prepare(`UPDATE users SET admin_scope='system' WHERE role='admin' AND (admin_scope IS NULL OR admin_scope='none') AND email=?`).bind(ADMIN_EMAIL).run();}catch{}
}

async function seedBaseData(env){
  let unit=await env.DB.prepare('SELECT id FROM units WHERE code=? LIMIT 1').bind(SFEC_CODE).first();
  if(!unit){const r=await env.DB.prepare(`INSERT INTO units(name,code,description,notification_email,status) VALUES(?,?,?,?,'active')`).bind(SFEC_NAME,SFEC_CODE,'Đơn vị thành viên thuộc Mạng lưới Giáo dục & Phát triển Cộng đồng Sky First (SFN).','sfec.englishclub@gmail.com').run(); unit={id:r.meta?.last_row_id};}
  if(!unit?.id)return;
  const items=seedOpportunities();
  for(const x of items){
    const exists=await env.DB.prepare('SELECT id FROM opportunities WHERE title=? AND type=? AND unit_id=? LIMIT 1').bind(x.title,x.type,unit.id).first();
    if(!exists) await env.DB.prepare(`INSERT INTO opportunities(type,title,unit_id,description,start_at,registration_deadline,status) VALUES(?,?,?,?,?,?,'open')`).bind(x.type,x.title,unit.id,x.description,x.startAt,x.deadline).run();
  }
}
function seedOpportunities(){return [
['training','TẬP HUẤN NGHIỆP VỤ TÌNH NGUYỆN VIÊN GIẢNG DẠY SFEC','TẬP HUẤN NGHIỆP VỤ TÌNH NGUYỆN VIÊN GIẢNG DẠY SFEC\nChương trình đào tạo và tập huấn dành cho tình nguyện viên trước khi chính thức tham gia giảng dạy tại Câu lạc bộ Tiếng Anh The Sky First (SFEC).\n\nNội dung tập huấn: Giới thiệu mô hình hoạt động và chương trình đào tạo của SFEC; vai trò, trách nhiệm và quy tắc làm việc của TNV; phương pháp chuẩn bị bài và tổ chức một buổi học; kỹ năng truyền đạt, tương tác và quản lý lớp học trực tuyến; sử dụng giáo trình – học liệu; theo dõi tiến độ, đánh giá và phản hồi học viên; xử lý các tình huống thường gặp trong quá trình giảng dạy.\n\nĐối tượng: Tình nguyện viên giảng dạy mới và TNV có nhu cầu củng cố nghiệp vụ.\nHình thức: Trực tuyến\nThời lượng: Theo kế hoạch từng đợt tập huấn.\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\n\nSau khi hoàn thành chương trình và đáp ứng yêu cầu đánh giá, TNV được xác nhận hoàn thành tập huấn và xem xét phân công tham gia giảng dạy tại các lớp phù hợp.','2025-01-31T00:00:00','2030-12-31T11:00:00'],
['class','Lớp 10','LỚP 10 – CỦNG CỐ & PHÁT TRIỂN NĂNG LỰC TIẾNG ANH\nLớp dành cho học sinh lớp 10 có nhu cầu củng cố kiến thức môn Tiếng Anh, xây dựng nền tảng vững chắc và phát triển năng lực sử dụng Tiếng Anh theo chương trình THPT.\n\nNội dung giảng dạy: Tập trung hệ thống kiến thức trọng tâm chương trình Tiếng Anh lớp 10; củng cố từ vựng, ngữ pháp, phát âm và phát triển các kỹ năng nghe, nói, đọc, viết; hỗ trợ học sinh vận dụng kiến thức vào bài tập, kiểm tra và giao tiếp thực tế.\n\nĐối tượng TNV: Tình nguyện viên có kiến thức Tiếng Anh tốt, có khả năng truyền đạt, kiên nhẫn và có tinh thần trách nhiệm. Ưu tiên các bạn có kinh nghiệm dạy học, gia sư hoặc hỗ trợ học sinh THPT.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-01-01T00:00:00','2026-12-31T00:00:00'],
['class','LỚP TIẾNG ANH GIAO TIẾP','LỚP TIẾNG ANH GIAO TIẾP – PHẢN XẠ & TỰ TIN SỬ DỤNG TIẾNG ANH\nLớp dành cho người học mong muốn cải thiện khả năng giao tiếp, tăng phản xạ và tự tin sử dụng Tiếng Anh trong những tình huống thực tế.\n\nNội dung giảng dạy: Tập trung phát âm, phản xạ nghe – nói, mẫu câu giao tiếp và từ vựng theo chủ đề; thực hành hội thoại, thảo luận và xử lý các tình huống giao tiếp thường gặp. Khuyến khích người học chủ động sử dụng Tiếng Anh trong phần lớn thời lượng học.\n\nĐối tượng TNV: Tình nguyện viên có khả năng giao tiếp Tiếng Anh tốt, phát âm rõ ràng, tự tin tương tác và có khả năng tạo môi trường học tập tích cực. Ưu tiên các bạn có kinh nghiệm tổ chức hoạt động giao tiếp, speaking hoặc sinh hoạt CLB Tiếng Anh.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-01-01T11:10:00','2026-12-31T23:20:00'],
['class','LỚP TỪ VỰNG','LỚP TỪ VỰNG – MỞ RỘNG & VẬN DỤNG VỐN TỪ TIẾNG ANH\nLớp dành cho người học mong muốn mở rộng vốn từ, cải thiện khả năng ghi nhớ và biết cách vận dụng từ vựng Tiếng Anh chính xác trong học tập và giao tiếp.\n\nNội dung giảng dạy: Từ vựng được xây dựng theo chủ đề và ngữ cảnh; chú trọng cách phát âm, nghĩa, từ loại, cụm từ và cách sử dụng. Người học được hướng dẫn phương pháp ghi nhớ từ vựng và thực hành vận dụng thông qua câu, đoạn văn, hội thoại và các hoạt động tương tác.\n\nĐối tượng TNV: Tình nguyện viên có vốn từ Tiếng Anh tốt, phát âm rõ ràng và có khả năng giải thích cách sử dụng từ theo ngữ cảnh. Ưu tiên các bạn có phương pháp giảng dạy sáng tạo và khả năng thiết kế hoạt động giúp người học ghi nhớ, vận dụng từ vựng.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-01-01T11:20:00','2026-12-31T11:20:00'],
['class','Lớp Cơ Bản','LỚP CƠ BẢN (A1–A2) – XÂY DỰNG NỀN TẢNG TIẾNG ANH\nLớp dành cho người học đang bắt đầu hoặc cần xây dựng lại nền tảng Tiếng Anh, hướng đến năng lực tương đương trình độ A1–A2.\n\nNội dung giảng dạy: Tập trung vào kiến thức Tiếng Anh nền tảng gồm phát âm, từ vựng, ngữ pháp và các mẫu câu thông dụng; từng bước phát triển kỹ năng nghe, nói, đọc, viết và khả năng sử dụng Tiếng Anh trong những tình huống giao tiếp cơ bản.\n\nĐối tượng TNV: Tình nguyện viên có nền tảng Tiếng Anh tốt, phát âm tương đối chuẩn, nắm chắc kiến thức cơ bản và có khả năng hướng dẫn người mới học. Yêu cầu sự kiên nhẫn, trách nhiệm và khả năng truyền đạt dễ hiểu.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-01-01T12:00:00','2026-12-31T00:00:00'],
['class','Lớp Trung Cấp','LỚP TRUNG CẤP (B1–B2) – PHÁT TRIỂN NĂNG LỰC TIẾNG ANH\nLớp dành cho người học đã có nền tảng Tiếng Anh và mong muốn tiếp tục nâng cao năng lực sử dụng ngôn ngữ, hướng đến trình độ tương đương B1–B2.\n\nNội dung giảng dạy: Mở rộng hệ thống từ vựng và ngữ pháp; phát triển đồng đều các kỹ năng nghe, nói, đọc, viết; tăng khả năng phản xạ, diễn đạt ý tưởng và sử dụng Tiếng Anh trong học tập, giao tiếp và các tình huống thực tế.\n\nĐối tượng TNV: Tình nguyện viên có năng lực Tiếng Anh tốt, kiến thức ngữ pháp vững và khả năng sử dụng Tiếng Anh tương đối thành thạo. Ưu tiên các bạn có kinh nghiệm giảng dạy, gia sư, hoạt động học thuật hoặc sở hữu chứng chỉ ngoại ngữ phù hợp.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-01-01T12:00:00','2026-12-31T00:00:00'],
['class','Lớp 9','LỚP 9 – ÔN TẬP & LUYỆN THI VÀO LỚP 10\nLớp dành cho học sinh lớp 9 có nhu cầu củng cố kiến thức môn Tiếng Anh và chuẩn bị cho kỳ thi tuyển sinh vào lớp 10.\n\nNội dung giảng dạy: Tập trung hệ thống kiến thức trọng tâm chương trình lớp 9; củng cố từ vựng, ngữ pháp, đọc hiểu, giao tiếp và kỹ năng làm bài; luyện tập các dạng bài thường gặp trong kỳ thi tuyển sinh lớp 10.\n\nĐối tượng TNV: Tình nguyện viên có kiến thức Tiếng Anh tốt, có khả năng truyền đạt, kiên nhẫn và có tinh thần trách nhiệm. Ưu tiên các bạn có kinh nghiệm dạy học, gia sư hoặc hỗ trợ học sinh THCS.\nLịch học: Thứ Tư & Thứ Sáu\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-08-01T00:00:00','2026-12-31T00:00:00'],
['class','Lớp 11','LỚP 11 – CỦNG CỐ & NÂNG CAO NĂNG LỰC TIẾNG ANH\nLớp dành cho học sinh lớp 11 có nhu cầu củng cố kiến thức môn Tiếng Anh, nâng cao năng lực sử dụng ngôn ngữ và xây dựng nền tảng vững chắc trước khi bước vào chương trình lớp 12.\n\nNội dung giảng dạy: Tập trung hệ thống kiến thức trọng tâm chương trình Tiếng Anh lớp 11; củng cố và mở rộng từ vựng, ngữ pháp, phát âm; phát triển các kỹ năng nghe, nói, đọc, viết; rèn luyện kỹ năng xử lý bài tập và từng bước làm quen với các dạng bài có tính vận dụng cao.\n\nĐối tượng TNV: Tình nguyện viên có kiến thức Tiếng Anh tốt, có khả năng truyền đạt, kiên nhẫn và có tinh thần trách nhiệm. Ưu tiên các bạn có kinh nghiệm dạy học, gia sư hoặc hỗ trợ học sinh THPT.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-08-31T23:13:00','2026-12-31T10:00:00'],
['class','Lớp 12','LỚP 12 – ÔN TẬP & LUYỆN THI TỐT NGHIỆP THPT\nLớp dành cho học sinh lớp 12 có nhu cầu hệ thống kiến thức môn Tiếng Anh, củng cố năng lực và chuẩn bị cho kỳ thi tốt nghiệp THPT.\n\nNội dung giảng dạy: Hệ thống kiến thức Tiếng Anh trọng tâm lớp 12; củng cố từ vựng, ngữ pháp, đọc hiểu và các kiến thức ngôn ngữ cần thiết; rèn luyện phương pháp xử lý câu hỏi, luyện đề và kỹ năng quản lý thời gian khi làm bài.\n\nĐối tượng TNV: Tình nguyện viên có nền tảng Tiếng Anh tốt, nắm chắc kiến thức THPT và có khả năng truyền đạt. Ưu tiên các bạn có kinh nghiệm dạy học, gia sư, ôn thi hoặc hỗ trợ học sinh lớp 12.\nLịch học: Theo lịch phân công của SFEC\nHình thức: Trực tuyến\nThời lượng: 60 phút/buổi\nĐơn vị tổ chức: Câu lạc bộ Tiếng Anh The Sky First (SFEC)\nTNV sẽ được SFEC cung cấp/định hướng giáo trình, tài liệu và nội dung giảng dạy trong quá trình đồng hành cùng lớp.','2026-08-31T23:14:00','2026-12-31T00:00:00']
].map(([type,title,description,startAt,deadline])=>({type,title,description,startAt,deadline}));}

async function sendApplicationEmails(env,x){
  if(!env.RESEND_API_KEY) return;
  const to=x.opportunity.notification_email||ADMIN_EMAIL;
  const headers={'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'};
  const from=env.MAIL_FROM||'Sky First <noreply@skyfirst.io.vn>';
  const adminText=`Có hồ sơ TNV mới\nMã hồ sơ: ${x.code}\nCơ hội: ${x.opportunity.title}\nHọ tên: ${x.fullName}\nEmail: ${x.email}\nSố điện thoại: ${x.phone}\nTrường/Lớp/Đơn vị: ${x.school}`;
  const applicantText=`Sky First đã tiếp nhận hồ sơ tình nguyện viên của bạn.\nMã hồ sơ: ${x.code}\nCơ hội: ${x.opportunity.title}\nVui lòng lưu mã hồ sơ để đối chiếu khi cần.`;
  await Promise.allSettled([
    fetch('https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify({from,to:[to],subject:`[TNV] Hồ sơ mới ${x.code}`,text:adminText})}),
    fetch('https://api.resend.com/emails',{method:'POST',headers,body:JSON.stringify({from,to:[x.email],subject:`Sky First đã tiếp nhận hồ sơ ${x.code}`,text:applicantText})})
  ]);
}
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
