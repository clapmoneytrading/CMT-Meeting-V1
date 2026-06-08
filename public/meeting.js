async function requestJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Request failed');
  }
  return res.json();
}

function getRoomNameFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

async function bootMeeting() {
  const roomName = getRoomNameFromPath();
  const [config, meeting, auth] = await Promise.all([
    requestJson('/api/config'),
    requestJson(`/api/meetings/${roomName}`),
    requestJson('/api/auth/me')
  ]);
  const isAdmin = Boolean(auth && auth.isAdmin);
  const isPublicEmbeddedDomain = String(config.jitsiDomain || '').toLowerCase() === 'meet.jit.si';
  const externalMeetingUrl = `https://${config.jitsiDomain}/${encodeURIComponent(roomName)}`;

  document.getElementById('meeting-title').textContent = meeting.title;
  document.getElementById('meeting-room').textContent = `Room: ${roomName}`;

  const inviteLink = `${window.location.origin}/meeting/${roomName}`;
  const openChatButton = document.getElementById('open-chat');
  const startRecordButton = document.getElementById('start-record');
  const muteAllButton = document.getElementById('mute-all');
  const copyLinkButton = document.getElementById('copy-link');
  const recordBox = document.querySelector('.record-box');
  const recordingsPanel = document.querySelector('.recordings-panel');

  if (!isAdmin) {
    copyLinkButton.style.display = 'none';
    if (recordBox) {
      recordBox.style.display = 'none';
    }
    if (recordingsPanel) {
      recordingsPanel.style.display = 'none';
    }
    startRecordButton.style.display = 'none';
    muteAllButton.style.display = 'none';
  }

  copyLinkButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied');
  });

  if (isPublicEmbeddedDomain) {
    const warningBox = document.getElementById('public-jitsi-warning');
    warningBox.hidden = false;

    const warningTitle = warningBox.querySelector('strong');
    const warningText = warningBox.querySelector('p');
    if (!isAdmin) {
      if (warningTitle) {
        warningTitle.style.display = 'none';
      }
      if (warningText) {
        warningText.style.display = 'none';
      }
      openChatButton.style.display = 'none';
    }

    const openExternalButton = document.getElementById('open-external');
    openExternalButton.textContent = isAdmin
      ? 'Open Full Meeting (No 5-Min Embed Limit)'
      : 'Open Meeting';

    openExternalButton.addEventListener('click', () => {
      window.open(externalMeetingUrl, '_blank', 'noopener,noreferrer');
    });

    openChatButton.addEventListener('click', () => {
      window.open(externalMeetingUrl, '_blank', 'noopener,noreferrer');
    });

    if (isAdmin) {
      startRecordButton.addEventListener('click', () => {
        window.open(externalMeetingUrl, '_blank', 'noopener,noreferrer');
      });
      muteAllButton.addEventListener('click', () => {
        window.open(externalMeetingUrl, '_blank', 'noopener,noreferrer');
      });
    }

    const container = document.getElementById('jitsi-container');
    container.innerHTML = isAdmin
      ? '<div class="panel" style="margin:16px">Open the full meeting in a new tab to continue without 5-minute limit.</div>'
      : '';
  } else {
    const script = document.createElement('script');
    script.src = `https://${config.jitsiDomain}/external_api.js`;
    script.async = true;

    script.onload = () => {
      const api = new window.JitsiMeetExternalAPI(config.jitsiDomain, {
        roomName,
        parentNode: document.getElementById('jitsi-container'),
        width: '100%',
        height: '100%',
        configOverwrite: {
          prejoinPageEnabled: true,
          enableWelcomePage: false,
          startScreenSharing: false,
          disableModeratorIndicator: false
        },
        interfaceConfigOverwrite: {
          MOBILE_APP_PROMO: false,
          TOOLBAR_BUTTONS: [
            'microphone',
            'camera',
            'closedcaptions',
            'desktop',
            'fullscreen',
            'fodeviceselection',
            'hangup',
            'profile',
            'chat',
            ...(isAdmin ? ['recording'] : []),
            'raisehand',
            'tileview',
            'settings',
            'security'
          ]
        },
        userInfo: {
          displayName: new URLSearchParams(window.location.search).get('name') || 'Student'
        }
      });

      openChatButton.addEventListener('click', () => {
        api.executeCommand('toggleChat');
      });

      if (isAdmin) {
        startRecordButton.addEventListener('click', () => {
          api.executeCommand('startRecording', { mode: 'file' });
        });

        muteAllButton.addEventListener('click', () => {
          api.executeCommand('muteEveryone');
        });
      }

      api.addEventListener('videoConferenceJoined', async (event) => {
        await requestJson(`/api/meetings/${roomName}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'meeting_joined',
            actorName: event.displayName,
            payload: event
          })
        });
      });

      api.addEventListener('videoConferenceLeft', async (event) => {
        await requestJson(`/api/meetings/${roomName}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'meeting_left',
            actorName: event.displayName,
            payload: event
          })
        });
      });

      api.addEventListener('recordingStatusChanged', async (event) => {
        await requestJson(`/api/meetings/${roomName}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'recording_status_changed',
            payload: event
          })
        });
      });
    };

    document.head.appendChild(script);
  }

  const recordingsList = document.getElementById('recordings');
  function paintRecordings(recordings) {
    recordingsList.innerHTML = recordings.length
      ? recordings
          .map((recording) => `<li><a href="${recording.recording_url}" target="_blank" rel="noreferrer">${recording.recording_url}</a><br/>${recording.notes || ''}</li>`)
          .join('')
      : '<li>No recording links saved yet.</li>';
  }

  paintRecordings(meeting.recordings || []);

  document.getElementById('recording-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!isAdmin) {
      alert('Only admin can save recording links.');
      return;
    }

    const recordingUrl = document.getElementById('recording-url').value.trim();
    const notes = document.getElementById('recording-notes').value.trim();

    if (!recordingUrl) {
      alert('Recording URL is required');
      return;
    }

    await requestJson(`/api/meetings/${roomName}/recordings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingUrl, notes })
    });

    const updated = await requestJson(`/api/meetings/${roomName}`);
    paintRecordings(updated.recordings || []);

    document.getElementById('recording-url').value = '';
    document.getElementById('recording-notes').value = '';
  });
}

bootMeeting().catch((error) => {
  alert(error.message);
});
