import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, pbkdf2Sync} from 'node:crypto';

const password='Test-only-password-2026';
function fixture(iterations=100000, sourcePath=new URL('../src/index.js',import.meta.url)) {
  const salt=Buffer.alloc(16,7).toString('base64');
  const user={id:1,email:'ADMIN@example.org',full_name:'Test Admin',role:'admin',admin_scope:'system',status:'active',salt,password_hash:pbkdf2Sync(password,Buffer.from(salt,'base64'),iterations,32,'sha256').toString('base64'),password_iterations:iterations};
  const sessions=new Map();let failSchema=false;const calls=[];
  const DB={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},async first(){
    if(sql.startsWith('SELECT * FROM users'))return user.email.toLowerCase()===args[0]?{...user}:null;
    if(sql.includes('FROM sessions s JOIN users')){const s=sessions.get(args[0]);return s&&s.expires>args[1]&&user.status==='active'?{...user}:null;}
    if(sql.includes('FROM rate_limits'))return null;
    if(sql.startsWith('INSERT INTO rate_limits'))return {count:1,window_start:Math.floor(Date.now()/1000)};
    return null;
  },async run(){
    calls.push(sql);
    if(failSchema&&sql.startsWith('CREATE TABLE')){failSchema=false;throw Error('transient DB error');}
    if(sql.startsWith('INSERT INTO sessions'))sessions.set(args[0],{userId:args[1],expires:args[2]});
    if(sql==='DELETE FROM sessions WHERE user_id=?')sessions.clear();
    if(sql.startsWith('UPDATE users SET password_hash'))Object.assign(user,{password_hash:args[0],salt:args[1],password_iterations:args[2],must_change_password:0});
    return {success:true};
  }};return q;}};
  return {user,calls,env:{DB},failNextSchema(){failSchema=true},async load(){
    const source=(await readFile(sourcePath,'utf8')).replace('export default {','globalThis.worker = {');
    const limitedCrypto={getRandomValues:a=>webcrypto.getRandomValues(a),subtle:{importKey:(...a)=>webcrypto.subtle.importKey(...a),digest:(...a)=>webcrypto.subtle.digest(...a),async deriveBits(alg,...args){if(alg.iterations>100000)throw Error('iteration counts above 100000 are not supported');return webcrypto.subtle.deriveBits(alg,...args);}}};
    const context=vm.createContext({crypto:limitedCrypto,Request,Response,Headers,URL,TextEncoder,Uint8Array,btoa,atob,console:{error(){},log(){}}});vm.runInContext(source,context);return context.worker;
  }};
}
const req=(path,body,cookie)=>new Request('https://portal.example.org'+path,{method:body?'POST':'GET',headers:{Origin:'https://portal.example.org','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('old password logs in and cookie restores account; mixed-case email works',async()=>{
  const f=fixture(),w=await f.load();const r=await w.fetch(req('/api/login',{email:' Admin@EXAMPLE.org ',password}),f.env);assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);const me=await w.fetch(req('/api/me',null,cookie.split(';')[0]),f.env);assert.equal(me.status,200);assert.equal((await me.json()).user.id,1);assert.equal(f.user.password_iterations,100000);
});
test('wrong password and locked account do not get sessions',async()=>{
  const f=fixture(),w=await f.load();for(const locked of [false,true]){f.user.status=locked?'locked':'active';const r=await w.fetch(req('/api/login',{email:f.user.email,password:locked?password:'wrong'}),f.env);assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);}
});
test('password change uses supported cost and revokes previous session',async()=>{
  const f=fixture(),w=await f.load();const login=await w.fetch(req('/api/login',{email:f.user.email,password}),f.env);const cookie=login.headers.get('set-cookie').split(';')[0];const newPassword='Another-test-password-2026';const changed=await w.fetch(req('/api/change-password',{currentPassword:password,newPassword},cookie),f.env);assert.equal(changed.status,200);assert.equal(f.user.password_iterations,100000);assert.equal((await w.fetch(req('/api/me',null,cookie),f.env)).status,401);const retry=await w.fetch(req('/api/login',{email:f.user.email,password:newPassword}),f.env);assert.equal(retry.status,200);
});
test('failed schema initialization retries on next request',async()=>{
  const f=fixture(),w=await f.load();f.failNextSchema();assert.equal((await w.fetch(req('/api/login',{email:f.user.email,password}),f.env)).status,500);assert.equal((await w.fetch(req('/api/login',{email:f.user.email,password}),f.env)).status,200);
});
test('a supported lower-cost legacy hash upgrades only after verification',async()=>{
  const f=fixture(10000),w=await f.load();assert.equal((await w.fetch(req('/api/login',{email:f.user.email,password}),f.env)).status,200);assert.equal(f.user.password_iterations,100000);
});
