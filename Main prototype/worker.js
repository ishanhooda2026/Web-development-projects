const worker = requireRole('worker');
renderUserChip(worker);

const project = projectForWorker(worker);
let calYear, calMonth;
let locDone = false, selfieDone = false, qrDone = false;
let locCoords = null;
let mediaStream = null;
let qrScanRAF = null;

if (!project) {
  document.getElementById('noProjectState').classList.remove('hidden');
  document.getElementById('pageContent').classList.add('hidden');
} else {
  init();
}

function init() {
  document.getElementById('greetName').textContent = 'Hey, ' + worker.name.split(' ')[0];
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  // Sidebar section switching — always available regardless of check-in state
  document.querySelectorAll('.side-link[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.side-link[data-section]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.worker-section').forEach(s => s.classList.add('hidden'));
      document.querySelector(`[data-section-panel="${link.dataset.section}"]`).classList.remove('hidden');
    });
  });

  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();

  renderAttendanceState();
  renderCalendar();
  renderWage();
  renderTasks();
  renderProjectInfo();

  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  wireChecklistButtons();
  if (project.siteLocation) startGeofenceWatch();
}

/* ============ ATTENDANCE STATE (status card vs checklist) ============ */
function renderAttendanceState() {
  const attToday = attendanceForWorker(worker.id).find(a => a.date === todayStr());
  const statusCard = document.getElementById('todayStatusCard');
  const checklist = document.getElementById('checklistPanel');

  if (attToday) {
    statusCard.classList.remove('hidden');
    checklist.classList.add('hidden');
    const late = attToday.status === 'late';
    statusCard.classList.toggle('late', late);
    document.getElementById('statusIcon').textContent = late ? '⏰' : '✓';
    document.getElementById('statusTitle').textContent = late
      ? `You're marked present (late) today`
      : `You're marked present today`;
    document.getElementById('statusSub').textContent = `Checked in at ${attToday.time}${late && attToday.lateMinutes != null ? ` · late by ${attToday.lateMinutes}m` : ''}`;
  } else {
    statusCard.classList.add('hidden');
    checklist.classList.remove('hidden');
  }
}

/* ============ CHECKLIST: LOCATION / SELFIE / QR ============ */
function wireChecklistButtons() {
  document.getElementById('locBtn').addEventListener('click', () => {
    const btn = document.getElementById('locBtn');
    const sub = document.getElementById('locSub');
    if (!navigator.geolocation) {
      markTick('tickLoc', true);
      sub.textContent = 'Not supported on this device — skipped';
      locDone = true;
      maybeFinish();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Getting location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        markTick('tickLoc', true);
        sub.textContent = 'Location on';
        btn.textContent = '✓ Done';
        locDone = true;
        maybeFinish();
      },
      (err) => {
        btn.disabled = false;
        btn.textContent = 'Turn On';
        sub.textContent = "Couldn't get location — check permissions and try again.";
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  document.getElementById('selfieBtn').addEventListener('click', async () => {
    const btn = document.getElementById('selfieBtn');
    const sub = document.getElementById('selfieSub');
    const video = document.getElementById('selfieVideo');
    const box = document.getElementById('selfieBox');

    if (btn.dataset.mode === 'capture') {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById('selfiePreview').src = dataUrl;
      document.getElementById('selfiePreview').classList.remove('hidden');
      video.classList.add('hidden');
      stopStream();
      markTick('tickSelfie', true);
      sub.textContent = 'Captured';
      btn.textContent = '✓ Done';
      btn.disabled = true;
      selfieDone = true;
      setTimeout(() => box.classList.add('hidden'), 900);
      maybeFinish();
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      video.srcObject = mediaStream;
      box.classList.remove('hidden');
      video.classList.remove('hidden');
      document.getElementById('selfiePreview').classList.add('hidden');
      btn.textContent = 'Capture';
      btn.dataset.mode = 'capture';
      sub.textContent = 'Camera on — center your face and tap Capture';
    } catch (err) {
      sub.textContent = 'Camera access needed. Allow permission and try again.';
    }
  });

  document.getElementById('qrBtn').addEventListener('click', async () => {
    const btn = document.getElementById('qrBtn');
    const sub = document.getElementById('qrSub');
    const video = document.getElementById('qrVideo');
    const box = document.getElementById('qrBox');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = mediaStream;
      box.classList.remove('hidden');
      btn.classList.add('hidden');
      sub.textContent = 'Point the camera at the site QR code…';
      scanLoop(video, sub, box);
    } catch (err) {
      sub.textContent = 'Camera access needed, or check in manually below.';
    }
  });

  document.getElementById('skipQrBtn').addEventListener('click', () => {
    stopStream();
    markTick('tickQr', true);
    document.getElementById('qrSub').textContent = 'Checked in manually';
    qrDone = true;
    document.getElementById('qrBtn').classList.add('hidden');
    document.getElementById('skipQrBtn').classList.add('hidden');
    maybeFinish();
  });
}

function markTick(id, done) {
  const el = document.getElementById(id);
  if (done) { el.classList.add('done'); el.textContent = '✓'; }
}

function scanLoop(video, sub, box) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && typeof jsQR !== 'undefined') {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        stopStream();
        markTick('tickQr', true);
        sub.textContent = 'QR code scanned';
        qrDone = true;
        setTimeout(() => box.classList.add('hidden'), 600);
        document.getElementById('skipQrBtn').classList.add('hidden');
        maybeFinish();
        return;
      }
    }
    qrScanRAF = requestAnimationFrame(tick);
  }
  qrScanRAF = requestAnimationFrame(tick);
}

function stopStream() {
  if (qrScanRAF) cancelAnimationFrame(qrScanRAF);
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

/* ============ FINISH: once all 3 ticks are done, check in automatically ============ */
function maybeFinish() {
  if (locDone && selfieDone && qrDone) {
    const status = checkIn(worker.id, project.id, 'qr', locCoords);
    toast(status === 'late' ? "Checked in — marked late" : "Checked in!", 'success');
    renderAttendanceState();
    renderCalendar();
    if (locDone) startGeofenceWatch();
  }
}

/* ============ GEOFENCE ============ */
function startGeofenceWatch() {
  if (!project.siteLocation || !navigator.geolocation) return;
  navigator.geolocation.watchPosition((pos) => {
    const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, project.siteLocation.lat, project.siteLocation.lng);
    if (dist > project.geofenceRadius) {
      raiseGeofenceAlert(project.id, worker.id, `${worker.name} moved ${Math.round(dist)}m away from the site`);
    }
  }, () => {}, { enableHighAccuracy: false, maximumAge: 60000 });
}

/* ============ CALENDAR (always visible) ============ */
function renderCalendar() {
  const stats = monthStats(worker, calYear, calMonth);
  document.getElementById('statPresent').textContent = stats.present;
  document.getElementById('statLate').textContent = stats.late;
  document.getElementById('statAbsent').textContent = stats.absent;
  document.getElementById('statAllTime').textContent = attendanceForWorker(worker.id).filter(a => a.status === 'present' || a.status === 'late').length;

  document.getElementById('calMonthLabel').textContent = new Date(calYear, calMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const cells = buildMonthCalendar(worker, calYear, calMonth);
  const today = todayStr();
  document.getElementById('calGrid').innerHTML = cells.map(c => {
    if (!c) return `<div class="cal-cell empty"></div>`;
    const isToday = c.date === today ? ' today' : '';
    return `<div class="cal-cell ${c.status}${isToday}">${c.day}</div>`;
  }).join('');
}

/* ============ DETAILS: wage + tasks + project ============ */
function renderWage() {
  const w = wageSummary(worker);
  document.getElementById('wDays').textContent = w.allTimeDaysWorked;
  document.getElementById('wRate').textContent = '₹' + w.wageRate;
  document.getElementById('wGross').textContent = '₹' + w.gross.toLocaleString('en-IN');
  document.getElementById('wPaid').textContent = '₹' + w.paid.toLocaleString('en-IN');
  document.getElementById('wBalance').textContent = '₹' + w.balance.toLocaleString('en-IN');
}

function renderTasks() {
  const tasks = tasksForWorker(worker.id, todayStr());
  const el = document.getElementById('tasksList');
  el.innerHTML = tasks.length
    ? tasks.map(t => `<div class="task-row ${t.status === 'done' ? 'done' : ''}"><span class="task-check ${t.status === 'done' ? 'checked' : ''}"></span><span>${t.title}</span></div>`).join('')
    : `<div class="empty-state" style="padding:20px"><div class="glyph">📋</div>No tasks assigned for today yet.</div>`;
}

function renderProjectInfo() {
  document.getElementById('projectInfo').innerHTML = `
    <div class="project-row">
      <div>
        <div class="pname">${project.name}</div>
        <div class="text-muted" style="font-size:13px">${project.location}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${project.progress}%"></div></div>
      </div>
      <div class="pct">${project.progress}%</div>
    </div>`;
}