// PRAMEYA 1.0 frontend connected to the Express API.
// These pages must be served by the Express app: opened straight from disk the browser is on
// file://, where fetch() to /api is blocked and every login/registration fails with "Failed to
// fetch". Hand off to the local dev server so the app works however it was opened.
if (location.protocol === 'file:') {
  const page = location.pathname.split(/[\\/]/).pop() || 'index.html';
  location.replace(`http://localhost:3000/${page}${location.search}${location.hash}`);
}

const $ = (s, root = document) => root.querySelector(s);
const API = '/api';

const menuToggle = $('.menu-toggle');
if (menuToggle) menuToggle.addEventListener('click', () => $('.nav-links')?.classList.toggle('open'));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function showMessage(target, message, isError = false) {
  if (!target) return;
  target.hidden = false;
  target.textContent = message;
  target.style.color = isError ? '#ff9292' : '';
}
function fetchError(error) {
  if (location.protocol === 'file:') {
    return 'This page was opened from a local file, so it cannot reach the API. Run "npm start" and open http://localhost:3000/admin.html instead.';
  }
  if (error instanceof TypeError) {
    return `${error.message} — the page could not reach ${location.origin}/api. Start the server with "npm start" and try again.`;
  }
  return error.message;
}

// --- Registration form (team + member details) ---
const form = $('#registrationForm');
if (form) {
  const membersContainer = $('#membersContainer');
  const addMemberBtn = $('#addMemberBtn');
  const teamNameLabel = $('#teamNameLabel');
  const teamNameInput = $('#teamName');
  const teamNameRequiredMark = $('#teamNameRequiredMark');
  const collegeInput = $('#collegeName');
  const selectedEventName = $('#selectedEventName');

  // Per-event registration shape: how many participants an event takes, and whether the team
  // name field is shown and mandatory. Both individual events take one participant but still
  // collect a team name; every other event takes up to two members and requires a team name.
  const EVENT_RULES = {
    'IT Manager': { maxMembers: 1, showTeamName: true, requireTeamName: false },
    'Reel Making': { maxMembers: 1, showTeamName: true, requireTeamName: false }
  };
  const DEFAULT_RULE = { maxMembers: 2, showTeamName: true, requireTeamName: true };
  const slugMap = { coding:'Coding', 'web-design':'Web Designing', 'pitch-tank':'Pitch Tank', 'it-quiz':'IT Quiz', 'it-manager':'IT Manager', 'reel-making':'Reel Making' };

  const slug = new URLSearchParams(location.search).get('event');
  const currentEvent = slug && slugMap[slug] ? slugMap[slug] : '';

  if (!currentEvent) {
    location.href = 'events.html';
  } else {
    if (selectedEventName) selectedEventName.textContent = currentEvent;

    const rule = EVENT_RULES[currentEvent] || DEFAULT_RULE;

    function maxMembers() { return rule.maxMembers; }

    function createMemberRow(name = '', phone = '') {
      const row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML = `
        <input class="member-name" type="text" placeholder="Full name" value="${escapeHtml(name)}" required>
        <input class="member-phone" type="tel" placeholder="Phone" value="${escapeHtml(phone)}" required>`;
      return row;
    }

    function syncForm() {
      if (teamNameLabel) teamNameLabel.hidden = !rule.showTeamName;
      if (teamNameInput) teamNameInput.required = rule.requireTeamName;
      if (teamNameRequiredMark) teamNameRequiredMark.hidden = !rule.requireTeamName;

      let rows = [...membersContainer.querySelectorAll('.member-row')];
      while (rows.length > maxMembers()) {
        rows[rows.length - 1].remove();
        rows = [...membersContainer.querySelectorAll('.member-row')];
      }
      if (!rows.length) membersContainer.appendChild(createMemberRow());

      const count = membersContainer.querySelectorAll('.member-row').length;
      if (addMemberBtn) addMemberBtn.hidden = count >= maxMembers();
    }

    addMemberBtn?.addEventListener('click', () => {
      if (membersContainer.querySelectorAll('.member-row').length >= maxMembers()) return;
      membersContainer.appendChild(createMemberRow());
      syncForm();
    });

    membersContainer.appendChild(createMemberRow());
    syncForm();

    // The organizers can close registration for every event. The server refuses new entries;
    // the form shows the closed window and stops the button from looking usable.
    let registrationLocked = false;
    const lockedNotice = $('#registrationClosed');
    const submitButton = form.querySelector('button[type="submit"]');

    function paintRegistrationWindow() {
      if (lockedNotice) lockedNotice.hidden = !registrationLocked;
      if (submitButton) {
        submitButton.disabled = registrationLocked;
        submitButton.textContent = registrationLocked ? 'Registration closed' : 'Submit Registration';
      }
    }

    fetch(`${API}/settings`)
      .then(response => response.json())
      .then(settings => { registrationLocked = !!settings.registrationLocked; paintRegistrationWindow(); })
      .catch(() => {});

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const box = $('#successBox');
      const button = form.querySelector('button[type="submit"]');
      const members = [...membersContainer.querySelectorAll('.member-row')].map(row => ({
        name: row.querySelector('.member-name').value.trim(),
        phone: row.querySelector('.member-phone').value.trim()
      }));

      const payload = {
        eventName: currentEvent,
        teamName: rule.showTeamName && teamNameInput ? teamNameInput.value.trim() : '',
        collegeName: collegeInput ? collegeInput.value.trim() : '',
        members
      };

      button.disabled = true;
      button.textContent = 'Submitting…';
      box.hidden = true;

      try {
        const response = await fetch(`${API}/registrations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Registration failed.');
        box.hidden = false;
        box.innerHTML = `<span class="success-mark">✓</span><div><b>Registration submitted successfully!</b><p>Your registration ID is <strong>${escapeHtml(result.registrationId)}</strong>. Please save it for reference.</p></div>`;
        form.reset();
        membersContainer.innerHTML = '';
        membersContainer.appendChild(createMemberRow());
        syncForm();
        window.scrollTo({ top: box.getBoundingClientRect().top + window.scrollY - 110, behavior: 'smooth' });
      } catch (error) {
        box.hidden = false;
        box.innerHTML = `<span class="success-mark">!</span><div><b>Registration could not be submitted</b><p>${escapeHtml(fetchError(error))}</p></div>`;
      } finally {
        paintRegistrationWindow();
      }
    });
  }
}

// --- Secure console: organizers and coordinators share one login page ---
const consoleRoot = $('#consoleRoot');
if (consoleRoot) {
  const loginPanel = $('#adminLoginPanel');
  const loginForm = $('#adminLoginForm');
  const loginMessage = $('#adminLoginMessage');
  const adminDashboard = $('#adminDashboard');
  const coordinatorDashboard = $('#coordinatorDashboard');
  const tokenKey = 'prameyaConsoleToken';
  let token = localStorage.getItem(tokenKey);

  // Organizer view
  const rows = $('#registrationRows');
  const filter = $('#filterEvent');
  const coordinatorForm = $('#coordinatorForm');
  const coordinatorList = $('#coordinatorList');
  const coordinatorCount = $('#coordinatorCount');
  const coordinatorFormMessage = $('#coordinatorFormMessage');
  const resultRows = $('#resultRows');
  const resultSummaryEl = $('#resultSummary');
  const resultNote = $('#resultNote');
  const toggleLock = $('#toggleRegistrationLock');
  const lockState = $('#lockState');
  const lockMessage = $('#lockMessage');
  let registrations = [];
  let resultSummary = { events: [], uploaded: 0, total: 0 };
  let roundsController = null;

  // Coordinator view
  const coordRows = $('#coordinatorRows');
  const eventLabel = $('#coordinatorEvent');
  const coordTotalCount = $('#coordinatorTotalCount');
  let coordRegistrations = [];
  let currentEvent = '';

  // Coordinator sections live on one page: a navigation bar swaps the panels.
  const consoleTabs = [...document.querySelectorAll('.console-tab')];
  const consolePanels = { students: $('#studentsPanel'), rounds: $('#roundsPanel') };
  function showConsolePanel(name) {
    consoleTabs.forEach(tab => {
      const on = tab.dataset.panel === name;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.entries(consolePanels).forEach(([key, panel]) => { if (panel) panel.hidden = key !== name; });
  }
  consoleTabs.forEach(tab => tab.addEventListener('click', () => showConsolePanel(tab.dataset.panel)));

  function apiFetch(path, options = {}) {
    return fetch(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  }

  // ----- Organizer dashboard -----
  function downloadCsv(data) {
    if (!data.length) { alert('No registrations to export.'); return; }
    const headers = ['id','event','teamName','college','member1Name','member1Phone','member2Name','member2Phone','createdAt'];
    const cell = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const csvRows = data.map(item => [
      item.id, item.event, item.teamName || '', item.college,
      item.members[0]?.name || '', item.members[0]?.phone || '',
      item.members[1]?.name || '', item.members[1]?.phone || '',
      item.createdAt
    ]);
    const csv = [headers.join(','), ...csvRows.map(r => r.map(cell).join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'prameya-registrations.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Opens a print-ready page for any report and hands off to the browser's Save as PDF dialog.
  function openPrintReport({ reportTitle, heading, meta, tableHtml }) {
    const report = window.open('', '_blank');
    if (!report) { alert('Allow pop-ups for this site to export as PDF.'); return; }
    report.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(reportTitle)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:26px 30px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:18px}
  .head span{display:block;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#666}
  h1{font-size:21px;margin:6px 0 0}
  .meta{font-size:11px;color:#555;text-align:right;white-space:nowrap}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#333;border-bottom:1px solid #999;padding:9px 8px}
  td{font-size:12px;padding:10px 8px;border-bottom:1px solid #e2e2e2;vertical-align:top}
  td small,.member{display:block;line-height:1.5}
  td small{color:#666;font-size:10px;margin-top:3px}
  footer{margin-top:22px;font-size:10px;color:#777;border-top:1px solid #e2e2e2;padding-top:10px}
  @page{margin:14mm}
</style></head>
<body>
  <div class="head">
    <div><span>PRAMEYA 1.0 &mdash; IT Battle</span><h1>${escapeHtml(heading)}</h1></div>
    <div class="meta">${meta}</div>
  </div>
  ${tableHtml}
  <footer>Shree Devi Institute of Technology &middot; MCA Department &middot; Technical Club &mdash; MEDHA &copy; 2026</footer>
</body></html>`);
    report.document.close();
    report.focus();
    setTimeout(() => report.print(), 350);
  }

  function exportResultsPdf() {
    const events = resultSummary.events;
    if (!events.length) {
      alert('There are no events to export yet.');
      return;
    }
    // Line 1 is the team name; line 2 lists every member name. Individual events have no team
    // name, so the member name is shown once on the top line and once on the member line.
    const entry = (team, name, members) => {
      const people = (members || []).filter(Boolean);
      const heading = team || name || '';
      if (!heading) return '—';
      return `<b>${escapeHtml(heading)}</b>${people.length ? `<small>${escapeHtml(people.join(', '))}</small>` : ''}`;
    };
    const rows = events.map(r => `<tr>
        <td>${escapeHtml(r.event)}</td>
        <td>${entry(r.winnerTeam, r.winnerName, r.winnerMembers)}</td>
        <td>${entry(r.runnerTeam, r.runnerName, r.runnerMembers)}</td>
        <td>${escapeHtml(r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '')}</td>
      </tr>`).join('');
    openPrintReport({
      reportTitle: 'PRAMEYA 1.0 - Overall Event Results',
      heading: 'Overall Event Results',
      meta: `Generated ${escapeHtml(new Date().toLocaleString())}<br>${events.length} event${events.length === 1 ? '' : 's'}`,
      tableHtml: `<table><thead><tr><th>Event</th><th>Winner</th><th>Runner-up</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>`
    });
  }

  // Coordinator console: the students registered for the coordinator's own event.
  function exportStudentsPdf() {
    if (!coordRegistrations.length) {
      alert('There are no registered students to export yet.');
      return;
    }
    const rows = coordRegistrations.map((item, index) => {
      const who = item.teamName || (item.members[0] ? item.members[0].name : '');
      const names = (item.members || []).map(m => `<span class="member">${escapeHtml(m.name)}</span>`).join('');
      const phones = (item.members || []).map(m => `<span class="member">${escapeHtml(m.phone)}</span>`).join('');
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.id)}</td>
        <td><b>${escapeHtml(who)}</b></td>
        <td>${escapeHtml(item.college)}</td>
        <td>${names}</td>
        <td>${phones}</td>
      </tr>`;
    }).join('');
    const eventName = currentEvent || 'Event';
    openPrintReport({
      reportTitle: `PRAMEYA 1.0 - ${eventName} Registered Students`,
      heading: `${eventName} — Registered Students`,
      meta: `Generated ${escapeHtml(new Date().toLocaleString())}<br>${coordRegistrations.length} entr${coordRegistrations.length === 1 ? 'y' : 'ies'}`,
      tableHtml: `<table><thead><tr><th>S.No</th><th>Reg ID</th><th>Participant</th><th>College</th><th>Member Name</th><th>Contact Number</th></tr></thead><tbody>${rows}</tbody></table>`
    });
  }

  function renderRows() {
    if (!rows) return;
    const chosen = filter ? filter.value : '';
    const data = registrations.filter(item => !chosen || item.event === chosen);
    const total = $('#totalCount');
    if (total) total.textContent = registrations.length;
    if (!data.length) {
      rows.innerHTML = '<tr><td colspan="8" class="empty-state">No registrations match this filter.</td></tr>';
      return;
    }
    rows.innerHTML = data.map((item, index) => {
      const teamLabel = item.teamName || (item.members[0] ? item.members[0].name : '');
      const namesHtml = (item.members || []).map(m => `<div class="member-line">${escapeHtml(m.name)}</div>`).join('');
      const phonesHtml = (item.members || []).map(m => `<div class="member-line">${escapeHtml(m.phone)}</div>`).join('');
      return `<tr>
        <td><span class="row-no">${index + 1}</span></td>
        <td><span class="reg-id">${escapeHtml(item.id)}</span></td>
        <td><b>${escapeHtml(teamLabel)}</b></td>
        <td>${escapeHtml(item.college)}</td>
        <td><span class="table-tag">${escapeHtml(item.event)}</span></td>
        <td>${namesHtml}</td>
        <td>${phonesHtml}</td>
        <td><button type="button" class="btn btn-delete" data-delete-registration="${escapeHtml(item.id)}">Delete</button></td>
      </tr>`;
    }).join('');
  }

  async function loadCoordinators() {
    if (!coordinatorList) return;
    try {
      const response = await apiFetch('/admin/coordinators');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load coordinators.');
      const coordinators = result.coordinators || [];
      if (coordinatorCount) coordinatorCount.textContent = coordinators.length;
      if (!coordinators.length) {
        coordinatorList.innerHTML = '<tr><td colspan="4" class="empty-state">No coordinators yet.</td></tr>';
        return;
      }
      coordinatorList.innerHTML = coordinators.map(c => `<tr>
        <td><span class="reg-id">${escapeHtml(c.username)}</span></td>
        <td><span class="table-tag">${escapeHtml(c.eventName || '—')}</span></td>
        <td>${escapeHtml(c.createdAt ? new Date(c.createdAt).toLocaleString() : '')}</td>
        <td><button type="button" class="btn btn-delete" data-delete-coordinator="${escapeHtml(String(c.id))}">Delete</button></td>
      </tr>`).join('');
    } catch (error) {
      coordinatorList.innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function renderResultRows() {
    if (!resultRows) return;
    const { events, uploaded, total } = resultSummary;
    const allDone = total > 0 && uploaded === total;
    if (resultSummaryEl) resultSummaryEl.textContent = total ? `${uploaded} / ${total} EVENT${total === 1 ? '' : 'S'} UPLOADED` : '—';
    if (resultNote) resultNote.textContent = allDone
      ? 'All final results are in. Export the results as a PDF.'
      : `Export the current results any time (${uploaded} of ${total} done).`;

    if (!events.length) {
      resultRows.innerHTML = '<tr><td colspan="6" class="empty-state">No events found.</td></tr>';
      return;
    }
    resultRows.innerHTML = events.map((item, index) => {
      const done = item.status === 'completed';
      return `<tr>
        <td><span class="row-no">${index + 1}</span></td>
        <td><span class="table-tag">${escapeHtml(item.event)}</span></td>
        <td><span class="status-tag is-${done ? 'completed' : 'pending'}">${done ? 'Completed' : 'Pending'}</span></td>
        <td>${done ? `<b>${escapeHtml(item.winnerName)}</b>` : '—'}</td>
        <td>${done && item.runnerName ? `<b>${escapeHtml(item.runnerName)}</b>` : '—'}</td>
        <td>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—')}</td>
      </tr>`;
    }).join('');
  }

  async function loadResults() {
    if (!resultRows) return;
    try {
      const response = await apiFetch('/admin/results');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load results.');
      resultSummary = {
        events: result.events || [],
        uploaded: result.uploaded || 0,
        total: result.total || 0
      };
      renderResultRows();
    } catch (error) {
      if (resultRows) resultRows.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadAdmin() {
    if (rows) {
      const response = await apiFetch('/admin/registrations');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load registrations.');
      registrations = result.registrations || [];
      renderRows();
    }
    const tasks = [];
    if (coordinatorList) tasks.push(loadCoordinators());
    if (resultRows) tasks.push(loadResults());
    if (toggleLock) tasks.push(loadRegistrationWindow());
    await Promise.all(tasks);
    adminDashboard.hidden = false;
  }

  // ----- Registration window: close or open new entries for every event at once -----
  let registrationLocked = false;

  function paintLock() {
    if (lockState) lockState.textContent = registrationLocked ? 'LOCKED' : 'OPEN';
    if (toggleLock) toggleLock.textContent = registrationLocked ? 'Unlock registration' : 'Lock registration';
  }

  async function loadRegistrationWindow() {
    try {
      const response = await apiFetch('/settings');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the registration window.');
      registrationLocked = !!result.registrationLocked;
      paintLock();
    } catch (error) {
      showMessage(lockMessage, error.message, true);
    }
  }

  toggleLock?.addEventListener('click', async () => {
    if (toggleLock.classList.contains('is-saving')) return;
    const next = !registrationLocked;
    toggleLock.disabled = true;
    toggleLock.classList.add('is-saving');
    toggleLock.textContent = next ? 'Locking…' : 'Unlocking…';
    lockMessage.hidden = true;
    try {
      const response = await apiFetch('/admin/registration-lock', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: next })
      });
      const result = await response.json();
      if (response.status === 401) { logout('Your session has expired. Please log in again.'); return; }
      if (!response.ok) throw new Error(result.error || 'Could not update the registration window.');
      registrationLocked = !!result.registrationLocked;
      toggleLock.classList.remove('is-saving');
      toggleLock.classList.add('is-saved');
      paintLock();
      showMessage(lockMessage, result.message || 'Registration window updated.');
      setTimeout(() => {
        toggleLock.classList.remove('is-saved');
        toggleLock.disabled = false;
      }, 1600);
    } catch (error) {
      toggleLock.classList.remove('is-saving');
      toggleLock.disabled = false;
      paintLock();
      showMessage(lockMessage, error.message, true);
    }
  });

  // ----- Coordinator dashboard -----
  function renderCoordRows() {
    eventLabel.textContent = currentEvent || '—';
    coordTotalCount.textContent = coordRegistrations.length;
    if (!coordRegistrations.length) {
      coordRows.innerHTML = '<tr><td colspan="6" class="empty-state">No registrations for your event yet.</td></tr>';
      return;
    }
    coordRows.innerHTML = coordRegistrations.map((item, index) => {
      const who = item.teamName || (item.members[0] ? item.members[0].name : '');
      const namesHtml = (item.members || []).map(m => `<div class="member-line">${escapeHtml(m.name)}</div>`).join('');
      const phonesHtml = (item.members || []).map(m => `<div class="member-line">${escapeHtml(m.phone)}</div>`).join('');
      return `<tr>
        <td><span class="row-no">${index + 1}</span></td>
        <td><span class="reg-id">${escapeHtml(item.id)}</span></td>
        <td><b>${escapeHtml(who)}</b></td>
        <td>${escapeHtml(item.college)}</td>
        <td>${namesHtml}</td>
        <td>${phonesHtml}</td>
      </tr>`;
    }).join('');
  }

  async function reloadCoordinatorRegistrations() {
    const response = await apiFetch('/coordinator/registrations');
    if (!response.ok) return;
    const result = await response.json();
    coordRegistrations = result.registrations || [];
    renderCoordRows();
  }

  async function loadCoordinator() {
    const response = await apiFetch('/coordinator/registrations');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load registrations.');
    coordRegistrations = result.registrations || [];
    currentEvent = result.eventName || '';
    renderCoordRows();
    coordinatorDashboard.hidden = false;
    if (!roundsController) {
      roundsController = createRoundsController({
        getToken: () => token,
        onUnauthorized: () => logout('Your session has expired. Please log in again.'),
        onTeamsChange: reloadCoordinatorRegistrations
      });
    }
    await roundsController?.load();
  }

  async function enterDashboard(role) {
    if (role === 'admin') { await loadAdmin(); return; }
    if (coordinatorDashboard) { await loadCoordinator(); return; }
    location.replace('admin.html');
  }

  // ----- Session routing -----
  function showLogin(message, isError) {
    loginPanel.hidden = false;
    adminDashboard.hidden = true;
    coordinatorDashboard.hidden = true;
    if (message) showMessage(loginMessage, message, isError);
  }

  function resetLists() {
    registrations = []; coordRegistrations = []; resultSummary = { events: [], uploaded: 0, total: 0 };
    if (rows) rows.innerHTML = '<tr><td colspan="8" class="empty-state">Log in to view registrations.</td></tr>';
    if (coordRows) coordRows.innerHTML = '<tr><td colspan="6" class="empty-state">Log in to view registrations.</td></tr>';
    if (coordinatorList) coordinatorList.innerHTML = '<tr><td colspan="4" class="empty-state">Log in to view coordinators.</td></tr>';
    if (resultRows) resultRows.innerHTML = '<tr><td colspan="6" class="empty-state">Log in to view results.</td></tr>';
    if (resultSummaryEl) resultSummaryEl.textContent = '—';
    if (resultNote) resultNote.textContent = 'Export the current winner and runner-up for every event as a PDF.';
    showConsolePanel('students');
    const roundRows = $('#roundRows');
    if (roundRows) roundRows.innerHTML = '<tr><td colspan="4" class="empty-state">Log in to view rounds.</td></tr>';
  }

  function logout(message) {
    localStorage.removeItem(tokenKey);
    token = '';
    resetLists();
    showLogin(message);
  }

  async function route() {
    if (!token) { showLogin(); return; }
    try {
      const response = await apiFetch('/me');
      const me = await response.json();
      if (response.status === 401) { logout('Your session has expired. Please log in again.'); return; }
      if (!response.ok) throw new Error(me.error || 'Could not verify your session.');
      loginPanel.hidden = true;
      await enterDashboard(me.role);
    } catch (error) {
      logout(`${error.message} Check that the backend is running.`);
    }
  }

  if (loginForm) loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch(`${API}/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.elements.username.value, password: loginForm.elements.password.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Login failed.');
      token = result.token;
      localStorage.setItem(tokenKey, token);
      loginMessage.hidden = true;
      loginForm.reset();
      loginPanel.hidden = true;
      await enterDashboard(result.role);
    } catch (error) { showLogin(fetchError(error), true); }
    finally { submit.disabled = false; }
  });

  // ----- Organizer actions -----
  filter?.addEventListener('change', renderRows);
  $('#exportCsv')?.addEventListener('click', () => {
    const chosen = filter ? filter.value : '';
    downloadCsv(registrations.filter(item => !chosen || item.event === chosen));
  });
  $('#exportResultsPdf')?.addEventListener('click', exportResultsPdf);
  $('#exportStudentsPdf')?.addEventListener('click', exportStudentsPdf);

  rows?.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-registration]');
    if (!button) return;
    const registrationId = button.dataset.deleteRegistration;
    if (!confirm(`Delete registration ${registrationId}? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      const response = await apiFetch(`/admin/registrations/${encodeURIComponent(registrationId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (response.status === 401) { logout('Your session has expired. Please log in again.'); return; }
      if (!response.ok) throw new Error(result.error || 'Could not delete registration.');
      registrations = registrations.filter(item => item.id !== registrationId);
      renderRows();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = 'Delete';
    }
  });

  coordinatorForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!coordinatorForm.reportValidity()) return;
    const submit = coordinatorForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await apiFetch('/admin/coordinators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: coordinatorForm.elements.username.value.trim(),
          password: coordinatorForm.elements.password.value,
          eventName: coordinatorForm.elements.eventName.value
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create coordinator.');
      coordinatorForm.reset();
      showMessage(coordinatorFormMessage, result.message || 'Coordinator created.');
      await loadCoordinators();
    } catch (error) { showMessage(coordinatorFormMessage, error.message, true); }
    finally { submit.disabled = false; }
  });

  coordinatorList?.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-coordinator]');
    if (!button) return;
    if (!confirm('Delete this coordinator account? They lose access immediately.')) return;
    button.disabled = true; button.textContent = 'Deleting…';
    try {
      const response = await apiFetch(`/admin/coordinators/${encodeURIComponent(button.dataset.deleteCoordinator)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete coordinator.');
      await loadCoordinators();
    } catch (error) { alert(error.message); button.disabled = false; button.textContent = 'Delete'; }
  });

  $('#adminLogout')?.addEventListener('click', () => logout('You have logged out.'));
  $('#coordinatorLogout')?.addEventListener('click', () => logout('You have logged out.'));

  route();
}

// --- Event coordinator: rounds (marks + qualification) ---
// Mounted inside the coordinator dashboard so the students list and the judging
// rounds share one page; the console block calls this after a coordinator logs in.
function createRoundsController({ getToken, onUnauthorized, onTeamsChange }) {
  const roundTabs = $('#roundTabs');
  if (!roundTabs) return null;
  const eventLabel = $('#coordinatorEvent');
  const teamCount = $('#roundsTeamCount');
  const roundRows = $('#roundRows');
  const roundTitle = $('#roundTitle');
  const roundHint = $('#roundHint');
  const qualifyHeader = $('#qualifyHeader');
  const submitMarks = $('#submitMarks');
  const saveQualifiers = $('#saveQualifiers');
  const roundMessage = $('#roundMessage');
  const banner = $('#roundBanner');
  const winnerName = $('#winnerName');
  const runnerName = $('#runnerName');
  let currentRound = 1;
  let rounds = ['', '', ''];
  let entries = [];
  let marksSubmitted = false;
  let editingCode = null;

  function isFinalRound() {
    return currentRound === rounds.length;
  }

  function roundName(number) {
    return rounds[number - 1] || '';
  }

  function paintTabs() {
    [...roundTabs.querySelectorAll('.round-tab')].forEach(tab => {
      const number = Number(tab.dataset.round);
      const name = roundName(number);
      tab.hidden = number > rounds.length;
      tab.textContent = name ? `Round ${number} · ${name}` : `Round ${number}`;
      tab.classList.toggle('active', number === currentRound);
    });
  }

  function roundsApi(path, options = {}) {
    return fetch(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${getToken()}` } });
  }

  function showBanner(decision) {
    if (decision && decision.winnerCode) {
      winnerName.textContent = decision.winnerName || '—';
      runnerName.textContent = decision.runnerName || '—';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  function renderRound() {
    const final = isFinalRound();
    const showQualify = marksSubmitted && !final;
    teamCount.textContent = entries.length;
    const name = roundName(currentRound);
    roundTitle.textContent = name ? `ROUND ${currentRound} · ${name.toUpperCase()}` : `ROUND ${currentRound}`;
    roundHint.textContent = final
      ? 'Submit marks to decide the winner'
      : (showQualify ? 'Select who qualifies, then save' : 'Enter marks, then submit');
    qualifyHeader.hidden = !showQualify;
    saveQualifiers.hidden = !showQualify;

    if (!entries.length) {
      const empty = currentRound === 1
        ? 'No registrations for your event yet.'
        : `No teams qualified from Round ${currentRound - 1} yet.`;
      roundRows.innerHTML = `<tr><td colspan="${showQualify ? 5 : 4}" class="empty-state">${escapeHtml(empty)}</td></tr>`;
      return;
    }

    roundRows.innerHTML = entries.map((team, index) => {
      const label = team.teamName || (team.members[0] ? team.members[0].name : team.code);
      const members = (team.members || []).map(m => `<small>${escapeHtml(m.name)} · ${escapeHtml(m.phone)}</small>`).join('');
      const marks = team.marks === null ? '' : team.marks;
      const editing = team.code === editingCode;
      const qualifyCell = showQualify
        ? `<td><input type="checkbox" class="qualify-box" value="${escapeHtml(team.code)}"${team.qualified ? ' checked' : ''}></td>`
        : '';
      const actionCell = editing
        ? `<td class="row-actions"><button type="button" class="btn btn-primary" data-save="${escapeHtml(team.code)}">Save</button><button type="button" class="btn btn-ghost" data-cancel="${escapeHtml(team.code)}">Cancel</button></td>`
        : `<td class="row-actions"><button type="button" class="btn btn-edit" data-edit="${escapeHtml(team.code)}">Edit</button><button type="button" class="btn btn-delete" data-delete="${escapeHtml(team.code)}">Delete</button></td>`;
      return `<tr data-code="${escapeHtml(team.code)}"${editing ? ' class="row-editing"' : ''}>
        <td><span class="row-no">${index + 1}</span></td>
        <td><b>${escapeHtml(label)}</b>${members}</td>
        <td><input type="number" step="any" min="0" class="marks-input" value="${escapeHtml(String(marks))}" placeholder="—" aria-label="Marks for ${escapeHtml(label)}"></td>
        ${qualifyCell}
        ${actionCell}
      </tr>`;
    }).join('');
  }

  async function loadRound(round, revealQualify = false) {
    currentRound = round;
    marksSubmitted = revealQualify;
    editingCode = null;
    roundMessage.hidden = true;
    banner.hidden = true;
    submitMarks.disabled = true;
    roundRows.innerHTML = '<tr><td colspan="4" class="empty-state">Loading round…</td></tr>';
    try {
      const response = await roundsApi(`/coordinator/rounds?round=${round}`);
      const result = await response.json();
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(result.error || 'Could not load this round.');
      entries = result.entries || [];
      if (result.eventName) eventLabel.textContent = result.eventName;
      if (Array.isArray(result.rounds) && result.rounds.length) rounds = result.rounds;
      paintTabs();
      renderRound();
      if (isFinalRound()) showBanner(result.decision);
    } catch (error) {
      roundRows.innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
    } finally {
      submitMarks.disabled = false;
    }
  }

  roundTabs.addEventListener('click', event => {
    const tab = event.target.closest('.round-tab');
    if (!tab) return;
    [...roundTabs.querySelectorAll('.round-tab')].forEach(item => item.classList.toggle('active', item === tab));
    loadRound(Number(tab.dataset.round));
  });

  // Per-row Edit / Save / Cancel / Delete in the rounds table.
  roundRows.addEventListener('click', async event => {
    const row = event.target.closest('tr[data-code]');
    if (!row) return;
    const code = row.dataset.code;

    if (event.target.closest('[data-edit]')) {
      editingCode = code;
      renderRound();
      const input = roundRows.querySelector('tr.row-editing .marks-input');
      if (input) { input.focus(); input.select(); }
      return;
    }

    if (event.target.closest('[data-cancel]')) {
      editingCode = null;
      renderRound();
      return;
    }

    const saveButton = event.target.closest('[data-save]');
    if (saveButton) {
      const marks = row.querySelector('.marks-input').value.trim();
      if (marks === '') { showMessage(roundMessage, 'Type the mark first, or press Cancel.', true); return; }
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
      try {
        const response = await roundsApi(`/coordinator/rounds/${currentRound}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: [{ code, marks }] })
        });
        const result = await response.json();
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok) throw new Error(result.error || 'Could not save the mark.');
        await loadRound(currentRound, marksSubmitted);
        showMessage(roundMessage, 'Mark updated for this team.');
      } catch (error) {
        showMessage(roundMessage, error.message, true);
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
      }
      return;
    }

    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) {
      const label = row.querySelector('td:nth-child(2) b')?.textContent || code;
      if (!confirm(`Delete "${label}"? This removes the team, its marks and its results permanently.`)) return;
      deleteButton.disabled = true;
      deleteButton.textContent = 'Deleting…';
      try {
        const response = await roundsApi(`/coordinator/registrations/${encodeURIComponent(code)}`, { method: 'DELETE' });
        const result = await response.json();
        if (response.status === 401) { onUnauthorized(); return; }
        if (!response.ok) throw new Error(result.error || 'Could not delete the team.');
        await loadRound(currentRound, marksSubmitted);
        await onTeamsChange?.();
        showMessage(roundMessage, 'Team deleted.');
      } catch (error) {
        showMessage(roundMessage, error.message, true);
        deleteButton.disabled = false;
        deleteButton.textContent = 'Delete';
      }
    }
  });

  submitMarks.addEventListener('click', async () => {
    const payload = [...roundRows.querySelectorAll('tr[data-code]')].map(row => ({
      code: row.dataset.code,
      marks: row.querySelector('.marks-input').value.trim()
    })).filter(item => item.marks !== '');
    if (!payload.length) { showMessage(roundMessage, 'Enter at least one mark before submitting.', true); return; }

    submitMarks.disabled = true;
    try {
      const response = await roundsApi(`/coordinator/rounds/${currentRound}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: payload })
      });
      const result = await response.json();
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(result.error || 'Could not save marks.');
      await loadRound(currentRound, true);
      showMessage(roundMessage, isFinalRound()
        ? 'Marks saved. Winner and runner-up have been decided.'
        : 'Marks saved. Teams are ranked by marks — tick who qualifies next.');
    } catch (error) {
      showMessage(roundMessage, error.message, true);
    } finally {
      submitMarks.disabled = false;
    }
  });

  saveQualifiers.addEventListener('click', async () => {
    if (saveQualifiers.classList.contains('is-saving')) return;
    const codes = [...roundRows.querySelectorAll('.qualify-box')].filter(box => box.checked).map(box => box.value);
    saveQualifiers.disabled = true;
    saveQualifiers.classList.add('is-saving');
    saveQualifiers.textContent = 'Saving…';
    try {
      const response = await roundsApi(`/coordinator/rounds/${currentRound}/qualify`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes })
      });
      const result = await response.json();
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(result.error || 'Could not save qualifiers.');
      saveQualifiers.classList.remove('is-saving');
      saveQualifiers.classList.add('is-saved');
      saveQualifiers.textContent = 'Saved ✓';
      showMessage(roundMessage, `${result.qualifiedCount} team${result.qualifiedCount === 1 ? '' : 's'} qualified for Round ${currentRound + 1}.`);
      setTimeout(() => {
        saveQualifiers.classList.remove('is-saved');
        saveQualifiers.textContent = 'Save qualifiers';
        saveQualifiers.disabled = false;
      }, 1600);
    } catch (error) {
      saveQualifiers.classList.remove('is-saving');
      saveQualifiers.textContent = 'Save qualifiers';
      saveQualifiers.disabled = false;
      showMessage(roundMessage, error.message, true);
    }
  });

  return { load: () => loadRound(1) };
}

// Gentle tilt interaction on event cards.
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg) translateY(-4px)`;
    });
    card.addEventListener('pointerleave', () => card.style.transform = '');
  });
}

// Floating back button (appears on every page except the landing page).
(function () {
  if ($('.hero')) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back-button';
  back.setAttribute('aria-label', 'Go back');
  back.textContent = '←';
  back.addEventListener('click', () => {
    if (document.referrer) history.back();
    else location.href = 'index.html';
  });
  document.body.appendChild(back);
})();

// Console nav shortcut: jump straight to the uploaded-results panel.
document.querySelectorAll('.nav-results-link').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const target = $('#uploadedResults');
    const destination = target && target.offsetParent !== null ? target : $('#adminLoginPanel');
    destination?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// --- Live results (Score Card page + organizer console) ---
function mountScoreboard(container, updatedEl) {
  const statusLabels = { completed: 'Final result', live: 'In progress', upcoming: 'Yet to be published' };

  let scoreEvents = [];
  let activeEvent = 0;

  // Each member becomes a row; the team-name cell spans them via rowspan.
  function teamRows(name, members, leadCell) {
    const list = members && members.length ? members : [{ name: '—', phone: '—' }];
    return list.map((member, index) => `
        <tr>
          ${index === 0 ? `${leadCell ? leadCell(list.length) : ''}<td rowspan="${list.length}"><b>${escapeHtml(name)}</b></td>` : ''}
          <td>${escapeHtml(member.name)}</td>
          <td>${escapeHtml(member.phone)}</td>
        </tr>`).join('');
  }

  function roundTable(round) {
    const advancing = round.advancing || [];
    if (!advancing.length) return '<p class="score-pending">Yet to be published</p>';
    return `<div class="table-wrap"><table class="result-table">
        <thead><tr><th>TEAM NAME</th><th>NAME</th><th>PHONE</th></tr></thead>
        <tbody>${advancing.map(team => teamRows(team.name, team.members)).join('')}</tbody>
      </table></div>`;
  }

  // The public board never reveals the final winners: the champion and runner-up are announced
  // separately, so the final block stays a tease.
  function finalTable() {
    return '<p class="score-pending">Winner and runner-up will be announced soon.</p>';
  }

  function scoreBody(item) {
    const rounds = item.rounds.map(round => `
      <div class="result-block">
        <div class="result-head">Round ${round.round}${round.name ? ` · ${escapeHtml(round.name)}` : ''}${(round.advancing || []).length ? `<span class="result-note">Advances to Round ${round.round + 1}</span>` : ''}</div>
        ${roundTable(round)}
      </div>`).join('');
    return `<div class="result-stack">${rounds}
      <div class="result-block">
        <div class="result-head">Final result</div>
        ${finalTable()}
      </div>
    </div>`;
  }

  function scoreTabs() {
    return scoreEvents.map((item, index) => `
      <button type="button" class="score-tab score-${item.status}" role="tab" id="scoreTab${index}" aria-controls="scorePanel${index}" aria-selected="${index === activeEvent}" tabindex="${index === activeEvent ? 0 : -1}">
        <span class="score-tab-dot" aria-hidden="true"></span>${escapeHtml(item.event)}
      </button>`).join('');
  }

  function scorePanels() {
    return scoreEvents.map((item, index) => `
      <article class="score-card score-${item.status}" id="scorePanel${index}" role="tabpanel" aria-labelledby="scoreTab${index}" tabindex="0"${index === activeEvent ? '' : ' hidden'}>
        <div class="score-head"><h3>${escapeHtml(item.event)}</h3><span class="score-status">${statusLabels[item.status] || ''}</span></div>
        ${scoreBody(item)}
      </article>`).join('');
  }

  function activateScoreTab(index) {
    activeEvent = index;
    container.querySelectorAll('.score-tab').forEach((tab, i) => {
      const on = i === index;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    container.querySelectorAll('.score-card').forEach((panel, i) => { panel.hidden = i !== index; });
  }

  function render() {
    if (!scoreEvents.length) {
      container.innerHTML = '<p class="score-empty">Yet to be published.</p>';
      return;
    }
    activeEvent = Math.max(0, Math.min(activeEvent, scoreEvents.length - 1));
    container.innerHTML = `<div class="score-tabs" role="tablist" aria-label="Competitions">${scoreTabs()}</div><div class="score-panels">${scorePanels()}</div>`;
  }

  container.addEventListener('click', event => {
    const tab = event.target.closest('.score-tab');
    if (tab) activateScoreTab([...container.querySelectorAll('.score-tab')].indexOf(tab));
  });

  container.addEventListener('keydown', event => {
    const tab = event.target.closest('.score-tab');
    if (!tab) return;
    const tabs = [...container.querySelectorAll('.score-tab')];
    const current = tabs.indexOf(tab);
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    activateScoreTab(next);
    tabs[next]?.focus();
  });

  async function load() {
    try {
      const response = await fetch(`${API}/scoreboard`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the scoreboard.');
      scoreEvents = result.events || [];
      render();
      if (updatedEl) updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (error) {
      container.innerHTML = `<p class="score-empty">${escapeHtml(fetchError(error))}</p>`;
    }
  }

  function start() {
    load();
    setInterval(load, 60000);
  }

  return { load, start };
}

const scoreGrid = $('#scoreGrid');
if (scoreGrid) mountScoreboard(scoreGrid, $('#scoreboardUpdated')).start();
