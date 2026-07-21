const builder = requireRole('builder');

function greetingName() {
  document.getElementById('builderFirstName').textContent = ', ' + builder.name.split(' ')[0];
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  renderUserChip(builder);
}
greetingName();

function render() {
  const projects = projectsForBuilder(builder.id);
  const supervisors = supervisorsForBuilder(builder.id);
  const allWorkers = projects.flatMap(p => workersForProject(p.id));
  const presentToday = projects.reduce((sum, p) => sum + todaysAttendance(p.id).length, 0);

  document.getElementById('statProjects').textContent = projects.length;
  document.getElementById('statSupervisors').textContent = supervisors.length;
  document.getElementById('statWorkers').textContent = allWorkers.length;
  document.getElementById('statPresent').textContent = presentToday;

  // Projects list
  const pList = document.getElementById('projectsList');
  if (!projects.length) {
    pList.innerHTML = `<div class="empty-state"><div class="glyph">🏗️</div>No projects yet. Create your first one.</div>`;
  } else {
    pList.innerHTML = projects.map(p => {
      const wcount = workersForProject(p.id).length;
      return `
      <div class="project-row clickable" onclick="location.href='project.html?id=${p.id}'">
        <div style="flex:1">
          <div class="pname">${p.name}</div>
          <div class="text-muted" style="font-size:13px">${p.location} · ${wcount} workers</div>
          <div class="progress-track"><div class="progress-fill" style="width:${p.progress}%"></div></div>
        </div>
        <div class="pct">${p.progress}%</div>
      </div>`;
    }).join('');
  }

  // Supervisors list
  const sList = document.getElementById('supervisorsList');
  if (!supervisors.length) {
    sList.innerHTML = `<div class="empty-state"><div class="glyph">👷</div>No supervisors added yet.</div>`;
  } else {
    sList.innerHTML = supervisors.map(s => {
      const names = s.projectIds.map(id => projects.find(p => p.id === id)?.name).filter(Boolean).join(', ');
      return `
      <div class="list-row">
        <div class="who">
          <div class="user-avatar">${initials(s.name)}</div>
          <div class="who-meta"><div class="n">${s.name}</div><div class="p">+91 ${s.phone} · ${names || 'No project assigned'}</div></div>
        </div>
        <div class="actions">
          <span class="badge blue">Supervisor</span>
          <button class="icon-btn danger" title="Remove from all your projects" onclick="removeSupervisor('${s.id}')">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  // Alerts (generated from live data so they feel real)
  const alerts = [];
  projects.forEach(p => {
    if (p.progress < 100 && workersForProject(p.id).length === 0) {
      alerts.push({ t: `${p.name} has no workers`, d: 'Ask the assigned supervisor to add labour', tone: 'info' });
    }
  });
  if (!supervisors.length && projects.length) {
    alerts.push({ t: 'No supervisors assigned', d: 'Add a supervisor so attendance can be tracked', tone: 'default' });
  }
  const alertsList = document.getElementById('alertsList');
  alertsList.innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert-item ${a.tone === 'info' ? 'info' : ''}"><div class="t">${a.t}</div><div class="d">${a.d}</div></div>`).join('')
    : `<div class="empty-state"><div class="glyph">✅</div>All clear.</div>`;
}
render();

function removeSupervisor(supervisorId) {
  if (!confirm('Remove this supervisor from all your projects? They will lose access immediately.')) return;
  const myProjectIds = projectsForBuilder(builder.id).map(p => p.id);
  removeSupervisorFromProjects(supervisorId, myProjectIds);
  toast('Supervisor removed', 'success');
  render();
}

document.getElementById('newProjectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('projName').value.trim();
  const location = document.getElementById('projLocation').value.trim();
  if (!name || !location) return;
  addProject({ name, location, builderId: builder.id });
  closeModal('newProjectModal');
  e.target.reset();
  toast('Project created', 'success');
  render();
});