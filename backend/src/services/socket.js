const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const User = require('../models/User');
const logger = require('../utils/logger');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
    path: '/socket.io',
  });

  // Real-time updates carry live monitor state, so the socket channel needs
  // the same authentication guarantee as the REST API — otherwise it would
  // be a way to read monitor data while bypassing `protect`.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      if (payload.type !== 'access') return next(new Error('unauthorized'));
      const user = await User.findById(payload.sub).select('+tokenVersion');
      if (!user || user.tokenVersion !== payload.tokenVersion) {
        return next(new Error('unauthorized'));
      }
      socket.userId = user._id.toString();
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id} (user ${socket.userId})`);
    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${socket.id}`));
  });

  return io;
}

// Called by the monitor engine after every check — pushes the updated
// monitor document (cached status, response time, etc.) to every connected
// dashboard client so the UI updates without polling.
function emitMonitorUpdate(monitor) {
  io?.emit('monitor:update', monitor);
}

function emitHeartbeat(monitorId, heartbeat) {
  io?.emit('heartbeat:new', { monitorId: monitorId.toString(), heartbeat });
}

function emitIncident(incident) {
  io?.emit('incident:update', incident);
}

module.exports = { init, emitMonitorUpdate, emitHeartbeat, emitIncident };
