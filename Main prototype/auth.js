/* ============================================================
   BuildSync AI — Auth & Data Layer
   Client-side persistence (localStorage) simulating a real
   phone+OTP identity system with a Builder -> Supervisor -> Worker
   hierarchy and per-project visibility.

   ── IMPORTANT: OTP DELIVERY ──────────────────────────────────
   There is no SMS gateway wired up (that needs a paid provider
   like MSG91/Twilio + a backend, which needs your own API keys).
   OTPs are generated for real and verified for real, but instead
   of being texted, they're shown on-screen in "Demo Mode" so the
   whole flow is fully testable end-to-end right now. Swap
   `generateOtp()` below for a real API call once you have a
   provider, nothing else in the app needs to change.
   ============================================================ */

const DB_KEY = 'buildsync_db_v1';
const SESSION_KEY = 'buildsync_session_v1';
const OTP_TTL_MS = 5 * 60 * 1000;
const SITE_START_TIME = '09:30'; // check in after this = late
const DEFAULT_GEOFENCE_RADIUS_M = 300;
const DEFAULT_CATEGORIES = ['Foundation', 'Brick Work', 'Plaster', 'Electrical', 'Painting'];

function seedDb() {
  return {
    users: [
      { id: 'u_builder_demo', role: 'builder', name: 'Jaydev Lamror', company: 'Lamror Constructions', phone: '9999900001', createdAt: Date.now(), createdBy: null }
    ],
    projects: [
      {
        id: 'p_demo1', name: 'Skyline Residency', location: 'Sector 12, Gurugram', builderId: 'u_builder_demo',
        progress: 70, labourCost: 360000, createdAt: Date.now(),
        categories: [
          { name: 'Foundation', percent: 100 },
          { name: 'Brick Work', percent: 45 },
          { name: 'Plaster', percent: 10 },
          { name: 'Electrical', percent: 0 },
          { name: 'Painting', percent: 0 }
        ],
        siteLocation: null,
        geofenceRadius: DEFAULT_GEOFENCE_RADIUS_M
      }
    ],
    attendance: [],
    payments: [],
    tasks: [],
    dailyLogs: [],
    alerts: []
  };
}

function getDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) { const s = seedDb(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
  try {
    const db = JSON.parse(raw);
    db.payments = db.payments || [];
    db.tasks = db.tasks || [];
    db.dailyLogs = db.dailyLogs || [];
    db.alerts = db.alerts || [];
    db.projects.forEach(p => {
      if (!p.categories) p.categories = DEFAULT_CATEGORIES.map(name => ({ name, percent: name === 'Foundation' ? p.progress || 0 : 0 }));
      if (p.siteLocation === undefined) p.siteLocation = null;
      if (!p.geofenceRadius) p.geofenceRadius = DEFAULT_GEOFENCE_RADIUS_M;
      if (p.totalBudget === undefined) p.totalBudget = 0;
      if (!p.blueprints) p.blueprints = [];
    });
    db.users.forEach(u => { if (u.role === 'worker' && !u.expectedArrival) u.expectedArrival = SITE_START_TIME; });
    return db;
  } catch (e) { const s = seedDb(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
}

function saveDb(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

function normalizePhone(phone) { return (phone || '').replace(/\D/g, '').slice(-10); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function findUserByPhone(phone) {
  const p = normalizePhone(phone);
  return getDb().users.find(u => u.phone === p) || null;
}

/* ---------------- OTP ---------------- */

function otpStore() {
  const raw = sessionStorage.getItem('buildsync_otp_v1');
  return raw ? JSON.parse(raw) : {};
}
function saveOtpStore(s) { sessionStorage.setItem('buildsync_otp_v1', JSON.stringify(s)); }

function generateOtp(phone) {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const store = otpStore();
  store[normalizePhone(phone)] = { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
  saveOtpStore(store);
  return code;
}

function verifyOtp(phone, code) {
  const store = otpStore();
  const entry = store[normalizePhone(phone)];
  if (!entry) return { ok: false, reason: 'No OTP requested for this number.' };
  if (Date.now() > entry.expiresAt) return { ok: false, reason: 'OTP expired. Request a new one.' };
  entry.attempts += 1;
  if (entry.attempts > 5) return { ok: false, reason: 'Too many attempts. Request a new OTP.' };
  saveOtpStore(store);
  if (entry.code !== code) return { ok: false, reason: 'Incorrect OTP.' };
  delete store[normalizePhone(phone)];
  saveOtpStore(store);
  return { ok: true };
}

/* ---------------- Session ---------------- */

function setSession(userId) { sessionStorage.setItem(SESSION_KEY, userId); }
function getSession() {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) return null;
  return getDb().users.find(u => u.id === id) || null;
}
function logout() { sessionStorage.removeItem(SESSION_KEY); window.location.href = 'index.html'; }

function requireRole(role) {
  const user = getSession();
  if (!user || user.role !== role) { window.location.href = 'login.html'; return null; }
  return user;
}

/* ---------------- Registration ---------------- */

function registerBuilder({ name, company, phone }) {
  const db = getDb();
  const p = normalizePhone(phone);
  if (db.users.find(u => u.phone === p)) return { ok: false, reason: 'This number is already registered.' };
  const user = { id: 'u_' + Date.now(), role: 'builder', name, company, phone: p, createdAt: Date.now(), createdBy: null };
  db.users.push(user);
  saveDb(db);
  return { ok: true, user };
}

function addSupervisor({ name, phone, projectIds, addedBy }) {
  const db = getDb();
  const p = normalizePhone(phone);
  let user = db.users.find(u => u.phone === p);
  if (user && user.role !== 'supervisor') return { ok: false, reason: 'This number is already registered as a ' + user.role + '.' };
  if (!user) {
    user = { id: 'u_' + Date.now() + Math.floor(Math.random()*999), role: 'supervisor', name, phone: p, projectIds: [], createdAt: Date.now(), createdBy: addedBy };
    db.users.push(user);
  }
  projectIds.forEach(pid => { if (!user.projectIds.includes(pid)) user.projectIds.push(pid); });
  saveDb(db);
  return { ok: true, user };
}

/* Unassigns a supervisor from the given project id(s). If that leaves them
   supervising nothing at all, the user record is removed entirely — mirrors
   deleteWorker() below, since a supervisor with zero projects can't do
   anything in the app anyway. */
function removeSupervisorFromProjects(supervisorId, projectIdsToRemove) {
  const db = getDb();
  const sup = db.users.find(u => u.id === supervisorId && u.role === 'supervisor');
  if (!sup) return;
  sup.projectIds = (sup.projectIds || []).filter(id => !projectIdsToRemove.includes(id));
  if (sup.projectIds.length === 0) {
    db.users = db.users.filter(u => u.id !== supervisorId);
  }
  saveDb(db);
}

function addWorker({ name, phone, projectId, trade, wageRate, addedBy }) {
  const db = getDb();
  const p = normalizePhone(phone);
  let user = db.users.find(u => u.phone === p);
  if (user && user.role !== 'worker') return { ok: false, reason: 'This number is already registered as a ' + user.role + '.' };
  if (!user) {
    user = { id: 'u_' + Date.now() + Math.floor(Math.random()*999), role: 'worker', name, phone: p, projectId, trade: trade || 'General Labour', wageRate: wageRate || 700, expectedArrival: SITE_START_TIME, createdAt: Date.now(), addedBy };
    db.users.push(user);
  } else {
    user.projectId = projectId;
  }
  saveDb(db);
  return { ok: true, user };
}

function deleteWorker(workerId) {
  const db = getDb();
  db.users = db.users.filter(u => u.id !== workerId);
  db.attendance = db.attendance.filter(a => a.userId !== workerId);
  db.payments = db.payments.filter(p => p.workerId !== workerId);
  db.tasks = db.tasks.filter(t => t.workerId !== workerId);
  db.alerts = db.alerts.filter(a => a.workerId !== workerId);
  saveDb(db);
}

function updateWorkerWage(workerId, wageRate) {
  const db = getDb();
  const w = db.users.find(u => u.id === workerId);
  if (w) { w.wageRate = wageRate; saveDb(db); }
}

function updateWorkerArrival(workerId, hhmm) {
  const db = getDb();
  const w = db.users.find(u => u.id === workerId);
  if (w) { w.expectedArrival = hhmm; saveDb(db); }
}

function addProject({ name, location, builderId }) {
  const db = getDb();
  const project = {
    id: 'p_' + Date.now(), name, location, builderId, progress: 0, labourCost: 0, createdAt: Date.now(),
    categories: DEFAULT_CATEGORIES.map(n => ({ name: n, percent: 0 })),
    siteLocation: null, geofenceRadius: DEFAULT_GEOFENCE_RADIUS_M,
    totalBudget: 0, blueprints: []
  };
  db.projects.push(project);
  saveDb(db);
  return project;
}

function updateProjectCategory(projectId, categoryName, percent) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  const cat = proj.categories.find(c => c.name === categoryName);
  if (cat) cat.percent = percent;
  proj.progress = Math.round(proj.categories.reduce((s, c) => s + c.percent, 0) / proj.categories.length);
  saveDb(db);
}

function setProjectSiteLocation(projectId, lat, lng) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.siteLocation = { lat, lng };
  saveDb(db);
}

function setProjectGeofenceRadius(projectId, radiusMeters) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.geofenceRadius = radiusMeters;
  saveDb(db);
}

function setProjectBudget(projectId, amount) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.totalBudget = amount;
  saveDb(db);
}

function getProjectById(projectId) { return getDb().projects.find(p => p.id === projectId) || null; }

function budgetSpent(projectId) {
  const workerIds = workersForProject(projectId).map(w => w.id);
  return getDb().payments.filter(p => workerIds.includes(p.workerId)).reduce((s, p) => s + p.amount, 0);
}

function dailyWageBill(projectId) {
  return workersForProject(projectId).reduce((s, w) => s + w.wageRate, 0);
}

function addBlueprint(projectId, { name, dataUrl }) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.blueprints.push({ id: 'bp_' + Date.now() + Math.floor(Math.random()*999), name, dataUrl, uploadedAt: Date.now() });
  saveDb(db);
}
function deleteBlueprint(projectId, blueprintId) {
  const db = getDb();
  const proj = db.projects.find(p => p.id === projectId);
  if (!proj) return;
  proj.blueprints = proj.blueprints.filter(b => b.id !== blueprintId);
  saveDb(db);
}

/* ---------------- Queries ---------------- */

function projectsForBuilder(builderId) { return getDb().projects.filter(p => p.builderId === builderId); }
function projectsForSupervisor(supervisorId) {
  const sup = getDb().users.find(u => u.id === supervisorId);
  if (!sup) return [];
  return getDb().projects.filter(p => (sup.projectIds || []).includes(p.id));
}
function projectForWorker(worker) { return getDb().projects.find(p => p.id === worker.projectId) || null; }
function supervisorsForBuilder(builderId) {
  const projectIds = projectsForBuilder(builderId).map(p => p.id);
  return getDb().users.filter(u => u.role === 'supervisor' && (u.projectIds || []).some(pid => projectIds.includes(pid)));
}
function supervisorsForProject(projectId) {
  return getDb().users.filter(u => u.role === 'supervisor' && (u.projectIds || []).includes(projectId));
}
function workersForProject(projectId) { return getDb().users.filter(u => u.role === 'worker' && u.projectId === projectId); }
function workersForSupervisor(supervisorId) {
  const projectIds = (getDb().users.find(u => u.id === supervisorId)?.projectIds) || [];
  return getDb().users.filter(u => u.role === 'worker' && projectIds.includes(u.projectId));
}

/* ---------------- Attendance ---------------- */

function checkIn(userId, projectId, method, coords) {
  const db = getDb();
  const worker = db.users.find(u => u.id === userId);
  const expected = (worker && worker.expectedArrival) || SITE_START_TIME;
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const [eh, em] = expected.split(':').map(Number);
  const lateMinutes = Math.max(0, (now.getHours() * 60 + now.getMinutes()) - (eh * 60 + em));
  const status = lateMinutes > 0 ? 'late' : 'present';
  db.attendance.push({
    id: 'a_' + Date.now(),
    userId, projectId,
    date: todayStr(),
    time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    status, lateMinutes, method: method || 'manual',
    location: coords ? { lat: coords.lat, lng: coords.lng } : null
  });
  saveDb(db);
  return status;
}

function attendanceById(id) { return getDb().attendance.find(a => a.id === id) || null; }

/* Compares a check-in's captured location against the project's site pin + geofence.
   Returns null if there's nothing to compare (no coords captured, or no site pin set yet). */
function locationStatusForAttendance(attendanceId) {
  const att = typeof attendanceId === 'string' ? attendanceById(attendanceId) : attendanceId;
  if (!att || !att.location) return null;
  const project = getProjectById(att.projectId);
  if (!project || !project.siteLocation) return { hasSitePin: false, location: att.location };
  const distance = Math.round(haversineMeters(att.location.lat, att.location.lng, project.siteLocation.lat, project.siteLocation.lng));
  return {
    hasSitePin: true,
    location: att.location,
    siteLocation: project.siteLocation,
    radius: project.geofenceRadius,
    distance,
    onSite: distance <= project.geofenceRadius
  };
}

function todaysAttendance(projectId) {
  const today = todayStr();
  return getDb().attendance.filter(a => a.projectId === projectId && a.date === today);
}
function hasCheckedInToday(userId) {
  return getDb().attendance.some(a => a.userId === userId && a.date === todayStr());
}
function attendanceForWorker(userId) {
  return getDb().attendance.filter(a => a.userId === userId);
}

function buildMonthCalendar(worker, year, month) {
  const records = {};
  attendanceForWorker(worker.id).forEach(a => { records[a.date] = a.status; });
  const joined = new Date(worker.createdAt);
  const joinedStr = joined.toISOString().slice(0, 10);
  const today = todayStr();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let status;
    if (dateStr > today) status = 'future';
    else if (dateStr < joinedStr) status = 'before-joining';
    else if (records[dateStr]) status = records[dateStr];
    else status = 'absent';
    cells.push({ day: d, date: dateStr, status });
  }
  return cells;
}

function monthStats(worker, year, month) {
  const cells = buildMonthCalendar(worker, year, month).filter(Boolean);
  const present = cells.filter(c => c.status === 'present').length;
  const late = cells.filter(c => c.status === 'late').length;
  const absent = cells.filter(c => c.status === 'absent').length;
  return { present, late, absent, daysWorked: present + late };
}

/* ---------------- Wages & Payments ---------------- */

function recordPayment(workerId, amount, note) {
  const db = getDb();
  db.payments.push({ id: 'pay_' + Date.now(), workerId, amount, note: note || '', date: todayStr() });
  saveDb(db);
}
function totalPaid(workerId) {
  return getDb().payments.filter(p => p.workerId === workerId).reduce((s, p) => s + p.amount, 0);
}
function paymentsForWorker(workerId) {
  return getDb().payments.filter(p => p.workerId === workerId).sort((a, b) => b.date.localeCompare(a.date));
}
function wageSummary(worker) {
  const now = new Date();
  const { daysWorked } = monthStats(worker, now.getFullYear(), now.getMonth());
  const allTimeDaysWorked = attendanceForWorker(worker.id).filter(a => a.status === 'present' || a.status === 'late').length;
  const gross = allTimeDaysWorked * worker.wageRate;
  const paid = totalPaid(worker.id);
  return { daysWorkedThisMonth: daysWorked, allTimeDaysWorked, wageRate: worker.wageRate, gross, paid, balance: gross - paid };
}

/* ---------------- Tasks ---------------- */

function addTask({ workerId, projectId, title, addedBy }) {
  const db = getDb();
  db.tasks.push({ id: 't_' + Date.now() + Math.floor(Math.random()*999), workerId, projectId, title, date: todayStr(), status: 'pending', addedBy });
  saveDb(db);
}
function tasksForWorker(workerId, date) {
  return getDb().tasks.filter(t => t.workerId === workerId && (!date || t.date === date));
}
function tasksForProject(projectId, date) {
  return getDb().tasks.filter(t => t.projectId === projectId && (!date || t.date === date));
}
function toggleTask(taskId) {
  const db = getDb();
  const t = db.tasks.find(t => t.id === taskId);
  if (t) { t.status = t.status === 'done' ? 'pending' : 'done'; saveDb(db); }
}
function deleteTask(taskId) {
  const db = getDb();
  db.tasks = db.tasks.filter(t => t.id !== taskId);
  saveDb(db);
}

/* ---------------- Daily logs (photos + feedback) ---------------- */

function saveDailyLog({ projectId, supervisorId, photos, feedback }) {
  const db = getDb();
  const now = new Date();
  db.dailyLogs.push({
    id: 'log_' + Date.now(), projectId, supervisorId, photos, feedback,
    date: todayStr(), time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  });
  saveDb(db);
}
function dailyLogsForProject(projectId) {
  return getDb().dailyLogs.filter(l => l.projectId === projectId).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/* ---------------- Geofencing ---------------- */

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function raiseGeofenceAlert(projectId, workerId, message) {
  const db = getDb();
  const recent = db.alerts.find(a => a.workerId === workerId && a.projectId === projectId && !a.read && (Date.now() - a.time) < 10 * 60 * 1000);
  if (recent) return;
  db.alerts.push({ id: 'al_' + Date.now(), projectId, workerId, message, time: Date.now(), read: false });
  saveDb(db);
}
function alertsForProject(projectId) {
  return getDb().alerts.filter(a => a.projectId === projectId).sort((a, b) => b.time - a.time);
}
function markAlertsRead(projectId) {
  const db = getDb();
  db.alerts.forEach(a => { if (a.projectId === projectId) a.read = true; });
  saveDb(db);
}