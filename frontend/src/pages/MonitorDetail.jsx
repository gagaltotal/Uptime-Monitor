import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import { StatusBadge, uptimeColor } from '../components/monitors/StatusPieces';
import HeartbeatBar from '../components/monitors/HeartbeatBar';
import ResponseTimeChart from '../components/charts/ResponseTimeChart';
import MonitorFormDialog from '../components/monitors/MonitorFormDialog';
import ConfirmDialog from '../components/common/ConfirmDialog';

const RANGES = [
  { value: '24h', label: '24 Jam' },
  { value: '7d', label: '7 Hari' },
  { value: '30d', label: '30 Hari' },
];

function targetLabel(monitor) {
  if (!monitor) return '';
  if (monitor.type === 'http') return monitor.url;
  if (monitor.type === 'tcp') return `${monitor.host}:${monitor.port}`;
  return monitor.host;
}

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [monitor, setMonitor] = useState(null);
  const [stats, setStats] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [heartbeats, setHeartbeats] = useState([]);
  const [range, setRange] = useState('24h');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadAll = useCallback(async () => {
    const [monitorRes, statsRes, incidentsRes] = await Promise.all([
      api.get(`/monitors/${id}`),
      api.get(`/monitors/${id}/stats`),
      api.get(`/monitors/${id}/incidents`),
    ]);
    setMonitor(monitorRes.data.monitor);
    setStats(statsRes.data.stats);
    setIncidents(incidentsRes.data.incidents);
  }, [id]);

  useEffect(() => {
    loadAll().catch(() => enqueueSnackbar('Gagal memuat detail monitor.', { variant: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api
      .get(`/monitors/${id}/heartbeats`, { params: { range } })
      .then((r) => setHeartbeats(r.data.heartbeats))
      .catch(() => {});
  }, [id, range]);

  useSocketEvent('monitor:update', (updated) => {
    if (updated._id === id) setMonitor((prev) => (prev ? { ...prev, ...updated } : prev));
  });

  useSocketEvent('heartbeat:new', ({ monitorId, heartbeat }) => {
    if (monitorId !== id) return;
    setHeartbeats((prev) => [...prev, heartbeat].slice(-2000));
  });

  useSocketEvent('incident:update', (incident) => {
    if (incident.monitor !== id && incident.monitor?._id !== id) return;
    setIncidents((prev) => {
      const exists = prev.some((i) => i._id === incident._id);
      return exists ? prev.map((i) => (i._id === incident._id ? incident : i)) : [incident, ...prev];
    });
  });

  const handleToggle = async () => {
    const { data } = await api.patch(`/monitors/${id}/toggle`);
    setMonitor((prev) => ({ ...prev, ...data.monitor }));
  };

  const handleUpdate = async (payload) => {
    const { data } = await api.put(`/monitors/${id}`, payload);
    setMonitor(data.monitor);
    setEditOpen(false);
    enqueueSnackbar('Monitor berhasil diperbarui.', { variant: 'success' });
  };

  const handleDelete = async () => {
    await api.delete(`/monitors/${id}`);
    enqueueSnackbar('Monitor dihapus.', { variant: 'success' });
    navigate('/', { replace: true });
  };

  const sslBadge = useMemo(() => {
    if (!monitor?.sslCertExpiresAt) return null;
    const days = monitor.sslDaysRemaining;
    const isWarn = days != null && days <= 14;
    return { days, isWarn, expiresAt: new Date(monitor.sslCertExpiresAt) };
  }, [monitor]);

  if (!monitor || !stats) {
    return (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <Typography color="text.secondary">Memuat…</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(-1)} color="inherit" sx={{ mb: 2, ml: -1 }}>
        Kembali
      </Button>

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2} sx={{ mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
            <Typography variant="h3">{monitor.name}</Typography>
            <StatusBadge status={monitor.currentStatus} isActive={monitor.isActive} />
          </Stack>
          <Typography
            sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'text.secondary', mt: 0.5, wordBreak: 'break-all' }}
          >
            {targetLabel(monitor)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <IconButton onClick={handleToggle} title={monitor.isActive ? 'Jeda' : 'Lanjutkan'}>
            {monitor.isActive ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
          </IconButton>
          <IconButton onClick={() => setEditOpen(true)} title="Edit">
            <EditRoundedIcon />
          </IconButton>
          <IconButton onClick={() => setDeleteOpen(true)} title="Hapus" color="error">
            <DeleteRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap' }}>
        {RANGES.map(({ value, label }) => (
          <StatCard
            key={value}
            label={`Uptime ${label}`}
            value={stats[value].uptimePercent != null ? `${stats[value].uptimePercent}%` : '—'}
            color={(theme) => uptimeColor(theme, stats[value].uptimePercent)}
          />
        ))}
        <StatCard label="Rata-rata Respons (24 Jam)" value={stats['24h'].avgResponseTime != null ? `${stats['24h'].avgResponseTime} ms` : '—'} />
      </Stack>

      {monitor.type === 'http' && monitor.url?.startsWith('https://') && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {sslBadge?.isWarn ? (
            <GppMaybeRoundedIcon sx={{ color: 'warning.main' }} />
          ) : (
            <VerifiedUserRoundedIcon sx={{ color: 'status.up' }} />
          )}
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>
              Sertifikat SSL
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {sslBadge
                ? `Kedaluwarsa ${sslBadge.expiresAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} (${sslBadge.days} hari lagi)`
                : 'Belum ada data — akan diperiksa pada pengecekan berikutnya.'}
            </Typography>
          </Box>
          {sslBadge?.isWarn && <Chip size="small" color="warning" label="Segera kedaluwarsa" />}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Waktu Respons</Typography>
          <ToggleButtonGroup size="small" exclusive value={range} onChange={(e, v) => v && setRange(v)}>
            {RANGES.map((r) => (
              <ToggleButton key={r.value} value={r.value}>
                {r.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
        <ResponseTimeChart heartbeats={heartbeats} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Riwayat Pengecekan
        </Typography>
        <HeartbeatBar heartbeats={heartbeats} maxBars={80} height={40} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Riwayat Insiden
        </Typography>
        {incidents.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Belum pernah ada insiden pada monitor ini. 🎉
          </Typography>
        ) : (
          incidents.map((incident) => <IncidentRow key={incident._id} incident={incident} />)
        )}
      </Paper>

      <MonitorFormDialog open={editOpen} initialMonitor={monitor} onClose={() => setEditOpen(false)} onSubmit={handleUpdate} />
      <ConfirmDialog
        open={deleteOpen}
        title="Hapus monitor ini?"
        description={`"${monitor.name}" beserta seluruh riwayat dan insidennya akan dihapus permanen.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </Box>
  );
}

function StatCard({ label, value, color }) {
  return (
    <Paper variant="outlined" sx={{ px: 2.5, py: 2, flex: '1 1 180px', minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: (t) => t.typography.fontFamilyMono, fontSize: '1.5rem', fontWeight: 700, color: color || 'text.primary' }}>
        {value}
      </Typography>
    </Paper>
  );
}

function IncidentRow({ incident }) {
  const start = new Date(incident.startedAt);
  const durationLabel = incident.durationSeconds
    ? incident.durationSeconds >= 3600
      ? `${(incident.durationSeconds / 3600).toFixed(1)} jam`
      : `${Math.round(incident.durationSeconds / 60)} menit`
    : 'Sedang berlangsung';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}>
      <Chip
        size="small"
        label={incident.status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
        color={incident.status === 'ongoing' ? 'error' : 'default'}
        sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {incident.cause || 'Tidak ada detail penyebab.'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {start.toLocaleString('id-ID')} · Durasi: {durationLabel}
        </Typography>
      </Box>
    </Box>
  );
}
