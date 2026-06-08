# CMT Meeting (Jitsi + SQLite)

This project gives you your own classroom meeting portal where:

- Teacher creates a meeting link
- Students join using the shared URL
- In-meeting chat works (Jitsi chat)
- Screen sharing works (Jitsi desktop share)
- Recording is enabled when your Jitsi server has Jibri configured
- Meeting metadata and recording links are stored in SQLite
- Admin login is controlled from .env (email/password)
- Only admin can create meetings, start recording, mute all, and save recording links

## How this works

- Frontend embeds Jitsi using the official IFrame API
- Backend is Node.js + Express
- Data is persisted in SQLite

You can run in two modes:

1. Fast free mode using meet.jit.si
2. Own self-hosted Jitsi domain (recommended for full control and recording)

## 1) Setup app

1. Install dependencies

   npm install

2. Create env file

   copy .env.example .env

3. Update .env with your values:

   - ADMIN_EMAIL=your-email
   - ADMIN_PASSWORD=your-password
   - SESSION_SECRET=strong-random-text
   - APP_BASE_URL and JITSI_DOMAIN

4. Optional: pre-create tables from db.sql (the app auto-creates tables on first run)

5. Start app

   npm start

6. Open

   http://localhost:5050

7. Login from homepage with ADMIN_EMAIL and ADMIN_PASSWORD to create/start meetings as moderator.

## 2) Fast free mode (no server infra)

In .env keep:

- JITSI_DOMAIN=meet.jit.si

This is free and works immediately for meetings, chat, and screen sharing.

Note: Cloud recording availability can vary in public deployments.

## 3) Own self-hosted Jitsi (recommended)

Use Jitsi Docker stack from official docs/repo:

- https://github.com/jitsi/docker-jitsi-meet
- https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker

High-level steps:

1. Provision a VPS with public IP and DNS (example: meet.yourdomain.com)
2. Deploy docker-jitsi-meet
3. Configure PUBLIC_URL and JVB_ADVERTISE_IPS
4. Open ports 80/tcp, 443/tcp, 10000/udp
5. Enable authentication for host control
6. Enable Jibri for recording

After your Jitsi domain is live, set in .env:

- JITSI_DOMAIN=meet.yourdomain.com

Restart this app.

## Recording support notes

- The Start Recording button sends Jitsi recording command.
- Recording works when your Jitsi deployment includes Jibri and recording is enabled.
- Saved recording URLs are stored through this app in SQLite for your class archive.

## API overview

- GET /api/health
- GET /api/config
- GET /api/meetings
- POST /api/meetings
- GET /api/meetings/:roomName
- POST /api/meetings/:roomName/events
- POST /api/meetings/:roomName/recordings

## Security recommendations

- Enable host authentication in your Jitsi server
- Keep students as guest users
- Enable lobby and passcode/policy controls from Jitsi config
- Use HTTPS in production

## Stack

- Node.js
- Express
- SQLite (sqlite3)
- Jitsi IFrame API
