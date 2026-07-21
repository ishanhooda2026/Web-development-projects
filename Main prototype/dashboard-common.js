function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

function renderUserChip(user) {
  const el = document.getElementById('userChip');
  if (!el) return;
  el.innerHTML = `
    <div class="user-avatar">${initials(user.name)}</div>
    <div class="user-meta">
      <div class="name">${user.name}</div>
      <div class="phone">+91 ${user.phone}</div>
    </div>`;
}

/* Shared by supervisor.js and project.js: shows where a worker actually was
   when they checked in, compared against the site's geofence pin. */
let _attLocMap = null;
function showAttendanceLocationModal(attendanceId) {
  const body = document.getElementById('attendanceLocationBody');
  if (!body) return;
  const att = attendanceById(attendanceId);
  if (!att) return;
  const w = getDb().users.find(u => u.id === att.userId);
  const status = locationStatusForAttendance(att);

  let html = `<h3>${w ? w.name : 'Worker'}'s Location</h3>
    <p class="text-muted" style="margin-bottom:16px">Checked in at ${att.time}${att.status === 'late' ? ' · marked late' : ''}</p>`;

  if (!status) {
    html += `<div class="empty-state" style="padding:24px"><div class="glyph">📍</div>Location wasn't captured for this check-in.</div>`;
    body.innerHTML = html;
    openModal('attendanceLocationModal');
    return;
  }

  if (!status.hasSitePin) {
    html += `<div class="empty-state" style="padding:24px"><div class="glyph">📍</div>No site location set yet — ask the supervisor to set it so check-ins can be compared against it.</div>`;
  } else {
    html += `
      <div class="detail-row"><span>Status</span><strong style="color:${status.onSite ? 'var(--success)' : 'var(--danger)'}">${status.onSite ? '✓ On Site' : '⚠️ Off Site'}</strong></div>
      <div class="detail-row"><span>Distance from site</span><strong>${status.distance}m</strong></div>
      <div class="detail-row"><span>Geofence radius</span><strong>${status.radius}m</strong></div>`;
  }
  html += `<div id="attendanceLocMap" style="height:240px;border-radius:14px;overflow:hidden;margin-top:14px"></div>`;
  body.innerHTML = html;
  openModal('attendanceLocationModal');

  if (typeof L === 'undefined') return;
  setTimeout(() => {
    if (_attLocMap) { _attLocMap.remove(); _attLocMap = null; }
    const map = L.map('attendanceLocMap').setView([status.location.lat, status.location.lng], 16);
    _attLocMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    const workerMarker = L.marker([status.location.lat, status.location.lng]).addTo(map).bindPopup('Check-in location');
    if (status.hasSitePin) {
      L.circle([status.siteLocation.lat, status.siteLocation.lng], { radius: status.radius, color: '#22d3ee', fillOpacity: 0.08 }).addTo(map);
      const siteMarker = L.marker([status.siteLocation.lat, status.siteLocation.lng]).addTo(map).bindPopup('Site location');
      const group = L.featureGroup([workerMarker, siteMarker]);
      map.fitBounds(group.getBounds().pad(0.35));
    }
  }, 50);
}