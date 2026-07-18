/* SourceBuddy secure local server. Run with: node server.js */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm');
const ROOT=__dirname, PORT=Number(process.env.PORT||3000), DB=path.join(ROOT,'auth-data.json');
const sessions=new Map(), MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpeg':'image/jpeg','.mp4':'video/mp4'};
function initialCompanies(){const code=fs.readFileSync(path.join(ROOT,'companies.js'),'utf8').replace('const COMPANIES','globalThis.COMPANIES');const box={};vm.createContext(box);vm.runInContext(code,box);return box.COMPANIES||[]}
function readDb(){if(!fs.existsSync(DB))return {users:[],companies:initialCompanies()};try{return JSON.parse(fs.readFileSync(DB,'utf8'))}catch{throw Error('auth-data.json is invalid')}}
function writeDb(db){const temp=DB+'.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(temp,DB)}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return new Promise((ok,no)=>crypto.scrypt(password,salt,64,(e,key)=>e?no(e):ok({salt,hash:key.toString('hex')})))}
async function passwordMatches(password,user){const p=await hash(password,user.salt);return crypto.timingSafeEqual(Buffer.from(p.hash,'hex'),Buffer.from(user.passwordHash,'hex'))}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))}
function body(req){return new Promise((ok,no)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch{no(Error('Invalid JSON'))}})})}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(v=>v.length===2))}
function user(req){
 const s=sessions.get(cookies(req).sb_session);
 if(!s||s.expires<=Date.now())return null;
 const live=readDb().users.find(u=>u.id===s.user.id);
 if(!live)return null;
 s.user=publicUser(live); // assignments and role changes apply to active sessions immediately
 return s.user;
}
function authorize(req,res,admin=false){const u=user(req);if(!u){json(res,401,{error:'Sign in required'});return null}if(admin&&u.role!=='admin'){json(res,403,{error:'Admin permission required'});return null}return u}
function publicUser(u){return {id:u.id,username:u.username,name:u.name,role:u.role,companyIds:u.companyIds||[]}}
function validUsername(v){return typeof v==='string'&&/^[a-zA-Z0-9._-]{3,50}$/.test(v)}
function validPassword(v){return typeof v==='string'&&v.length>=8&&v.length<=200}
async function api(req,res,url){const method=req.method, p=url.pathname, db=readDb();
 if(method==='GET'&&p==='/api/setup-status')return json(res,200,{needsSetup:!db.users.some(u=>u.role==='admin'),adminCount:db.users.filter(u=>u.role==='admin').length});
 if(method==='POST'&&p==='/api/setup'){if(db.users.some(u=>u.role==='admin'))return json(res,409,{error:'Setup has already been completed'});const d=await body(req),admins=Array.isArray(d.admins)?d.admins:[];if(!admins.length||admins.length>2)return json(res,400,{error:'Create one or two admins'});for(const a of admins)if(!validUsername(a.username)||!validPassword(a.password))return json(res,400,{error:'Usernames need 3+ valid characters; passwords need 8+ characters'});if(new Set(admins.map(a=>a.username.toLowerCase())).size!==admins.length)return json(res,400,{error:'Admin usernames must be unique'});for(const a of admins){const h=await hash(a.password);db.users.push({id:crypto.randomUUID(),username:a.username.trim(),name:(a.name||a.username).trim(),role:'admin',passwordHash:h.hash,salt:h.salt,companyIds:[]})}writeDb(db);return json(res,201,{ok:true});}
 if(method==='POST'&&p==='/api/login'){const d=await body(req),u=db.users.find(x=>x.username.toLowerCase()===String(d.username||'').trim().toLowerCase());if(!u||!(await passwordMatches(String(d.password||''),u)))return json(res,401,{error:'Invalid username or password'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{user:publicUser(u),expires:Date.now()+8*60*60*1000});res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Set-Cookie':`sb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,'Cache-Control':'no-store'});return res.end(JSON.stringify({user:publicUser(u)}));}
 if(method==='POST'&&p==='/api/logout'){sessions.delete(cookies(req).sb_session);res.writeHead(204,{'Set-Cookie':'sb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return res.end()}
 if(method==='GET'&&p==='/api/me'){const u=authorize(req,res);if(u)return json(res,200,{user:u});return}
 if(method==='GET'&&p==='/api/companies'){const u=authorize(req,res);if(!u)return;return json(res,200,{companies:u.role==='admin'?db.companies:db.companies.filter(c=>(u.companyIds||[]).map(String).includes(String(c['#'])))})}
 if(method==='PUT'&&p==='/api/companies'){
  const u=authorize(req,res);if(!u)return;const d=await body(req);if(!Array.isArray(d.companies))return json(res,400,{error:'Companies array required'});
  if(u.role==='admin'){db.companies=d.companies;writeDb(db);return json(res,200,{ok:true,companies:db.companies})}
  /* Users may create and edit only their assigned companies. Missing records are never deleted. */
  const allowed=new Set((u.companyIds||[]).map(String)), known=new Map(db.companies.map(c=>[String(c['#']),c]));
  let next=Math.max(0,...db.companies.map(c=>Number(c['#'])||0))+1;
  for(const incoming of d.companies){const id=String(incoming?.['#']??'');if(known.has(id)){if(!allowed.has(id))return json(res,403,{error:'Company access denied'});Object.assign(known.get(id),incoming,{'#':known.get(id)['#']})}else{const created={...incoming,'#':next++};db.companies.push(created);known.set(String(created['#']),created);allowed.add(String(created['#']))}}
  const live=db.users.find(x=>x.id===u.id);live.companyIds=[...allowed];writeDb(db);return json(res,200,{ok:true,companies:db.companies.filter(c=>allowed.has(String(c['#'])))});
 }
 if(method==='GET'&&p==='/api/users'){if(!authorize(req,res,true))return;return json(res,200,{users:db.users.map(publicUser)})}
 if(method==='POST'&&p==='/api/users'){if(!authorize(req,res,true))return;const d=await body(req);if(!validUsername(d.username)||!validPassword(d.password))return json(res,400,{error:'Username or password is invalid'});if(db.users.some(u=>u.username.toLowerCase()===d.username.trim().toLowerCase()))return json(res,409,{error:'Username already exists'});const h=await hash(d.password);const u={id:crypto.randomUUID(),username:d.username.trim(),name:(d.name||d.username).trim(),role:'user',passwordHash:h.hash,salt:h.salt,companyIds:[]};db.users.push(u);writeDb(db);return json(res,201,{user:publicUser(u)})}
 const match=p.match(/^\/api\/users\/([^/]+)(?:\/(password|companies))?$/);if(match){if(!authorize(req,res,true))return;const u=db.users.find(x=>x.id===match[1]);if(!u)return json(res,404,{error:'User not found'});if(method==='DELETE'&&!match[2]){if(u.role==='admin')return json(res,400,{error:'Admins cannot be deleted here'});db.users=db.users.filter(x=>x.id!==u.id);writeDb(db);return json(res,204,{})}const d=await body(req);if(method==='PUT'&&match[2]==='password'){if(!validPassword(d.password))return json(res,400,{error:'Password must contain at least 8 characters'});const h=await hash(d.password);u.passwordHash=h.hash;u.salt=h.salt;writeDb(db);return json(res,200,{ok:true})}if(method==='PUT'&&match[2]==='companies'){if(u.role!=='user'||!Array.isArray(d.companyIds))return json(res,400,{error:'Company assignment is only valid for users'});const known=new Set(db.companies.map(c=>String(c['#'])));u.companyIds=[...new Set(d.companyIds.map(String))].filter(id=>known.has(id));writeDb(db);return json(res,200,{user:publicUser(u)})}}
 if(method==='POST'&&p==='/api/admins'){if(!authorize(req,res,true))return;const d=await body(req);if(db.users.filter(u=>u.role==='admin').length>=2)return json(res,400,{error:'Maximum of two admins'});if(!validUsername(d.username)||!validPassword(d.password))return json(res,400,{error:'Username or password is invalid'});if(db.users.some(u=>u.username.toLowerCase()===d.username.trim().toLowerCase()))return json(res,409,{error:'Username already exists'});const h=await hash(d.password);const u={id:crypto.randomUUID(),username:d.username.trim(),name:(d.name||d.username).trim(),role:'admin',passwordHash:h.hash,salt:h.salt,companyIds:[]};db.users.push(u);writeDb(db);return json(res,201,{user:publicUser(u)})}
 return json(res,404,{error:'Not found'});
}
function staticFile(req,res,url){
 let file=url.pathname==='/'?'login-new.html':url.pathname.slice(1);
 if(file==='login.html'||file==='companies.js'||file==='auth-data.json')return res.writeHead(403).end('Forbidden');
 /* Route protection happens before HTML is sent, so changing a URL cannot reveal an admin page. */
 if(file==='admin.html'){const u=user(req);if(!u)return res.writeHead(302,{Location:'/login-new.html'}).end();if(u.role!=='admin')return res.writeHead(302,{Location:'/index.html'}).end()}
 if(file==='index.html'){const u=user(req);if(!u)return res.writeHead(302,{Location:'/login-new.html'}).end()}
 if(file==='user.html'){const u=user(req);return res.writeHead(302,{Location:u?'/index.html':'/login-new.html'}).end()}
 if(!/^[\w.-]+$/.test(file))return res.writeHead(400).end('Bad request');const full=path.join(ROOT,file);if(!full.startsWith(ROOT)||!fs.existsSync(full))return res.writeHead(404).end('Not found');res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(full).pipe(res)
}
http.createServer((req,res)=>{const url=new URL(req.url,`http://${req.headers.host}`);if(url.pathname.startsWith('/api/'))api(req,res,url).catch(e=>json(res,400,{error:e.message}));else staticFile(req,res,url)}).listen(PORT,()=>console.log(`SourceBuddy running at http://localhost:${PORT}`));
