import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import MonitorRow from '../components/monitors/MonitorRow';
import MonitorFormDialog from '../components/monitors/MonitorFormDialog';
import ConfirmDialog from '../components/common/ConfirmDialog';

const HEARTBEAT_LIMIT = 40;
const REFRESH_INTERVAL_MS = 60 * 1000;

export default function Dashboard() {
  const { enqueueSnackbar } = useSnackbar();
  const [monitors, setMonitors] = useState(null); // null = loading
  const [heartbeatsByMonitor, setHeartbeatsByMonitor] = useState({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadMonitors = useCallback(async ({ silent = false } = {}) => {
    try {
      const { data } = await api.get('/monitors');
      setMonitors(data.monitors);
      if (!silent) {
        const heartbeatEntries = await Promise.all(
          data.monitors.map((m) =>
            api
              .get(`/monitors/${m._id}/heartbeats`, { params: { limit: HEARTBEAT_LIMIT } })
              .then((r) => [m._id, r.data.heartbeats])
              .catch(() => [m._id, []])
          )
        );
        setHeartbeatsByMonitor(Object.fromEntries(heartbeatEntries));
      }
    } catch {
      enqueueSnackbar('Gagal memuat daftar monitor.', { variant: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonitors();
    const interval = setInterval(() => loadMonitors({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMonitors]);

  // Live updates: a monitor's cached status/response-time changes...
  useSocketEvent('monitor:update', (updated) => {
    setMonitors((prev) => (prev ? prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)) : prev));
  });

  // ...and each individual check appends one bar to that monitor's heartbeat strip.
  useSocketEvent('heartbeat:new', ({ monitorId, heartbeat }) => {
    setHeartbeatsByMonitor((prev) => {
      const existing = prev[monitorId] || [];
      return { ...prev, [monitorId]: [...existing, heartbeat].slice(-HEARTBEAT_LIMIT) };
    });
  });

  const filteredMonitors = useMemo(() => {
    if (!monitors) return [];
    return monitors.filter((m) => {
      const matchesSearch =
        !search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.url || m.host || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'up' && m.currentStatus === 'up' && m.isActive) ||
        (statusFilter === 'down' && m.currentStatus === 'down' && m.isActive) ||
        (statusFilter === 'paused' && !m.isActive);
      return matchesSearch && matchesStatus;
    });
  }, [monitors, search, statusFilter]);

  const summary = useMemo(() => {
    if (!monitors) return null;
    const active = monitors.filter((m) => m.isActive);
    const up = active.filter((m) => m.currentStatus === 'up').length;
    const down = active.filter((m) => m.currentStatus === 'down').length;
    const responseTimes = active.map((m) => m.lastResponseTime).filter((v) => typeof v === 'number');
    const avgResponse = responseTimes.length
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;
    return { total: monitors.length, up, down, avgResponse };
  }, [monitors]);

  const handleCreateOrUpdate = async (payload) => {
    if (editingMonitor) {
      const { data } = await api.put(`/monitors/${editingMonitor._id}`, payload);
      setMonitors((prev) => prev.map((m) => (m._id === data.monitor._id ? { ...m, ...data.monitor } : m)));
      enqueueSnackbar('Monitor berhasil diperbarui.', { variant: 'success' });
    } else {
      const { data } = await api.post('/monitors', payload);
      setMonitors((prev) => [...(prev || []), { ...data.monitor, uptime24h: null }]);
      enqueueSnackbar('Monitor berhasil ditambahkan.', { variant: 'success' });
    }
    setFormOpen(false);
    setEditingMonitor(null);
  };

  const handleToggle = async (monitor) => {
    try {
      const { data } = await api.patch(`/monitors/${monitor._id}/toggle`);
      setMonitors((prev) => prev.map((m) => (m._id === monitor._id ? { ...m, ...data.monitor } : m)));
    } catch {
      enqueueSnackbar('Gagal mengubah status monitor.', { variant: 'error' });
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/monitors/${deleteTarget._id}`);
      setMonitors((prev) => prev.filter((m) => m._id !== deleteTarget._id));
      enqueueSnackbar('Monitor dihapus.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal menghapus monitor.', { variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const headline = !summary
    ? ''
    : summary.total === 0
      ? 'Belum ada yang dipantau'
      : summary.down > 0
        ? `${summary.down} layanan sedang bermasalah`
        : 'Semua sistem normal';

  const headlineColor = !summary || summary.total === 0 ? 'text.primary' : summary.down > 0 ? 'error.main' : 'success.main';

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h3" sx={{ color: headlineColor }}>
            {headline}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Gambaran umum real-time seluruh server dan situs Anda.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setEditingMonitor(null);
            setFormOpen(true);
          }}
        >
          Tambah Monitor
        </Button>
      </Stack>

      {summary && summary.total > 0 && (
        <Paper variant="outlined" sx={{ px: 3, py: 2, mb: 3 }}>
          <Stack direction="row" spacing={4} divider={<Box sx={{ width: '1px', bgcolor: 'divider' }} />} flexWrap="wrap">
            <StatGroup label="Total Monitor" value={summary.total} />
            <StatGroup label="Aktif (UP)" value={summary.up} color="status.up" />
            <StatGroup label="Bermasalah (DOWN)" value={summary.down} color={summary.down > 0 ? 'status.down' : 'text.primary'} />
            <StatGroup label="Rata-rata Respons" value={summary.avgResponse != null ? `${summary.avgResponse} ms` : '—'} />
          </Stack>
        </Paper>
      )}

      {monitors && monitors.length > 0 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
          <TextField
            size="small"
            placeholder="Cari nama atau target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, maxWidth: { sm: 320 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
          />
          <ToggleButtonGroup size="small" exclusive value={statusFilter} onChange={(e, v) => v && setStatusFilter(v)}>
            <ToggleButton value="all">Semua</ToggleButton>
            <ToggleButton value="up">UP</ToggleButton>
            <ToggleButton value="down">DOWN</ToggleButton>
            <ToggleButton value="paused">Dijeda</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {monitors === null ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : monitors.length === 0 ? (
          <EmptyState onAdd={() => setFormOpen(true)} />
        ) : filteredMonitors.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Tidak ada monitor yang cocok dengan pencarian.</Typography>
          </Box>
        ) : (
          filteredMonitors.map((monitor) => (
            <MonitorRow
              key={monitor._id}
              monitor={monitor}
              recentHeartbeats={heartbeatsByMonitor[monitor._id] || []}
              onEdit={(m) => {
                setEditingMonitor(m);
                setFormOpen(true);
              }}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
            />
          ))
        )}
      </Paper>

      <MonitorFormDialog
        open={formOpen}
        initialMonitor={editingMonitor}
        onClose={() => {
          setFormOpen(false);
          setEditingMonitor(null);
        }}
        onSubmit={handleCreateOrUpdate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus monitor ini?"
        description={`"${deleteTarget?.name}" beserta seluruh riwayat dan insidennya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

function StatGroup({ label, value, color = 'text.primary' }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: (t) => t.typography.fontFamilyMono, fontSize: '1.375rem', fontWeight: 700, color, lineHeight: 1.4 }}>
        {value}
      </Typography>
    </Box>
  );
}

function EmptyState({ onAdd }) {
  return (
    <Box sx={{ p: 8, textAlign: 'center' }}>
      <InboxRoundedIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1.5 }} />
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        Belum ada monitor
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Tambahkan situs, API, atau server pertama Anda untuk mulai memantau.
      </Typography>
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={onAdd}>
        Tambah Monitor
      </Button>
    </Box>
  );
}
