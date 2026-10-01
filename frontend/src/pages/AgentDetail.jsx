import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { LineChart } from '@mui/x-charts/LineChart';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import { StatusBadge } from '../components/monitors/StatusPieces';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { AgentFormDialog, TokenDialog } from './Agents';

const RANGES = [
  { value: '24h', label: '24 Jam' },
  { value: '7d', label: '7 Hari' },
  { value: '30d', label: '30 Hari' },
];

const LOG_LEVELS = [
  { value: '', label: 'Semua level' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const LEVEL_COLOR = {
  debug: 'text.secondary',
  info: 'info.main',
  warn: 'warning.main',
  error: 'error.main',
};

function agentStatus(agent) {
  if (!agent.isActive) return 'paused';
  return agent.currentStatus === 'online' ? 'up' : 'down';
}

function targetLabel(agent) {
  return agent.hostname || agent.ipAddress || agent.distro || '—';
}

function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(digits);
}

function StatCard({ label, value, color }) {
  return (
    <Paper variant="outlined" sx={{ px: 2.5, py: 2, flex: '1 1 180px', minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: (t) => t.typography.fontFamilyMono,
          fontSize: '1.5rem',
          fontWeight: 700,
          color: color || 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

function MetricChart({ title, metrics, field, unit, color }) {
  const data = metrics.map((m) => new Date(m.recordedAt));
  const values = metrics.map((m) => (m[field] === null || m[field] === undefined ? null : m[field]));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {metrics.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220 }}>
          <Typography color="text.secondary">Belum ada data pada rentang waktu ini.</Typography>
        </Box>
      ) : (
        <LineChart
          height={220}
          xAxis={[
            {
              data,
              scaleType: 'time',
              valueFormatter: (v) => new Date(v).toLocaleString('id-ID'),
            },
          ]}
          yAxis={[{ valueFormatter: (v) => `${v}${unit}` }]}
          series={[
            {
              data: values,
              label: title,
              color,
              area: true,
              showMark: false,
              curve: 'monotoneX',
              valueFormatter: (v) => (v === null ? '—' : `${Number(v).toFixed(1)}${unit}`),
            },
          ]}
          grid={{ horizontal: true }}
          margin={{ left: 55, right: 20, top: 20, bottom: 30 }}
          sx={{
            '& .MuiChartsAxis-line': { stroke: (t) => t.palette.divider },
            '& .MuiChartsAxis-tick': { stroke: (t) => t.palette.divider },
            '& .MuiChartsAxis-tickLabel': { fill: (t) => t.palette.text.secondary },
            '& .MuiChartsGrid-line': {
              stroke: (t) => t.palette.divider,
              strokeDasharray: '3 4',
            },
            '& .MuiAreaElement-root': { fillOpacity: 0.12 },
          }}
        />
      )}
    </Paper>
  );
}

function IncidentRow({ incident }) {
  const start = new Date(incident.startedAt);
  let durationLabel = 'Sedang berlangsung';
  if (incident.durationSeconds) {
    if (incident.durationSeconds >= 3600) {
      durationLabel = `${(incident.durationSeconds / 3600).toFixed(1)} jam`;
    } else {
      durationLabel = `${Math.max(1, Math.round(incident.durationSeconds / 60))} menit`;
    }
  }

  const typeLabel = {
    disconnect: 'Terputus',
    cpu: 'CPU Tinggi',
    memory: 'Memori Tinggi',
    disk: 'Disk Penuh',
    load: 'Load Tinggi',
    reported: 'Dilaporkan Agent',
  }[incident.type] || incident.type;

  return (
    <Box
      sx={{
        px: 2,
        py: 1.5,
        borderBottom: (t) => `1px solid ${t.palette.surface.line}`,
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Chip
          size="small"
          label={incident.status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
          color={incident.status === 'ongoing' ? 'error' : 'default'}
          sx={{ fontFamily: (t) => t.typography.fontFamilyMono, fontSize: '0.65rem' }}
        />
        <Chip
          size="small"
          variant="outlined"
          label={typeLabel}
          color={incident.severity === 'critical' ? 'error' : 'warning'}
          sx={{ fontSize: '0.65rem' }}
        />
      </Stack>
      <Typography variant="body2">{incident.cause || typeLabel}</Typography>
      <Typography variant="caption" color="text.secondary">
        {start.toLocaleString('id-ID')} · Durasi: {durationLabel}
      </Typography>
    </Box>
  );
}

export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [agent, setAgent] = useState(null);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLevel, setLogLevel] = useState('');
  const [range, setRange] = useState('24h');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [detailRes, statsRes, incidentsRes] = await Promise.all([
        api.get(`/agents/${id}`),
        api.get(`/agents/${id}/stats?range=${range}`),
        api.get(`/agents/${id}/incidents`),
      ]);
      setAgent(detailRes.data.agent);
      setSummary(detailRes.data.summary);
      setStats(statsRes.data.stats);
      setIncidents(incidentsRes.data.incidents);
    } catch (err) {
      if (err.response?.status === 404) {
        enqueueSnackbar('Agent tidak ditemukan.', { variant: 'error' });
        navigate('/agents', { replace: true });
      } else {
        enqueueSnackbar('Gagal memuat data agent.', { variant: 'error' });
      }
    }
  }, [id, range, enqueueSnackbar, navigate]);

  const loadMetrics = useCallback(async () => {
    try {
      const res = await api.get(`/agents/${id}/metrics?range=${range}`);
      setMetrics(res.data.metrics);
    } catch {
      setMetrics([]);
    }
  }, [id, range]);

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(logPage), limit: '100' });
      if (logLevel) params.set('level', logLevel);
      const res = await api.get(`/agents/${id}/logs?${params.toString()}`);
      setLogs(res.data.logs);
      setLogTotal(res.data.total);
    } catch {
      setLogs([]);
      setLogTotal(0);
    }
  }, [id, logPage, logLevel]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useSocketEvent('agent:update', (updated) => {
    if (updated?._id === id) setAgent((prev) => ({ ...prev, ...updated }));
  });

  useSocketEvent('agent:heartbeat', ({ agentId, metric }) => {
    if (agentId !== id) return;
    setMetrics((prev) => [...prev, metric].slice(-2000));
    setAgent((prev) =>
      prev
        ? {
            ...prev,
            currentStatus: 'online',
            lastSeenAt: metric.recordedAt,
            currentMetrics: metric,
          }
        : prev,
    );
  });

  useSocketEvent('agent:incident', (incident) => {
    if (incident?.agent !== id && incident?.agent?._id !== id) return;
    setIncidents((prev) => {
      const next = prev.filter((i) => i._id !== incident._id);
      return [incident, ...next].slice(0, 100);
    });
  });

  useSocketEvent('agent:log', ({ agentId, log }) => {
    if (agentId !== id) return;
    setLogs((prev) => [log, ...prev].slice(0, 100));
    setLogTotal((prev) => prev + 1);
  });

  const handleToggle = async () => {
    try {
      const res = await api.patch(`/agents/${id}/toggle`);
      setAgent(res.data.agent);
      enqueueSnackbar(res.data.agent.isActive ? 'Agent diaktifkan.' : 'Agent dinonaktifkan.', {
        variant: 'success',
      });
    } catch {
      enqueueSnackbar('Gagal mengubah status agent.', { variant: 'error' });
    }
  };

  const handleUpdate = async (payload) => {
    const res = await api.put(`/agents/${id}`, payload);
    setAgent(res.data.agent);
    enqueueSnackbar('Agent diperbarui.', { variant: 'success' });
  };

  const handleRegenerateToken = async () => {
    try {
      const res = await api.post(`/agents/${id}/token`);
      setIssuedToken(res.data.token);
      setTokenOpen(true);
    } catch {
      enqueueSnackbar('Gagal membuat token baru.', { variant: 'error' });
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/agents/${id}`);
      enqueueSnackbar('Agent dihapus.', { variant: 'success' });
      navigate('/agents', { replace: true });
    } catch {
      enqueueSnackbar('Gagal menghapus agent.', { variant: 'error' });
      setDeleting(false);
    }
  };

  const status = agent ? agentStatus(agent) : 'pending';
  const current = agent?.currentMetrics || {};
  const totalLogPages = Math.max(1, Math.ceil(logTotal / 100));

  const loadAverageLabel = useMemo(() => {
    const la = current.loadAverage;
    if (!Array.isArray(la) || la.length === 0) return '—';
    return la.map((v) => Number(v).toFixed(2)).join(' / ');
  }, [current.loadAverage]);

  if (!agent || !stats) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <Box>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        color="inherit"
        onClick={() => navigate('/agents')}
        sx={{ mb: 2 }}
      >
        Kembali
      </Button>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h3" noWrap>
              {agent.name}
            </Typography>
            <StatusBadge status={status} isActive={agent.isActive} />
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}
          >
            {targetLabel(agent)}
            {agent.distro ? ` · ${agent.distro}${agent.distroVersion ? ` ${agent.distroVersion}` : ''}` : ''}
            {agent.ipAddress ? ` · ${agent.ipAddress}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title={agent.isActive ? 'Nonaktifkan' : 'Aktifkan'}>
            <IconButton onClick={handleToggle}>
              {agent.isActive ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Ubah">
            <IconButton onClick={() => setEditOpen(true)}>
              <EditRoundedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Token Baru">
            <IconButton onClick={handleRegenerateToken}>
              <VpnKeyRoundedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Hapus">
            <IconButton color="error" onClick={() => setDeleteOpen(true)}>
              <DeleteRoundedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <StatCard label="CPU" value={formatPercent(current.cpuPercent)} />
        <StatCard label="Memori" value={formatPercent(current.memoryPercent)} />
        <StatCard label="Disk" value={formatPercent(current.diskPercent)} />
        <StatCard label="Load Average" value={loadAverageLabel} />
        <StatCard label="Uptime" value={formatUptime(current.uptimeSeconds)} />
        <StatCard label="Proses" value={current.processCount ?? '—'} />
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <StatCard label="Insiden Berlangsung" value={summary?.ongoingIncidents ?? 0} color="error.main" />
        <StatCard label="Total Insiden" value={summary?.incidentCount ?? 0} />
        <StatCard label="Total Sampel" value={summary?.metricCount ?? 0} />
        <StatCard label="Rata-rata CPU" value={formatPercent(stats.avg?.cpuPercent)} />
        <StatCard label="Rata-rata Memori" value={formatPercent(stats.avg?.memoryPercent)} />
        <StatCard label="Rata-rata Disk" value={formatPercent(stats.avg?.diskPercent)} />
      </Stack>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h6">Grafik Metrik</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(e, value) => value && setRange(value)}
        >
          {RANGES.map((r) => (
            <ToggleButton key={r.value} value={r.value}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 2,
          mb: 3,
        }}
      >
        <MetricChart
          title="CPU"
          metrics={metrics}
          field="cpuPercent"
          unit="%"
          color="#F0A94E"
        />
        <MetricChart
          title="Memori"
          metrics={metrics}
          field="memoryPercent"
          unit="%"
          color="#34D399"
        />
        <MetricChart
          title="Disk"
          metrics={metrics}
          field="diskPercent"
          unit="%"
          color="#E8B23D"
        />
        <MetricChart
          title="Load Average (1m)"
          metrics={metrics.map((m) => ({
            ...m,
            load1: Array.isArray(m.loadAverage) ? m.loadAverage[0] : null,
          }))}
          field="load1"
          unit=""
          color="#F5484B"
        />
      </Box>

      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Insiden
      </Typography>
      <Paper variant="outlined" sx={{ mb: 3 }}>
        {incidents.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">Belum ada insiden tercatat.</Typography>
          </Box>
        ) : (
          incidents.map((incident) => <IncidentRow key={incident._id} incident={incident} />)
        )}
      </Paper>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h6">Log Agent</Typography>
        <TextField
          select
          size="small"
          value={logLevel}
          onChange={(e) => {
            setLogLevel(e.target.value);
            setLogPage(1);
          }}
          sx={{ minWidth: 160 }}
        >
          {LOG_LEVELS.map((l) => (
            <MenuItem key={l.value} value={l.value}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Paper variant="outlined" sx={{ mb: 2 }}>
        {logs.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">Belum ada log.</Typography>
          </Box>
        ) : (
          logs.map((log) => (
            <Box
              key={log._id}
              sx={{
                px: 2,
                py: 1,
                borderBottom: (t) => `1px solid ${t.palette.surface.line}`,
                '&:last-of-type': { borderBottom: 'none' },
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  label={log.level.toUpperCase()}
                  sx={{
                    fontFamily: (t) => t.typography.fontFamilyMono,
                    fontSize: '0.6rem',
                    color: LEVEL_COLOR[log.level] || 'text.secondary',
                  }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}
                >
                  {new Date(log.loggedAt).toLocaleString('id-ID')}
                  {log.source ? ` · ${log.source}` : ''}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                sx={{ fontFamily: (t) => t.typography.fontFamilyMono, whiteSpace: 'pre-wrap' }}
              >
                {log.message}
              </Typography>
            </Box>
          ))
        )}
      </Paper>

      {logTotal > 100 && (
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end">
          <Button
            size="small"
            disabled={logPage <= 1}
            onClick={() => setLogPage((p) => Math.max(1, p - 1))}
          >
            Sebelumnya
          </Button>
          <Typography variant="caption" color="text.secondary">
            Halaman {logPage} / {totalLogPages}
          </Typography>
          <Button
            size="small"
            disabled={logPage >= totalLogPages}
            onClick={() => setLogPage((p) => p + 1)}
          >
            Berikutnya
          </Button>
        </Stack>
      )}

      <AgentFormDialog
        open={editOpen}
        initialAgent={agent}
        onClose={() => setEditOpen(false)}
        onSubmit={handleUpdate}
      />

      <TokenDialog open={tokenOpen} token={issuedToken} onClose={() => setTokenOpen(false)} />

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus Agent"
        description={`Hapus agent "${agent.name}"? Semua metrik, insiden, dan log terkait akan dihapus.`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </Box>
  );
}
