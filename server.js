const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---- in-memory state (swap for Redis/a DB before you have more than one server process) ----
const users = new Map();       // socket.id -> { username, gender, partnerId, waiting }
const waitingQueue = [];       // array of socket.id, FIFO
const reports = [];            // { at, reporterUsername, reportedUsername, reason }

function safeUser(id) {
  return users.get(id);
}

function removeFromQueue(id) {
  const idx = waitingQueue.indexOf(id);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function tryMatch() {
  while (waitingQueue.length >= 2) {
    const aId = waitingQueue.shift();
    const bId = waitingQueue.shift();
    const a = safeUser(aId);
    const b = safeUser(bId);

    // one of them may have disconnected while queued - drop and keep trying
    if (!a && !b) continue;
    if (!a) { waitingQueue.unshift(bId); continue; }
    if (!b) { waitingQueue.unshift(aId); continue; }

    const room = `room-${aId}-${bId}`;
    a.partnerId = bId;
    a.waiting = false;
    a.room = room;
    b.partnerId = aId;
    b.waiting = false;
    b.room = room;

    io.sockets.sockets.get(aId)?.join(room);
    io.sockets.sockets.get(bId)?.join(room);

    io.to(aId).emit('matched', { partnerUsername: b.username, partnerGender: b.gender });
    io.to(bId).emit('matched', { partnerUsername: a.username, partnerGender: a.gender });
  }
}

function endPair(socketId, { reason } = {}) {
  const me = safeUser(socketId);
  if (!me) return;

  removeFromQueue(socketId);

  const partnerId = me.partnerId;
  if (partnerId) {
    const partner = safeUser(partnerId);
    if (partner) {
      partner.partnerId = null;
      io.to(partnerId).emit('partner_left', { reason: reason || 'left' });
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket && me.room) partnerSocket.leave(me.room);
    }
  }

  me.partnerId = null;
  const mySocket = io.sockets.sockets.get(socketId);
  if (mySocket && me.room) mySocket.leave(me.room);
  me.room = null;
}

io.on('connection', (socket) => {
  socket.on('register', ({ username, gender }) => {
    const cleanName = String(username || '').trim().slice(0, 24) || `guest_${socket.id.slice(0, 5)}`;
    const cleanGender = gender === 'Male' || gender === 'Female' ? gender : 'Male';
    users.set(socket.id, {
      username: cleanName,
      gender: cleanGender,
      partnerId: null,
      room: null,
      waiting: false,
    });
    socket.emit('registered', { username: cleanName, gender: cleanGender });
  });

  socket.on('find_match', () => {
    const me = safeUser(socket.id);
    if (!me) return;
    if (me.partnerId) return; // already chatting
    if (!waitingQueue.includes(socket.id)) {
      me.waiting = true;
      waitingQueue.push(socket.id);
    }
    tryMatch();
  });

  socket.on('cancel_match', () => {
    removeFromQueue(socket.id);
    const me = safeUser(socket.id);
    if (me) me.waiting = false;
  });

  socket.on('send_message', ({ text }) => {
    const me = safeUser(socket.id);
    if (!me || !me.partnerId) return;
    const clean = String(text || '').trim().slice(0, 1000);
    if (!clean) return;
    io.to(me.partnerId).emit('message', { text: clean });
  });

  socket.on('typing', () => {
    const me = safeUser(socket.id);
    if (!me || !me.partnerId) return;
    io.to(me.partnerId).emit('partner_typing');
  });

  socket.on('skip', () => {
    const me = safeUser(socket.id);
    if (!me) return;
    endPair(socket.id, { reason: 'skipped' });
    me.waiting = true;
    waitingQueue.push(socket.id);
    tryMatch();
  });

  socket.on('end_chat', () => {
    endPair(socket.id, { reason: 'ended' });
  });

  socket.on('report', ({ reason }) => {
    const me = safeUser(socket.id);
    if (!me) return;
    const partner = me.partnerId ? safeUser(me.partnerId) : null;
    reports.push({
      at: new Date().toISOString(),
      reporterUsername: me.username,
      reportedUsername: partner ? partner.username : 'unknown',
      reason: String(reason || 'unspecified').slice(0, 200),
    });
    // eslint-disable-next-line no-console
    console.log('[report]', reports[reports.length - 1]);
    endPair(socket.id, { reason: 'reported' });
  });

  socket.on('disconnect', () => {
    endPair(socket.id, { reason: 'disconnected' });
    removeFromQueue(socket.id);
    users.delete(socket.id);
  });
});

// tiny read-only endpoint so you can eyeball reports while testing locally
app.get('/__reports', (req, res) => {
  res.json(reports);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Quad server running on http://localhost:${PORT}`);
});
