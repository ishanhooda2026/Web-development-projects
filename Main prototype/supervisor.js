const supervisor = requireRole('supervisor');
renderUserChip(supervisor);
document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

/* ============ SECTION SWITCHING (sidebar nav) ============ */
const SECTION_KEY = 'buildsync_supervisor_section';

function showSection(name) {
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('section-' + name);
  if (!target) return;
  target.classList.add('active');
  document.querySelectorAll('.side-link[data-section]').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`.side-link[data-section="${name}"]`);
  if (link) link.classList.add('active');
  sessionStorage.setItem(SECTION_KEY, name);
}

document.querySelectorAll('.side-link[data-section]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showSection(link.dataset.section);
  });
});

showSection(sessionStorage.getItem(SECTION_KEY) || 'overview');

const projects = projectsForSupervisor(supervisor.id);
let pendingPhotos = []; // [{name, dataUrl}]

if (!projects.length) {
  document.getElementById('noProjectState').classList.remove('hidden');
  document.getElementById('dashboardContent').classList.add('hidden');
} else {
  document.getElementById('pageTitle').textContent = projects.length === 1 ? projects[0].name : 'My Sites';
  const select = document.getElementById('workerProject');
  select.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function render() {
  const workers = workersForSupervisor(supervisor.id);
  const presentToday = [];
  const lateToday = [];
  projects.forEach(p => todaysAttendance(p.id).forEach(a => {
    if (a.status === 'late') lateToday.push(a.userId); else presentToday.push(a.userId);
  }));
  const presentSet = new Set(presentToday);
  const lateSet = new Set(lateToday);
  const absentCount = workers.filter(w => !presentSet.has(w.id) && !lateSet.has(w.id)).length;

  document.getElementById('statPresent').textContent = presentSet.size;
  document.getElementById('statLate').textContent = lateSet.size;
  document.getElementById('statAbsent').textContent = absentCount;
  document.getElementById('statWorkers').textContent = workers.length;

  renderWorkersList(workers, presentSet, lateSet);
  renderAttendanceList(workers);
  renderProgressSliders();
  renderLogHistory();
  renderAlerts();
  renderBlueprints();
}

/* ============ LABOUR LIST ============ */
function renderWorkersList(workers, presentSet, lateSet) {
  const wList = document.getElementById('workersList');
  wList.innerHTML = workers.length ? workers.map(w => {
    const proj = projects.find(p => p.id === w.projectId);
    let badgeStyle = '', label = 'Absent';
    if (lateSet.has(w.id)) { label = 'Late'; badgeStyle = 'color:var(--warning);background:rgba(251,191,36,0.15)'; }
    else if (presentSet.has(w.id)) { label = 'Present'; badgeStyle = 'color:var(--success);background:rgba(74,222,128,0.15)'; }
    else { badgeStyle = 'color:var(--text-secondary);background:rgba(148,163,184,0.15)'; }
    return `
    <div class="list-row">
      <div class="who clickable" title="View attendance calendar" onclick="openWorkerCalendar('${w.id}')">
        <div class="user-avatar">${initials(w.name)}</div>
        <div class="who-meta"><div class="n">${w.name}</div><div class="p">+91 ${w.phone} · ${w.trade} · ${proj ? proj.name : ''}</div></div>
      </div>
      <div class="actions">
        <span class="badge" style="${badgeStyle}">${label}</span>
        <button class="icon-btn" title="Assign work" onclick="openTaskModal('${w.id}','${w.name.replace(/'/g,"")}')">📋</button>
        <button class="icon-btn" title="Manage" onclick="openWorkerDetail('${w.id}')">⚙️</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="glyph">👷</div>No labour added yet.</div>`;
}

function renderAttendanceList(workers) {
  const attList = document.getElementById('attendanceList');
  const todays = projects.flatMap(p => todaysAttendance(p.id).map(a => ({ ...a, projectName: p.name })))
    .sort((a, b) => b.id.localeCompare(a.id));
  attList.innerHTML = todays.length ? todays.map(a => {
    const w = workers.find(u => u.id === a.userId);
    const locBtn = a.location
      ? `<button class="icon-btn" title="Check on-site location" onclick="event.stopPropagation(); showAttendanceLocationModal('${a.id}')">📍</button>`
      : `<span class="text-muted" style="font-size:11px" title="No location captured for this check-in">📍 —</span>`;
    return `<div class="list-row"><div class="who clickable" title="View attendance calendar" onclick="openWorkerCalendar('${a.userId}')"><div class="user-avatar">${initials(w?.name)}</div><div class="who-meta"><div class="n">${w?.name || 'Unknown'}</div><div class="p">${a.time} · ${a.projectName} · ${a.method === 'qr' ? 'QR verified' : a.method === 'manual' ? 'Manual' : ''}</div></div></div><div class="actions"><span class="badge ${a.status === 'late' ? 'gray' : 'green'}">${a.status === 'late' ? 'Late' : 'In'}</span>${locBtn}</div></div>`;
  }).join('') : `<div class="empty-state"><div class="glyph">✅</div>No check-ins yet today.</div>`;
}

/* ============ PROGRESS SLIDERS ============ */
let sliderInteracting = false; // true while a range input is being dragged, so polling can't clobber it

function renderProgressSliders() {
  if (sliderInteracting) return; // don't rebuild sliders mid-drag
  const el = document.getElementById('progressSliders');
  const freshProjects = projects.map(p => getProjectById(p.id) || p); // always read live percentages, not the page-load snapshot
  el.innerHTML = freshProjects.map(p => `
    <div style="margin-bottom:22px">
      ${freshProjects.length > 1 ? `<div class="text-secondary" style="font-weight:600;margin-bottom:10px">${p.name}</div>` : ''}
      ${p.categories.map(c => `
        <div class="slider-row">
          <div class="slider-top"><span>${c.name}</span><span class="pct" id="pctval-${p.id}-${c.name.replace(/\s/g,'')}">${c.percent}%</span></div>
          <input type="range" min="0" max="100" value="${c.percent}"
            oninput="document.getElementById('pctval-${p.id}-${c.name.replace(/\s/g,'')}').textContent = this.value + '%'"
            onchange="updateCategory('${p.id}','${c.name}', this.value)">
        </div>`).join('')}
    </div>`).join('');
}

// Track drag state at the document level so a mouseup outside the slider still clears it
document.getElementById('progressSliders').addEventListener('pointerdown', (e) => {
  if (e.target.matches('input[type="range"]')) sliderInteracting = true;
});
document.addEventListener('pointerup', () => { sliderInteracting = false; });

function updateCategory(projectId, catName, value) {
  updateProjectCategory(projectId, catName, parseInt(value, 10));
  toast(`${catName} updated to ${value}%`, 'success', 1800);
}

/* ============ DAILY LOG (photos + feedback) ============ */
document.getElementById('logPhotos').addEventListener('change', (e) => {
  pendingPhotos = [];
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  [...e.target.files].forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      pendingPhotos.push(reader.result);
      const img = document.createElement('img');
      img.src = reader.result;
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
});

document.getElementById('dailyLogForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const feedback = document.getElementById('logFeedback').value.trim();
  if (!pendingPhotos.length && !feedback) { toast('Add a photo or feedback first.', 'error'); return; }
  saveDailyLog({ projectId: projects[0].id, supervisorId: supervisor.id, photos: pendingPhotos, feedback });
  pendingPhotos = [];
  document.getElementById('logPhotos').value = '';
  document.getElementById('photoPreview').innerHTML = '';
  document.getElementById('logFeedback').value = '';
  toast('Update posted', 'success');
  renderLogHistory();
});

function renderLogHistory() {
  const logs = projects.flatMap(p => dailyLogsForProject(p.id));
  const el = document.getElementById('logHistory');
  el.innerHTML = logs.length ? logs.slice(0, 8).map(l => `
    <div class="log-entry">
      <div class="meta">${l.date} · ${l.time}</div>
      ${l.feedback ? `<div class="feedback">${l.feedback}</div>` : ''}
      ${l.photos && l.photos.length ? `<div class="log-photos">${l.photos.map(p => `<img src="${p}">`).join('')}</div>` : ''}
    </div>`).join('') : `<div class="empty-state" style="padding:20px"><div class="glyph">📸</div>No updates posted yet.</div>`;
}

/* ============ BLUEPRINTS & SITE PLANS ============ */
document.getElementById('blueprintForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('blueprintFile');
  const nameInput = document.getElementById('blueprintName');
  const file = fileInput.files[0];
  if (!file) { toast('Choose a file to upload first.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    addBlueprint(projects[0].id, { name: nameInput.value.trim() || file.name, dataUrl: reader.result });
    fileInput.value = '';
    nameInput.value = '';
    toast('Blueprint uploaded', 'success');
    renderBlueprints();
  };
  reader.readAsDataURL(file);
});

function renderBlueprints() {
  const el = document.getElementById('blueprintsList');
  if (!el) return;
  const blueprints = projects.flatMap(p => {
    const proj = getProjectById(p.id);
    return (proj?.blueprints || []).map(b => ({ ...b, projectId: p.id }));
  }).sort((a, b) => b.uploadedAt - a.uploadedAt);

  el.innerHTML = blueprints.length ? blueprints.map(b => {
    const isPdf = b.dataUrl.startsWith('data:application/pdf');
    return `
    <div class="log-entry">
      <div class="meta">${b.name} · ${new Date(b.uploadedAt).toLocaleDateString('en-IN')}</div>
      ${isPdf
        ? `<a href="${b.dataUrl}" target="_blank" class="btn btn-ghost">📄 View PDF</a>`
        : `<div class="log-photos"><img src="${b.dataUrl}" onclick="window.open('${b.dataUrl}')"></div>`}
      <div style="margin-top:10px">
        <button class="icon-btn danger" title="Remove" onclick="removeBlueprint('${b.projectId}','${b.id}')">🗑</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state" style="padding:20px"><div class="glyph">📐</div>No blueprints or site plans uploaded yet.</div>`;
}

function removeBlueprint(projectId, blueprintId) {
  if (!confirm('Remove this blueprint?')) return;
  deleteBlueprint(projectId, blueprintId);
  toast('Blueprint removed', 'success');
  renderBlueprints();
}

/* ============ ALERTS (geofence) ============ */
if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}
const NOTIFIED_KEY = 'buildsync_notified_alerts';
let notifiedAlertIds = new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || '[]'));

function notifyNewAlerts(alerts) {
  const fresh = alerts.filter(a => !notifiedAlertIds.has(a.id));
  if (!fresh.length) return;
  fresh.forEach(a => {
    const w = getDb().users.find(u => u.id === a.workerId);
    const name = w ? w.name : 'A worker';
    toast(`⚠️ ${name} left the site area`, 'error', 6000);
    if (window.Notification && Notification.permission === 'granted') {
      new Notification('BuildSync — Geofence Alert', { body: `${name} left the site area`, icon: undefined });
    }
    notifiedAlertIds.add(a.id);
  });
  sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notifiedAlertIds]));
}

function renderAlerts() {
  const alerts = projects.flatMap(p => alertsForProject(p.id));
  notifyNewAlerts(alerts);
  const el = document.getElementById('alertsList');
  el.innerHTML = alerts.length ? alerts.slice(0, 10).map(a => {
    const w = getDb().users.find(u => u.id === a.workerId);
    const timeAgo = Math.max(1, Math.round((Date.now() - a.time) / 60000));
    return `<div class="alert-item ${a.read ? 'info' : ''}"><div class="t">${w ? w.name : 'A worker'} left the site area</div><div class="d">${a.message} · ${timeAgo}m ago</div></div>`;
  }).join('') : `<div class="empty-state"><div class="glyph">✅</div>No alerts. Everyone's on site.</div>`;
  if (alerts.some(a => !a.read)) projects.forEach(p => markAlertsRead(p.id));
}

/* ============ WORKER ATTENDANCE CALENDAR ============ */
let calState = { workerId: null, year: 0, month: 0 };
const CAL_DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function openWorkerCalendar(workerId) {
  const w = getDb().users.find(u => u.id === workerId);
  if (!w) return;
  const now = new Date();
  calState = { workerId, year: now.getFullYear(), month: now.getMonth() };
  renderWorkerCalendar();
  openModal('workerCalendarModal');
}

function shiftCalMonth(delta) {
  calState.month += delta;
  if (calState.month < 0) { calState.month = 11; calState.year -= 1; }
  if (calState.month > 11) { calState.month = 0; calState.year += 1; }
  renderWorkerCalendar();
}

function renderWorkerCalendar() {
  const w = getDb().users.find(u => u.id === calState.workerId);
  const body = document.getElementById('workerCalendarBody');
  if (!w) { body.innerHTML = ''; return; }
  const { year, month } = calState;
  const cells = buildMonthCalendar(w, year, month);
  const stats = monthStats(w, year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();

  body.innerHTML = `
    <h3>${w.name}</h3>
    <p class="text-muted" style="margin-bottom:16px">+91 ${w.phone} · ${w.trade || 'General Labour'}</p>

    <div class="cal-nav">
      <button type="button" class="icon-btn" onclick="shiftCalMonth(-1)">‹</button>
      <div class="cal-month">${monthLabel}</div>
      <button type="button" class="icon-btn" onclick="shiftCalMonth(1)" ${isCurrentMonth ? 'disabled' : ''}>›</button>
    </div>

    <div class="cal-grid cal-dow-row">${CAL_DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">
      ${cells.map(c => {
        if (!c) return `<div class="cal-cell empty"></div>`;
        return `<div class="cal-cell ${c.status}" title="${c.date} · ${c.status}">${c.day}</div>`;
      }).join('')}
    </div>

    <div class="cal-legend">
      <span><i class="cal-dot present"></i>Present</span>
      <span><i class="cal-dot late"></i>Late</span>
      <span><i class="cal-dot absent"></i>Absent</span>
    </div>

    <div class="detail-section" style="margin-top:18px">
      <div class="detail-row"><span>Present this month</span><strong>${stats.present}</strong></div>
      <div class="detail-row"><span>Late this month</span><strong>${stats.late}</strong></div>
      <div class="detail-row"><span>Absent this month</span><strong>${stats.absent}</strong></div>
    </div>
  `;
}

/* ============ SET SITE LOCATION (2-option flow + map picker + custom geofence radius) ============ */
let siteMap = null, siteMapMarker = null, siteMapCircle = null, pendingSiteLoc = null;
const DEFAULT_MAP_CENTER = [28.6139, 77.2090]; // New Delhi fallback if no location is set yet

document.getElementById('setSiteLocBtn').addEventListener('click', () => {
  document.getElementById('locStepChoice').classList.remove('hidden');
  document.getElementById('locStepMap').classList.add('hidden');
  const proj = getProjectById(projects[0].id);
  document.getElementById('geofenceRadiusInput').value = proj?.geofenceRadius || 300;
  pendingSiteLoc = proj?.siteLocation ? { lat: proj.siteLocation.lat, lng: proj.siteLocation.lng } : null;
  openModal('siteLocationModal');
});

document.getElementById('locUseCurrentBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Location not supported on this device.', 'error'); return; }
  toast('Getting current location…');
  navigator.geolocation.getCurrentPosition((pos) => {
    pendingSiteLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    document.getElementById('locMapHint').textContent = 'This is your current location. Drag the pin or click elsewhere to adjust.';
    openMapStep();
  }, () => toast('Could not get your location. Check permissions, or use the map instead.', 'error'));
});

document.getElementById('locOpenMapBtn').addEventListener('click', () => {
  document.getElementById('locMapHint').textContent = 'Click anywhere on the map to place the site pin. Drag the pin to fine-tune.';
  openMapStep();
});

document.getElementById('locBackBtn').addEventListener('click', () => {
  document.getElementById('locStepMap').classList.add('hidden');
  document.getElementById('locStepChoice').classList.remove('hidden');
});

function openMapStep() {
  if (typeof L === 'undefined') {
    toast('Map failed to load — check your internet connection and try again.', 'error', 5000);
    return;
  }
  document.getElementById('locStepChoice').classList.add('hidden');
  document.getElementById('locStepMap').classList.remove('hidden');
  const center = pendingSiteLoc ? [pendingSiteLoc.lat, pendingSiteLoc.lng] : DEFAULT_MAP_CENTER;

  // Leaflet needs the container visible + sized before init/resize
  setTimeout(() => {
    if (!siteMap) {
      siteMap = L.map('siteMap').setView(center, pendingSiteLoc ? 16 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
      }).addTo(siteMap);
      siteMap.on('click', (e) => placeSitePin(e.latlng.lat, e.latlng.lng));
    } else {
      siteMap.invalidateSize();
      siteMap.setView(center, pendingSiteLoc ? 16 : 12);
    }
    if (pendingSiteLoc) placeSitePin(pendingSiteLoc.lat, pendingSiteLoc.lng);
  }, 50);
}

function placeSitePin(lat, lng) {
  pendingSiteLoc = { lat, lng };
  const radius = parseInt(document.getElementById('geofenceRadiusInput').value, 10) || 300;
  if (siteMapMarker) {
    siteMapMarker.setLatLng([lat, lng]);
    siteMapCircle.setLatLng([lat, lng]);
  } else {
    siteMapMarker = L.marker([lat, lng], { draggable: true }).addTo(siteMap);
    siteMapMarker.on('dragend', () => {
      const p = siteMapMarker.getLatLng();
      pendingSiteLoc = { lat: p.lat, lng: p.lng };
      siteMapCircle.setLatLng(p);
    });
    siteMapCircle = L.circle([lat, lng], { radius, color: '#3b82f6', fillOpacity: 0.12 }).addTo(siteMap);
  }
  siteMapCircle.setRadius(radius);
}

document.getElementById('geofenceRadiusInput').addEventListener('input', (e) => {
  if (siteMapCircle) siteMapCircle.setRadius(parseInt(e.target.value, 10) || 0);
});

document.getElementById('locSaveBtn').addEventListener('click', () => {
  if (!pendingSiteLoc) { toast('Place a pin on the map first.', 'error'); return; }
  const radius = parseInt(document.getElementById('geofenceRadiusInput').value, 10);
  if (!radius || radius < 30) { toast('Enter a valid geofence radius (30m or more).', 'error'); return; }
  setProjectSiteLocation(projects[0].id, pendingSiteLoc.lat, pendingSiteLoc.lng);
  setProjectGeofenceRadius(projects[0].id, radius);
  toast('Site location and geofence saved. Workers will now be geofenced.', 'success');
  closeModal('siteLocationModal');
});

/* ============ ADD WORKER ============ */
document.getElementById('newWorkerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('workerName').value.trim();
  const phone = document.getElementById('workerPhone').value.trim();
  const trade = document.getElementById('workerTrade').value.trim();
  const projectId = document.getElementById('workerProject').value;
  const wageRate = parseInt(document.getElementById('workerWage').value, 10) || 700;
  if (!name || normalizePhone(phone).length !== 10) { toast('Enter a valid name and 10-digit phone number.', 'error'); return; }
  const result = addWorker({ name, phone, projectId, trade, wageRate, addedBy: supervisor.id });
  if (!result.ok) { toast(result.reason, 'error'); return; }
  closeModal('newWorkerModal');
  e.target.reset();
  toast(`${name} added`, 'success');
  render();
});

/* ============ ASSIGN TASK ============ */
function openTaskModal(workerId, name) {
  document.getElementById('taskWorkerId').value = workerId;
  document.getElementById('taskWorkerName').textContent = 'For ' + name;
  openModal('assignTaskModal');
}
document.getElementById('assignTaskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const workerId = document.getElementById('taskWorkerId').value;
  const title = document.getElementById('taskTitle').value.trim();
  const w = getDb().users.find(u => u.id === workerId);
  if (!title || !w) return;
  addTask({ workerId, projectId: w.projectId, title, addedBy: supervisor.id });
  closeModal('assignTaskModal');
  e.target.reset();
  toast('Work assigned', 'success');
});

/* ============ WORKER DETAIL: wage, payments, delete ============ */
function openWorkerDetail(workerId) {
  const w = getDb().users.find(u => u.id === workerId);
  if (!w) return;
  const summary = wageSummary(w);
  const payments = paymentsForWorker(w.id);
  const body = document.getElementById('workerDetailBody');
  body.innerHTML = `
    <h3>${w.name}</h3>
    <p class="text-muted" style="margin-bottom:16px">+91 ${w.phone} · ${w.trade}</p>

    <div class="detail-section">
      <h4>Wage rate</h4>
      <div class="inline-form">
        <input class="text-input" type="number" id="editWage" value="${w.wageRate}">
        <button class="btn btn-ghost" id="saveWageBtn">Save</button>
      </div>
    </div>

    <div class="detail-section">
      <h4>Wages</h4>
      <div class="detail-row"><span>Days worked (all-time)</span><strong>${summary.allTimeDaysWorked}</strong></div>
      <div class="detail-row"><span>Total earned</span><strong>₹${summary.gross.toLocaleString('en-IN')}</strong></div>
      <div class="detail-row"><span>Already paid</span><strong>₹${summary.paid.toLocaleString('en-IN')}</strong></div>
      <div class="detail-row"><span>Balance due</span><strong style="color:var(--success)">₹${summary.balance.toLocaleString('en-IN')}</strong></div>
    </div>

    <div class="detail-section">
      <h4>Record a payment</h4>
      <div class="inline-form">
        <input class="text-input" type="number" id="paymentAmount" placeholder="Amount ₹">
        <button class="btn btn-primary" id="savePaymentBtn">Add</button>
      </div>
      ${payments.length ? `<div style="margin-top:10px">${payments.slice(0,4).map(p => `<div class="detail-row"><span>${p.date}</span><strong>₹${p.amount.toLocaleString('en-IN')}</strong></div>`).join('')}</div>` : ''}
    </div>

    <button class="btn btn-ghost btn-block" style="border-color:var(--danger);color:var(--danger)" id="deleteWorkerBtn">Remove from site</button>
  `;

  document.getElementById('saveWageBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('editWage').value, 10);
    if (!val || val <= 0) { toast('Enter a valid wage.', 'error'); return; }
    updateWorkerWage(w.id, val);
    toast('Wage updated', 'success');
    openWorkerDetail(w.id);
  });
  document.getElementById('savePaymentBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('paymentAmount').value, 10);
    if (!val || val <= 0) { toast('Enter a valid amount.', 'error'); return; }
    recordPayment(w.id, val);
    toast('Payment recorded', 'success');
    openWorkerDetail(w.id);
  });
  document.getElementById('deleteWorkerBtn').addEventListener('click', () => {
    if (!confirm(`Remove ${w.name} from the site? This can't be undone.`)) return;
    deleteWorker(w.id);
    closeModal('workerDetailModal');
    toast(`${w.name} removed`, 'success');
    render();
  });

  openModal('workerDetailModal');
}

/* ============ KICK OFF ============
   Run only after every function/variable above has been declared —
   render() touches sliderInteracting, notifiedAlertIds, etc. which
   must already exist by the time this fires. */
if (projects.length) {
  render();
  // Live updates: cross-tab (worker checks in on another tab/device sharing this browser) + same-tab polling
  window.addEventListener('storage', (e) => { if (e.key === DB_KEY) render(); });
  setInterval(render, 4000);
}