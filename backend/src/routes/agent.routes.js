const express = require('express');
const mongoose = require('mongoose');
const Agent = require('../models/Agent');
const AgentMetric = require('../models/AgentMetric');
const AgentIncident = require('../models/AgentIncident');
const AgentLog = require('../models/AgentLog');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync } = require('../utils/helpers');
const socket = require('../services/socket');
const agentEngine = require('../services/agentEngine');

const router = express.Router();

const RANGE_TO_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const HEADER_TOKEN = 'x-agent-token';
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

// Identity fields an agent is allowed to refresh about itself on every
// report. Clamped to the same max lengths as the Agent model so a rogue
// agent can't overflow them.
const IDENTITY_MAX = {
  hostname: 255,
  distro: 120,
  distroVersion: 120,
  kernel: 200,
  arch: 40,
  ipAddress: 64,
};

function resolveRange(value) {
  return RANGE_TO_MS[value] || RANGE_TO_MS['24h'];
}

function stripSecrets(agent) {
  const safe = agent.toObject ? agent.toObject() : { ...agent };
  delete safe.tokenHash;
  return safe;
}

function extractToken(req) {
  const header = req.get(HEADER_TOKEN);
  if (header && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

// ---------------------------------------------------------------------------
// Agent ingestion (public, token authenticated)
//
// Agents run on customer servers and cannot hold a dashboard JWT, so they
// authenticate with the per-agent `agt_...` token created from the
// dashboard. Only the sha256 hash is stored, and comparison is done with
// `matchesToken` (timing-safe) — never a plain string equality.
// ---------------------------------------------------------------------------
const agentAuth = catchAsync(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw new ApiError(401, 'Token agent tidak ditemukan.');

  const agent = await Agent.findOne({
    tokenPreview: token.slice(0, 12),
    isActive: true,
  }).select('+tokenHash');

  if (!agent || !agent.matchesToken(token)) {
    throw new ApiError(401, 'Token agent tidak valid atau agent dinonaktifkan.');
  }

  req.agent = agent;
  next();
});

// POST /api/agents/report — periodic metric report (the heartbeat).
router.post(
  '/report',
  agentAuth,
  validate('agentReport'),
  catchAsync(async (req, res) => {
    const agent = req.agent;
    const osInfo = req.body.osInfo || {};

    // Let the agent keep its own description of the machine up to date
    // (distro/kernel/arch/IP change after upgrades or reboots).
    for (const [key, max] of Object.entries(IDENTITY_MAX)) {
      const value = osInfo[key];
      if (typeof value === 'string' && value.trim()) {
        agent[key] = value.trim().slice(0, max);
      }
    }
    if (Object.keys(osInfo).length) {
      agent.os_info = osInfo;
    }

    const metric = await agentEngine.handleReport(agent, req.body);

    res.json({ ok: true, agentId: agent._id, metric });
  })
);

// POST /api/agents/logs — single structured log line from the agent.
router.post(
  '/logs',
  agentAuth,
  validate('agentLog'),
  catchAsync(async (req, res) => {
    const agent = req.agent;

    if (!agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > 1000) {
      agent.lastSeenAt = new Date();
      await agent.save();
    }

    const log = await AgentLog.create({
      agent: agent._id,
      level: req.body.level,
      source: req.body.source,
      message: req.body.message,
      loggedAt: req.body.loggedAt || new Date(),
    });

    socket.emitAgentLog(agent._id, log);
    res.status(201).json({ ok: true, log });
  })
);

// ---------------------------------------------------------------------------
// Everything below is the dashboard surface, protected by the normal JWT.
// ---------------------------------------------------------------------------
router.use(protect);

// GET /api/agents — list every registered agent.
router.get(
  '/',
  catchAsync(async (req, res) => {
    const agents = await Agent.find()
      .sort({ createdAt: -1 })
      .populate('notificationChannels', 'name type');
    res.json({ agents });
  })
);

// GET /api/agents/incidents — incident history across all agents. Declared
// before `/:id` so it isn't swallowed by the id route.
router.get(
  '/incidents',
  catchAsync(async (req, res) => {
    const filter = {};
    if (['ongoing', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [incidents, total] = await Promise.all([
      AgentIncident.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('agent', 'name hostname distro ipAddress'),
      AgentIncident.countDocuments(filter),
    ]);

    res.json({
      incidents,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  })
);

// POST /api/agents — register an agent and hand back the one-time token.
router.post(
  '/',
  validate('agent'),
  catchAsync(async (req, res) => {
    const token = Agent.generateToken();
    const agent = await Agent.create({
      ...req.body,
      tokenHash: Agent.hashToken(token),
      tokenPreview: token.slice(0, 12),
      createdBy: req.user._id,
    });

    // The raw token is shown exactly once — only its hash is persisted.
    res.status(201).json({ agent: stripSecrets(agent), token });
  })
);

// POST /api/agents/:id/token — rotate the token (e.g. after a leak).
router.post(
  '/:id/token',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id);
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const token = Agent.generateToken();
    agent.tokenHash = Agent.hashToken(token);
    agent.tokenPreview = token.slice(0, 12);
    await agent.save();

    res.json({ token });
  })
);

// GET /api/agents/:id — full detail plus a small incident summary.
router.get(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id).populate(
      'notificationChannels',
      'name type'
    );
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const [ongoingIncidents, incidentCount, metricCount] = await Promise.all([
      AgentIncident.countDocuments({ agent: agent._id, status: 'ongoing' }),
      AgentIncident.countDocuments({ agent: agent._id }),
      AgentMetric.countDocuments({ agent: agent._id }),
    ]);

    res.json({
      agent: stripSecrets(agent),
      summary: { ongoingIncidents, incidentCount, metricCount },
    });
  })
);

// PUT /api/agents/:id — update configuration (never the token).
router.put(
  '/:id',
  validateObjectIdParam(),
  validate('agent'),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id);
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    Object.assign(agent, req.body);
    await agent.save();

    res.json({ agent: stripSecrets(agent) });
  })
);

// PATCH /api/agents/:id/toggle — pause/resume monitoring of an agent.
router.patch(
  '/:id/toggle',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id);
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    agent.isActive = !agent.isActive;
    await agent.save();

    socket.emitAgentUpdate(agent);
    res.json({ agent: stripSecrets(agent) });
  })
);

// DELETE /api/agents/:id — remove an agent and all of its history.
router.delete(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findByIdAndDelete(req.params.id);
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    await Promise.all([
      AgentMetric.deleteMany({ agent: agent._id }),
      AgentIncident.deleteMany({ agent: agent._id }),
      AgentLog.deleteMany({ agent: agent._id }),
    ]);

    res.status(204).end();
  })
);

// GET /api/agents/:id/metrics — time series for the detail charts.
router.get(
  '/:id/metrics',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id).select('_id');
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const { limit, range } = req.query;

    if (limit) {
      const take = Math.min(Math.max(parseInt(limit, 10) || 1, 1), 500);
      const metrics = await AgentMetric.find({ agent: agent._id })
        .sort({ recordedAt: -1 })
        .limit(take);
      metrics.reverse();
      return res.json({ metrics });
    }

    const since = new Date(Date.now() - resolveRange(range));
    const metrics = await AgentMetric.find({
      agent: agent._id,
      recordedAt: { $gte: since },
    })
      .sort({ recordedAt: 1 })
      .limit(5000);

    res.json({ metrics });
  })
);

// GET /api/agents/:id/stats — aggregate CPU/memory/disk over a range.
router.get(
  '/:id/stats',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id).select('_id');
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const since = new Date(Date.now() - resolveRange(req.query.range));
    const [facet = {}] = await AgentMetric.aggregate([
      {
        $match: {
          agent: new mongoose.Types.ObjectId(req.params.id),
          recordedAt: { $gte: since },
        },
      },
      {
        $facet: {
          avg: [
            {
              $group: {
                _id: null,
                cpuPercent: { $avg: '$cpuPercent' },
                memoryPercent: { $avg: '$memoryPercent' },
                diskPercent: { $avg: '$diskPercent' },
              },
            },
          ],
          max: [
            {
              $group: {
                _id: null,
                cpuPercent: { $max: '$cpuPercent' },
                memoryPercent: { $max: '$memoryPercent' },
                diskPercent: { $max: '$diskPercent' },
              },
            },
          ],
          total: [{ $count: 'value' }],
        },
      },
    ]);

    const pick = (bucket) => {
      const row = bucket && bucket[0];
      if (!row) return { cpuPercent: null, memoryPercent: null, diskPercent: null };
      return {
        cpuPercent: row.cpuPercent ?? null,
        memoryPercent: row.memoryPercent ?? null,
        diskPercent: row.diskPercent ?? null,
      };
    };

    res.json({
      stats: {
        range: RANGE_TO_MS[req.query.range] ? req.query.range : '24h',
        samples: facet.total?.[0]?.value || 0,
        avg: pick(facet.avg),
        max: pick(facet.max),
      },
    });
  })
);

// GET /api/agents/:id/incidents — incident history for one agent.
router.get(
  '/:id/incidents',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id).select('_id');
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const incidents = await AgentIncident.find({ agent: agent._id })
      .sort({ startedAt: -1 })
      .limit(100);

    res.json({ incidents });
  })
);

// GET /api/agents/:id/logs — paginated logs, optional level filter.
router.get(
  '/:id/logs',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const agent = await Agent.findById(req.params.id).select('_id');
    if (!agent) throw new ApiError(404, 'Agent tidak ditemukan.');

    const filter = { agent: agent._id };
    if (LOG_LEVELS.includes(req.query.level)) {
      filter.level = req.query.level;
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const [logs, total] = await Promise.all([
      AgentLog.find(filter)
        .sort({ loggedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AgentLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  })
);

module.exports = router;