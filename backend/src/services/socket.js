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

// Agent equivalents. The agent engine and the ingestion route call these so
// the dashboard's Agent pages update live without polling — same contract as
// the monitor emitters above, just a separate channel namespace.
function emitAgentUpdate(agent) {
  io?.emit('agent:update', agent);
}

function emitAgentHeartbeat(agentId, metric) {
  io?.emit('agent:heartbeat', { agentId: agentId.toString(), metric });
}

function emitAgentIncident(incident) {
  io?.emit('agent:incident', incident);
}

function emitAgentLog(agentId, log) {
  io?.emit('agent:log', { agentId: agentId.toString(), log });
}

module.exports = {
  init,
  emitMonitorUpdate,
  emitHeartbeat,
  emitIncident,
  emitAgentUpdate,
  emitAgentHeartbeat,
  emitAgentIncident,
  emitAgentLog,
};
