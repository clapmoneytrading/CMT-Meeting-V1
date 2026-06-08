async function requestJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Request failed');
  }
  return res.json();
}

const form = document.getElementById('create-form');
const resultBox = document.getElementById('create-result');
const meetingList = document.getElementById('meeting-list');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const authStatus = document.getElementById('auth-status');
let currentAuth = { isAdmin: false, email: null };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function meetingItem(meeting, isAdmin) {
  const room = escapeHtml(meeting.room_name);
  const title = escapeHtml(meeting.title);
  const host = escapeHtml(meeting.host_name);
  const status = escapeHtml(meeting.status);
  const joinLink = `<a href="/meeting/${room}">Join room</a>`;
  const startLink = isAdmin ? `<a href="/meeting/${room}?as=admin">Start meeting</a>` : '';
  const deleteButton = isAdmin
    ? `<button type="button" class="danger small delete-meeting" data-room="${room}">Delete</button>`
    : '';

  return `<li>
    <strong>${title}</strong><br/>
    Host: ${host}<br/>
    Status: ${status}<br/>
    ${joinLink}
    ${startLink ? ` | ${startLink}` : ''}
    ${deleteButton ? `<div style="margin-top:8px">${deleteButton}</div>` : ''}
  </li>`;
}

async function loadMeetings() {
  const meetings = await requestJson('/api/meetings');
  const isAdmin = Boolean(currentAuth && currentAuth.isAdmin);
  meetingList.innerHTML = meetings.length
    ? meetings.map((meeting) => meetingItem(meeting, isAdmin)).join('')
    : '<li>No meetings yet.</li>';
}

function setAuthUi(auth) {
  currentAuth = auth || { isAdmin: false, email: null };
  const isAdmin = Boolean(auth && auth.isAdmin);
  form.hidden = !isAdmin;
  logoutBtn.hidden = !isAdmin;
  loginForm.hidden = isAdmin;

  authStatus.hidden = false;
  authStatus.textContent = isAdmin
    ? `Logged in as admin: ${auth.email}`
    : 'Not logged in. Students can join meetings, but only admin can create meetings.';
}

async function refreshAuth() {
  const auth = await requestJson('/api/auth/me');
  setAuthUi(auth);
  await loadMeetings();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });

    loginForm.reset();
    resultBox.hidden = true;
    await refreshAuth();
  } catch (error) {
    authStatus.hidden = false;
    authStatus.textContent = error.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await requestJson('/api/auth/logout', { method: 'POST' });
  await refreshAuth();
});

meetingList.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (!target.classList.contains('delete-meeting')) {
    return;
  }

  const room = target.dataset.room;
  if (!room) {
    return;
  }

  const ok = window.confirm(`Delete meeting ${room}? This cannot be undone.`);
  if (!ok) {
    return;
  }

  try {
    await requestJson(`/api/meetings/${encodeURIComponent(room)}`, { method: 'DELETE' });
    await loadMeetings();
  } catch (error) {
    authStatus.hidden = false;
    authStatus.textContent = error.message;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    title: formData.get('title'),
    hostName: formData.get('hostName'),
    hostEmail: formData.get('hostEmail') || null,
    scheduledAt: formData.get('scheduledAt') || null
  };

  try {
    const created = await requestJson('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    resultBox.hidden = false;
    resultBox.innerHTML = `<strong>Meeting created.</strong><br/><a href="${created.shareUrl}">${created.shareUrl}</a>`;
    form.reset();
    await loadMeetings();
  } catch (error) {
    resultBox.hidden = false;
    resultBox.textContent = error.message;
  }
});

setAuthUi({ isAdmin: false, email: null });

Promise.all([refreshAuth()]).catch((error) => {
  meetingList.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
});
