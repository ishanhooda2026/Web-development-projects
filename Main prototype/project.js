const builder = requireRole('builder');
renderUserChip(builder);

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('id');
const project = getProjectById(projectId);
let pendingPhotos = []; // [dataUrl, ...] for the self-managed daily log form
let sliderInteracting = false; // true while a progress range input is being dragged, so polling can't clobber it

if (!project || project.builderId !== builder.id) {
  document.getElementById('notFoundState').classList.remove('hidden');
  document.getElementById('projectContent').classList.add('hidden');
} else {
  init();
}

function init() {
  document.getElementById('projectNameTag').textContent = project.name;
  document.getElementById('projTitle').textContent = project.name;
  document.getElementById('projLocationSub').textContent = project.location;
  document.getElementById('assignSupProjectName').textContent = 'For ' + project.name;

  document.querySelectorAll('.side-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.side-link[data-section]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.proj-section').forEach(s => s.classList.add('hidden'));
      document.querySelector(`[data-section-panel="${link.dataset.section}"]`).classList.remove('hidden');
    });
  });

  render();
  setInterval(render, 5000);
  window.addEventListener('storage', (e) => { if (e.key === DB_KEY) render(); });

  document.getElementById('saveBudgetBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('budgetInput').value, 10);
    if (!val || val < 0) { toast('Enter a valid amount.', 'error'); return; }
    setProjectBudget(project.id, val);
    toast('Budget updated', 'success');
    render();
  });

  document.getElementById('assignSupervisorForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('supName').value.trim();
    const phone = document.getElementById('supPhone').value.trim();
    if (!name || normalizePhone(phone).length !== 10) { toast('Enter a valid name and 10-digit phone number.', 'error'); return; }
    const result = addSupervisor({ name, phone, projectIds: [project.id], addedBy: builder.id });
    if (!result.ok) { toast(result.reason, 'error'); return; }
    closeModal('assignSupervisorModal');
    e.target.reset();
    toast(`${name} assigned as supervisor`, 'success');
    render();
  });

  document.getElementById('uploadBlueprintBtn').addEventListener('click', () => {
    const fileInput = document.getElementById('blueprintFile');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a file first.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      addBlueprint(project.id, { name: file.name, dataUrl: reader.result });
      fileInput.value = '';
      toast('Blueprint uploaded', 'success');
      renderBlueprints();
    };
    reader.readAsDataURL(file);
  });

  /* ---- Self-management (only relevant/visible when no supervisor is assigned) ---- */
  document.getElementById('newWorkerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('workerName').value.trim();
    const phone = document.getElementById('workerPhone').value.trim();
    const trade = document.getElementById('workerTrade').value.trim();
    const wageRate = parseInt(document.getElementById('workerWage').value, 10) || 700;
    if (!name || normalizePhone(phone).length !== 10) { toast('Enter a valid name and 10-digit phone number.', 'error'); return; }
    const result = addWorker({ name, phone, projectId: project.id, trade, wageRate, addedBy: builder.id });
    if (!result.ok) { toast(result.reason, 'error'); return; }
    closeModal('newWorkerModal');
    e.target.reset();
    toast(`${name} added`, 'success');
    render();
  });

  document.getElementById('assignTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const workerId = document.getElementById('taskWorkerId').value;
    const title = document.getElementById('taskTitle').value.trim();
    const w = getDb().users.find(u => u.id === workerId);
    if (!title || !w) return;
    addTask({ workerId, projectId: w.projectId, title, addedBy: builder.id });
    closeModal('assignTaskModal');
    e.target.reset();
    toast('Work assigned', 'success');
    render();
  });

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
    saveDailyLog({ projectId: project.id, supervisorId: builder.id, photos: pendingPhotos, feedback });
    pendingPhotos = [];
    document.getElementById('logPhotos').value = '';
    document.getElementById('photoPreview').innerHTML = '';
    document.getElementById('logFeedback').value = '';
    toast('Update posted', 'success');
    renderLogHistory();
  });

  wireSiteLocationModal();
}

function render() {
  const liveProject = getProjectById(project.id); // pick up live edits from supervisor
  const workers = workersForProject(project.id);
  const todays = todaysAttendance(project.id);
  const presentSet = new Set(todays.filter(a => a.status === 'present').map(a => a.userId));
  const lateMap = new Map(todays.filter(a => a.status === 'late').map(a => [a.userId, a]));
  const attMap = new Map(todays.map(a => [a.userId, a]));
  const hasSupervisor = supervisorsForProject(project.id).length > 0;

  // Toggle self-management UI: only visible/usable when nobody supervises this project
  document.getElementById('noSupervisorHint').classList.toggle('hidden', hasSupervisor);
  document.getElementById('setSiteLocBtn').classList.toggle('hidden', hasSupervisor);
  document.getElementById('addLabourBtn').classList.toggle('hidden', hasSupervisor);
  document.getElementById('postUpdateWrap').classList.toggle('hidden', hasSupervisor);

  document.getElementById('projProgressPct').textContent = liveProject.progress + '%';

  // Overview
  document.getElementById('ovPresent').textContent = presentSet.size;
  document.getElementById('ovLate').textContent = lateMap.size;
  document.getElementById('ovAbsent').textContent = Math.max(0, workers.length - presentSet.size - lateMap.size);
  document.getElementById('ovProgress').textContent = liveProject.progress + '%';

  const spent = budgetSpent(project.id);
  const pending = Math.max(0, (liveProject.totalBudget || 0) - spent);
  document.getElementById('ovBudgetTotal').textContent = '₹' + (liveProject.totalBudget || 0).toLocaleString('en-IN');
  document.getElementById('ovBudgetSpent').textContent = '₹' + spent.toLocaleString('en-IN');
  document.getElementById('ovBudgetPending').textContent = '₹' + pending.toLocaleString('en-IN');
  document.getElementById('ovWageBill').textContent = '₹' + dailyWageBill(project.id).toLocaleString('en-IN');

  const latestLog = dailyLogsForProject(project.id)[0];
  document.getElementById('ovLatestLog').innerHTML = latestLog
    ? logEntryHtml(latestLog)
    : `<div class="empty-state" style="padding:16px"><div class="glyph">📸</div>No updates posted yet.</div>`;

  // Team
  renderSupervisors();

  // Attendance
  renderAttendance(workers, presentSet, lateMap, attMap, hasSupervisor);

  // Progress + tasks
  renderCategoryBars(liveProject, hasSupervisor);
  renderTaskBoard(workers);

  // Site updates
  renderLogHistory();

  // Budget & wages
  document.getElementById('budgetInput').value = liveProject.totalBudget || '';
  document.getElementById('budgetSpentVal').textContent = '₹' + spent.toLocaleString('en-IN');
  document.getElementById('budgetPendingVal').textContent = '₹' + pending.toLocaleString('en-IN');
  renderWageTable(workers, presentSet, lateMap);

  // Blueprints
  renderBlueprints();
}

/* ============ SET SITE LOCATION (self-managed projects) ============ */
let siteMap = null, siteMapMarker = null, siteMapCircle = null, pendingSiteLoc = null;
const DEFAULT_MAP_CENTER = [28.6139, 77.2090]; // New Delhi fallback if no location is set yet

function wireSiteLocationModal() {
  document.getElementById('setSiteLocBtn').addEventListener('click', () => {
    document.getElementById('locStepChoice').classList.remove('hidden');
    document.getElementById('locStepMap').classList.add('hidden');
    const liveProject = getProjectById(project.id);
    document.getElementById('geofenceRadiusInput').value = liveProject?.geofenceRadius || 300;
    pendingSiteLoc = liveProject?.siteLocation ? { lat: liveProject.siteLocation.lat, lng: liveProject.siteLocation.lng } : null;
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

  document.getElementById('geofenceRadiusInput').addEventListener('input', (e) => {
    if (siteMapCircle) siteMapCircle.setRadius(parseInt(e.target.value, 10) || 0);
  });

  document.getElementById('locSaveBtn').addEventListener('click', () => {
    if (!pendingSiteLoc) { toast('Place a pin on the map first.', 'error'); return; }
    const radius = parseInt(document.getElementById('geofenceRadiusInput').value, 10);
    if (!radius || radius < 30) { toast('Enter a valid geofence radius (30m or more).', 'error'); return; }
    setProjectSiteLocation(project.id, pendingSiteLoc.lat, pendingSiteLoc.lng);
    setProjectGeofenceRadius(project.id, radius);
    toast('Site location and geofence saved.', 'success');
    closeModal('siteLocationModal');
  });
}

function openMapStep() {
  if (typeof L === 'undefined') {
    toast('Map failed to load — check your internet connection and try again.', 'error', 5000);
    return;
  }
  document.getElementById('locStepChoice').classList.add('hidden');
  document.getElementById('locStepMap').classList.remove('hidden');
  const center = pendingSiteLoc ? [pendingSiteLoc.lat, pendingSiteLoc.lng] : DEFAULT_MAP_CENTER;

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

/* ============ TEAM ============ */
function renderSupervisors() {
  const sups = supervisorsForProject(project.id);
  const el = document.getElementById('supervisorList');
  el.innerHTML = sups.length ? sups.map(s => `
    <div class="list-row">
      <div class="who">
        <div class="user-avatar">${initials(s.name)}</div>
        <div class="who-meta"><div class="n">${s.name}</div><div class="p">+91 ${s.phone}</div></div>
      </div>
      <div class="actions">
        <span class="badge blue">Supervisor</span>
        <button class="icon-btn danger" title="Remove from this project" onclick="removeSupervisorFromThisProject('${s.id}')">✕</button>
      </div>
    </div>`).join('') : `<div class="empty-state"><div class="glyph">👷</div>No supervisor assigned yet.</div>`;
}

function removeSupervisorFromThisProject(supervisorId) {
  if (!confirm(`Remove this supervisor from ${project.name}? If this is their only project, they'll lose access entirely.`)) return;
  removeSupervisorFromProjects(supervisorId, [project.id]);
  toast('Supervisor removed from this project', 'success');
  renderSupervisors();
}

/* ============ ATTENDANCE ============ */
function renderAttendance(workers, presentSet, lateMap, attMap, hasSupervisor) {
  const el = document.getElementById('attendanceTable');
  if (!workers.length) { el.innerHTML = `<div class="empty-state"><div class="glyph">👷</div>No labour on this project yet.</div>`; return; }
  const header = `<div class="att-row head"><span>Labour</span><span class="col-late">Status</span><span class="col-arrival">Expected Arrival</span><span>Details</span></div>`;
  el.innerHTML = header + workers.map(w => {
    const late = lateMap.get(w.id);
    const present = presentSet.has(w.id);
    const att = attMap.get(w.id);
    let statusHtml;
    if (late) statusHtml = `<span class="badge" style="color:var(--warning);background:rgba(251,191,36,0.15)">Late${late.lateMinutes != null ? ' by ' + late.lateMinutes + 'm' : ''}</span>`;
    else if (present) statusHtml = `<span class="badge green">On time</span>`;
    else statusHtml = `<span class="badge gray">Absent</span>`;
    const locBtn = att
      ? (att.location
          ? `<button class="icon-btn" title="Check on-site location" onclick="event.stopPropagation(); showAttendanceLocationModal('${att.id}')">📍</button>`
          : `<span class="text-muted" style="font-size:11px" title="No location captured">📍 —</span>`)
      : '';
    const selfManageBtns = hasSupervisor ? '' : `
        <button class="icon-btn" title="Assign work" onclick="event.stopPropagation(); openTaskModal('${w.id}','${w.name.replace(/'/g, "\\'")}')">📋</button>
        <button class="icon-btn" title="Manage wage &amp; payments" onclick="event.stopPropagation(); openWorkerWage('${w.id}')">⚙️</button>`;
    return `
    <div class="att-row" onclick="openWorkerCalendar('${w.id}')">
      <div class="att-who"><div class="user-avatar">${initials(w.name)}</div><div class="who-meta"><div class="n">${w.name}</div><div class="p">${w.trade}</div></div></div>
      <div class="col-late" style="display:flex;align-items:center;gap:8px">${statusHtml}${locBtn}</div>
      <div class="col-arrival arrival-edit" onclick="event.stopPropagation()">
        <input type="time" value="${w.expectedArrival}" onchange="saveArrival('${w.id}', this.value)">
      </div>
      <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
        <button class="btn-text" onclick="openWorkerCalendar('${w.id}')">View calendar ›</button>
        ${selfManageBtns}
        <button class="icon-btn danger" title="Remove labour" onclick="removeWorker('${w.id}', '${w.name.replace(/'/g, "\\'")}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openTaskModal(workerId, name) {
  document.getElementById('taskWorkerId').value = workerId;
  document.getElementById('taskWorkerName').textContent = 'For ' + name;
  openModal('assignTaskModal');
}

/* ============ MANAGE WORKER: wage rate + payments (self-managed projects) ============ */
function openWorkerWage(workerId) {
  const w = getDb().users.find(u => u.id === workerId);
  if (!w) return;
  const summary = wageSummary(w);
  const payments = paymentsForWorker(w.id);
  const body = document.getElementById('workerWageBody');
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
  `;

  document.getElementById('saveWageBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('editWage').value, 10);
    if (!val || val <= 0) { toast('Enter a valid wage.', 'error'); return; }
    updateWorkerWage(w.id, val);
    toast('Wage updated', 'success');
    openWorkerWage(w.id);
  });
  document.getElementById('savePaymentBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('paymentAmount').value, 10);
    if (!val || val <= 0) { toast('Enter a valid amount.', 'error'); return; }
    recordPayment(w.id, val);
    toast('Payment recorded', 'success');
    openWorkerWage(w.id);
    render();
  });

  openModal('workerWageModal');
}

function saveArrival(workerId, value) {
  updateWorkerArrival(workerId, value);
  toast('Arrival time updated', 'success', 1800);
}

function removeWorker(workerId, name) {
  if (!confirm(`Remove ${name} from ${project.name}? Their attendance and payment history will be deleted too — this can't be undone.`)) return;
  deleteWorker(workerId);
  toast(`${name} removed`, 'success');
  render();
}

/* ============ WORK & PROGRESS ============ */
function renderCategoryBars(liveProject, hasSupervisor) {
  if (sliderInteracting) return;
  const el = document.getElementById('categoryBars');
  if (hasSupervisor) {
    el.innerHTML = liveProject.categories.map(c => `
      <div class="slider-row">
        <div class="slider-top"><span>${c.name}</span><span class="pct">${c.percent}%</span></div>
        <div class="progress-track" style="width:100%"><div class="progress-fill" style="width:${c.percent}%"></div></div>
      </div>`).join('') + `<p class="text-muted" style="font-size:12.5px;margin-top:10px">Updated by your supervisor. Read-only here.</p>`;
  } else {
    el.innerHTML = liveProject.categories.map(c => `
      <div class="slider-row">
        <div class="slider-top"><span>${c.name}</span><span class="pct" id="pctval-${c.name.replace(/\s/g,'')}">${c.percent}%</span></div>
        <input type="range" min="0" max="100" value="${c.percent}"
          oninput="document.getElementById('pctval-${c.name.replace(/\s/g,'')}').textContent = this.value + '%'"
          onchange="updateCategory('${liveProject.id}','${c.name}', this.value)">
      </div>`).join('') + `<p class="text-muted" style="font-size:12.5px;margin-top:10px">Drag to update — this drives the site progress % shown across your dashboard.</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('categoryBars');
  if (el) el.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type="range"]')) sliderInteracting = true; });
  document.addEventListener('pointerup', () => { sliderInteracting = false; });
});

function updateCategory(projectId, catName, value) {
  updateProjectCategory(projectId, catName, parseInt(value, 10));
  toast(`${catName} updated to ${value}%`, 'success', 1800);
}

function renderTaskBoard(workers) {
  const tasks = tasksForProject(project.id, todayStr());
  const el = document.getElementById('taskBoard');
  if (!tasks.length) { el.innerHTML = `<div class="empty-state"><div class="glyph">📋</div>No work assigned for today yet.</div>`; return; }
  el.innerHTML = tasks.map(t => {
    const w = workers.find(u => u.id === t.workerId);
    return `<div class="task-board-row">
      <div><div class="who">${w ? w.name : 'Unknown'}</div><div class="task-title">${t.title}</div></div>
      <span class="badge ${t.status === 'done' ? 'green' : 'gray'}">${t.status === 'done' ? 'Completed' : 'Pending'}</span>
    </div>`;
  }).join('');
}

/* ============ SITE UPDATES ============ */
function logEntryHtml(l) {
  return `<div class="log-entry">
    <div class="meta">${l.date} · ${l.time}</div>
    ${l.feedback ? `<div class="feedback">${l.feedback}</div>` : ''}
    ${l.photos && l.photos.length ? `<div class="log-photos">${l.photos.map(p => `<img src="${p}">`).join('')}</div>` : ''}
  </div>`;
}
function renderLogHistory() {
  const logs = dailyLogsForProject(project.id);
  const el = document.getElementById('logHistory');
  el.innerHTML = logs.length ? logs.map(logEntryHtml).join('') : `<div class="empty-state"><div class="glyph">📸</div>No updates posted yet.</div>`;
}

/* ============ BUDGET / WAGES ============ */
function renderWageTable(workers, presentSet, lateMap) {
  const el = document.getElementById('wageTable');
  if (!workers.length) { el.innerHTML = `<div class="empty-state" style="padding:16px">No labour yet.</div>`; return; }
  el.innerHTML = workers.map(w => {
    const s = wageSummary(w);
    const workedToday = presentSet.has(w.id) || lateMap.has(w.id);
    return `<div class="detail-row">
      <span>${w.name} <span class="text-muted">(₹${w.wageRate}/day${workedToday ? ' · worked today' : ''})</span></span>
      <strong style="color:var(--success)">Owed ₹${s.balance.toLocaleString('en-IN')}</strong>
    </div>`;
  }).join('');
}

/* ============ BLUEPRINTS ============ */
function renderBlueprints() {
  const liveProject = getProjectById(project.id);
  const el = document.getElementById('blueprintList');
  el.innerHTML = liveProject.blueprints.length ? liveProject.blueprints.map(b => `
    <div class="blueprint-item">
      <button class="remove-x" onclick="removeBlueprint('${b.id}')">✕</button>
      <a href="${b.dataUrl}" target="_blank" rel="noopener">
        ${b.dataUrl.startsWith('data:image') ? `<img src="${b.dataUrl}">` : `<div class="pdf-icon">📄</div>`}
      </a>
      <div class="name">${b.name}</div>
    </div>`).join('') : `<p class="text-muted" style="margin-top:14px">No blueprints uploaded yet.</p>`;
}
function removeBlueprint(id) {
  if (!confirm('Remove this file?')) return;
  deleteBlueprint(project.id, id);
  toast('Blueprint removed', 'success');
  renderBlueprints();
}

/* ============ PER-WORKER CALENDAR ============ */
let calYear, calMonth, calWorkerId;
function openWorkerCalendar(workerId) {
  const w = getDb().users.find(u => u.id === workerId);
  if (!w) return;
  calWorkerId = workerId;
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  renderWorkerCalendar(w);
  openModal('workerCalModal');
}

function renderWorkerCalendar(w) {
  const stats = monthStats(w, calYear, calMonth);
  const cells = buildMonthCalendar(w, calYear, calMonth);
  const today = todayStr();
  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  document.getElementById('workerCalBody').innerHTML = `
    <h3>${w.name}'s Attendance</h3>
    <p class="text-muted" style="margin-bottom:16px">${w.trade} · +91 ${w.phone}</p>
    <div class="stat-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
      <div class="card mini-stat" style="padding:14px"><div class="label">Present</div><div class="value good">${stats.present}</div></div>
      <div class="card mini-stat" style="padding:14px"><div class="label">Late</div><div class="value warn">${stats.late}</div></div>
      <div class="card mini-stat" style="padding:14px"><div class="label">Absent</div><div class="value" style="color:var(--danger)">${stats.absent}</div></div>
    </div>
    <div class="panel-head"><h3>${monthLabel}</h3>
      <div style="display:flex;gap:8px">
        <button class="btn-text" onclick="calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderWorkerCalendar(getDb().users.find(u=>u.id==='${w.id}'))">‹</button>
        <button class="btn-text" onclick="calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderWorkerCalendar(getDb().users.find(u=>u.id==='${w.id}'))">›</button>
      </div>
    </div>
    <div class="cal-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
    <div class="cal-grid">
      ${cells.map(c => {
        if (!c) return `<div class="cal-cell empty"></div>`;
        const isToday = c.date === today ? ' today' : '';
        return `<div class="cal-cell ${c.status}${isToday}">${c.day}</div>`;
      }).join('')}
    </div>
    <div class="cal-legend">
      <span><i class="dot present"></i> Present</span>
      <span><i class="dot late"></i> Late</span>
      <span><i class="dot absent"></i> Absent</span>
    </div>`;
}