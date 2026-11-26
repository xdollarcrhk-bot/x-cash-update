require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_PATH || 'x_cash_update.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
 status TEXT NOT NULL DEFAULT 'inactive', referral_code TEXT UNIQUE NOT NULL,
 referred_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 reference TEXT, proof_note TEXT, status TEXT NOT NULL DEFAULT 'pending',
 reviewed_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL,
 reward INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, task_id INTEGER NOT NULL,
 proof TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewed_by INTEGER,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 kind TEXT NOT NULL, note TEXT NOT NULL, ref_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 bank_name TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', reviewed_by INTEGER, admin_note TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);
const adminEmail=(process.env.ADMIN_EMAIL||'admin@example.com').toLowerCase();
const adminPass=process.env.ADMIN_PASSWORD||'ChangeMe-123!';
if(!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)){
 db.prepare('INSERT INTO users(name,email,password_hash,role,status,referral_code) VALUES(?,?,?,?,?,?)')
 .run('Site Admin',adminEmail,bcrypt.hashSync(adminPass,12),'admin','active','ADMIN');
}
const appLimiter=rateLimit({windowMs:15*60*1000,max:100,standardHeaders:true,legacyHeaders:false});
app.use(helmet({contentSecurityPolicy:false}));
app.use(appLimiter);
app.use(express.json({limit:'150kb'}));
app.use(session({
 secret:process.env.SESSION_SECRET||'development-secret-change-me',
 resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000}
}));
app.use(express.static(path.join(__dirname,'public')));
const getUser=id=>db.prepare('SELECT id,name,email,role,status,referral_code FROM users WHERE id=?').get(id);
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'Please sign in.'});
const admin=(req,res,next)=>{const u=req.session.userId&&getUser(req.session.userId);if(!u||u.role!=='admin')return res.status(403).json({error:'Admin access required.'});next();};
const wallet=userId=>db.prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM ledger WHERE user_id=?').get(userId).balance;
const randomCode=()=> 'XCU-'+Math.random().toString(36).slice(2,8).toUpperCase();

app.post('/api/register',async(req,res)=>{
 const {name,email,password,referralCode}=req.body||{};
 if(!name||!email||!password||password.length<10)return res.status(400).json({error:'Name, email and password (10+ characters) are required.'});
 const code=randomCode(); const ref=referralCode?db.prepare('SELECT referral_code FROM users WHERE referral_code=? AND status="active"').get(referralCode):null;
 try{const info=db.prepare('INSERT INTO users(name,email,password_hash,referral_code,referred_by) VALUES(?,?,?,?,?)').run(name.trim(),email.trim().toLowerCase(),await bcrypt.hash(password,12),code,ref?.referral_code||null);
 req.session.userId=info.lastInsertRowid;res.json({user:getUser(info.lastInsertRowid),message:'Account created. Submit activation payment for review.'});
 }catch(e){res.status(409).json({error:'That email may already be registered.'});}
});
app.post('/api/login',async(req,res)=>{
 const {email,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').toLowerCase().trim());
 if(!u||!await bcrypt.compare(password||'',u.password_hash))return res.status(401).json({error:'Invalid email or password.'});
 req.session.userId=u.id;res.json({user:getUser(u.id)});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,(req,res)=>{const u=getUser(req.session.userId);res.json({user:u,balance:wallet(u.id),ledger:db.prepare('SELECT amount,kind,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30').all(u.id)});});

app.post('/api/payment-submission',auth,(req,res)=>{
 const u=getUser(req.session.userId);if(u.status==='active')return res.status(400).json({error:'Your membership is already active.'});
 const {reference,proofNote}=req.body||{};
 const existing=db.prepare('SELECT id FROM payments WHERE user_id=? AND status="pending"').get(u.id);
 if(existing)return res.status(409).json({error:'You already have a pending payment submission.'});
 const p=db.prepare('INSERT INTO payments(user_id,amount,reference,proof_note) VALUES(?,?,?,?)').run(3000,reference||null,proofNote||null);
 res.json({ok:true,paymentId:p.lastInsertRowid,message:'Submitted for admin verification. Never send passwords or OTPs.'});
});
app.get('/api/tasks',auth,(req,res)=>res.json(db.prepare('SELECT * FROM tasks WHERE active=1 ORDER BY id DESC').all()));
app.post('/api/tasks/:id/submit',auth,(req,res)=>{
 const u=getUser(req.session.userId);if(u.status!=='active')return res.status(403).json({error:'Activate membership first.'});
 const t=db.prepare('SELECT id FROM tasks WHERE id=? AND active=1').get(req.params.id);if(!t)return res.status(404).json({error:'Task not found.'});
 const already=db.prepare('SELECT id FROM task_submissions WHERE user_id=? AND task_id=? AND status IN ("pending","approved")').get(u.id,t.id);
 if(already)return res.status(409).json({error:'You already submitted this task.'});
 const info=db.prepare('INSERT INTO task_submissions(user_id,task_id,proof) VALUES(?,?,?)').run(u.id,req.body.proof||'');
 res.json({ok:true,submissionId:info.lastInsertRowid});
});
app.post('/api/withdrawals',auth,(req,res)=>{
 const u=getUser(req.session.userId);if(u.status!=='active')return res.status(403).json({error:'Active membership required.'});
 const {amount,bankName,accountNumber,accountName}=req.body||{};const n=Number(amount);
 if(!Number.isInteger(n)||n<1000||!bankName||!/^[0-9]{10}$/.test(accountNumber||'')||!accountName)return res.status(400).json({error:'Enter valid details. Minimum withdrawal is ₦1,000 in this starter configuration.'});
 if(wallet(u.id)<n)return res.status(400).json({error:'Insufficient available balance.'});
 const transaction=db.transaction(()=>{db.prepare('INSERT INTO ledger(user_id,amount,kind,note) VALUES(?,?,?,?)').run(u.id,-n,'withdrawal_hold','Withdrawal request reserve');return db.prepare('INSERT INTO withdrawals(user_id,amount,bank_name,account_number,account_name) VALUES(?,?,?,?,?)').run(u.id,n,bankName,accountNumber,accountName);});
 const result=transaction();res.json({ok:true,withdrawalId:result.lastInsertRowid,status:'pending'});
});

app.get('/api/admin/summary',auth,admin,(req,res)=>{
 res.json({members:db.prepare('SELECT COUNT(*) n FROM users WHERE role="member"').get().n,
 inactive:db.prepare('SELECT COUNT(*) n FROM users WHERE status="inactive"').get().n,
 pendingPayments:db.prepare('SELECT COUNT(*) n FROM payments WHERE status="pending"').get().n,
 pendingTasks:db.prepare('SELECT COUNT(*) n FROM task_submissions WHERE status="pending"').get().n,
 pendingWithdrawals:db.prepare('SELECT COUNT(*) n FROM withdrawals WHERE status="pending"').get().n});
});
app.get('/api/admin/payments',auth,admin,(req,res)=>res.json(db.prepare('SELECT p.*,u.name,u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC').all()));
app.post('/api/admin/payments/:id/approve',auth,admin,(req,res)=>{
 const p=db.prepare('SELECT * FROM payments WHERE id=? AND status="pending"').get(req.params.id);if(!p)return res.status(404).json({error:'Pending payment not found.'});
 const tx=db.transaction(()=>{db.prepare('UPDATE payments SET status="approved",reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(req.session.userId,p.id);db.prepare('UPDATE users SET status="active" WHERE id=?').run(p.user_id);});
 tx();res.json({ok:true});
});
app.post('/api/admin/payments/:id/reject',auth,admin,(req,res)=>{const p=db.prepare('UPDATE payments SET status="rejected",reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status="pending"').run(req.session.userId,req.params.id);res.json({ok:p.changes>0});});
app.post('/api/admin/tasks',auth,admin,(req,res)=>{const {title,description,reward}=req.body||{};if(!title||!description||!Number.isInteger(Number(reward))||Number(reward)<0)return res.status(400).json({error:'Provide title, description and a nonnegative integer reward.'});const i=db.prepare('INSERT INTO tasks(title,description,reward) VALUES(?,?,?)').run(title,description,Number(reward));res.json({id:i.lastInsertRowid});});
app.get('/api/admin/tasks',auth,admin,(req,res)=>res.json(db.prepare('SELECT * FROM tasks ORDER BY id DESC').all()));
app.post('/api/admin/tasks/:id/toggle',auth,admin,(req,res)=>{const t=db.prepare('UPDATE tasks SET active=1-active WHERE id=?').run(req.params.id);res.json({ok:t.changes>0});});
app.get('/api/admin/submissions',auth,admin,(req,res)=>res.json(db.prepare('SELECT s.*,u.name,u.email,t.title,t.reward FROM task_submissions s JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id ORDER BY s.id DESC').all()));
app.post('/api/admin/submissions/:id/approve',auth,admin,(req,res)=>{
 const s=db.prepare('SELECT s.*,t.reward FROM task_submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND s.status="pending"').get(req.params.id);if(!s)return res.status(404).json({error:'Pending submission not found.'});
 db.transaction(()=>{db.prepare('UPDATE task_submissions SET status="approved",reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(req.session.userId,s.id);db.prepare('INSERT INTO ledger(user_id,amount,kind,note,ref_id) VALUES(?,?,?,?,?)').run(s.user_id,s.reward,'task_reward','Approved task reward',s.id);})();res.json({ok:true});
});
app.post('/api/admin/submissions/:id/reject',auth,admin,(req,res)=>{const r=db.prepare('UPDATE task_submissions SET status="rejected",reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status="pending"').run(req.session.userId,req.params.id);res.json({ok:r.changes>0});});
app.get('/api/admin/withdrawals',auth,admin,(req,res)=>res.json(db.prepare('SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC').all()));
app.post('/api/admin/withdrawals/:id/paid',auth,admin,(req,res)=>{const w=db.prepare('SELECT * FROM withdrawals WHERE id=? AND status="pending"').get(req.params.id);if(!w)return res.status(404).json({error:'Pending request not found.'});db.prepare('UPDATE withdrawals SET status="paid",reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(req.session.userId,w.id);res.json({ok:true});});
app.post('/api/admin/withdrawals/:id/reject',auth,admin,(req,res)=>{const w=db.prepare('SELECT * FROM withdrawals WHERE id=? AND status="pending"').get(req.params.id);if(!w)return res.status(404).json({error:'Pending request not found.'});db.transaction(()=>{db.prepare('UPDATE withdrawals SET status="rejected",admin_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.note||'',req.session.userId,w.id);db.prepare('INSERT INTO ledger(user_id,amount,kind,note,ref_id) VALUES(?,?,?,?,?)').run(w.user_id,w.amount,'withdrawal_refund','Rejected withdrawal returned to wallet',w.id);})();res.json({ok:true});});
app.get('/api/admin/members',auth,admin,(req,res)=>res.json(db.prepare('SELECT id,name,email,status,referral_code,referred_by,created_at FROM users WHERE role="member" ORDER BY id DESC').all()));
app.get('/api/admin/ledger',auth,admin,(req,res)=>res.json(db.prepare('SELECT l.*,u.name,u.email FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200').all()));

app.get('/api/health',(req,res)=>res.json({ok:true}));
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`X CASH UPDATE backend listening on http://localhost:${port}`));
