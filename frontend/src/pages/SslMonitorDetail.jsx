import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SslMonitorFormDialog from '../components/ssl/SslMonitorFormDialog';
import {
  SslStatusChip,
  DaysLeft,
  formatDate,
  formatDateTime,
  lastNotifiedLabel,
} from '../components/ssl/SslPieces';

const REFRESH_INTERVAL_MS = 60 * 1000;

const INCIDENT_TYPE_LABEL = {
  expiring: 'Segera Kedaluwarsa',
  expired: 'Kedaluwarsa',
  error: 'Gagal Dicek',
};

function sslTarget(ssl) {
  return ssl.port && ssl.port !== 443 ? `${ssl.domain}:${ssl.port}` : ssl.domain;
}

function durationLabel(seconds) {
  if (!seconds) return 'Sedang berlangsung';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} jam`;
  return `${Math.round(seconds / 60)} menit`;
}

function StatCard({ label, value, mono, color }) {
  return (
    <Box
      sx={{
        px: { xs: 2, sm: 1.75, md: 2 },
        py: { xs: 1.25, sm: 1.5 },
        minWidth: 0,
        borderColor: (t) => t.palette.surface.line,
        borderBottom: { xs: '1px solid', sm: 'none' },
        borderRight: { xs: 'none', sm: '1px solid' },
        '&:last-of-type': { borderBottom: 'none', borderRight: 'none' },
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 0.25, lineHeight: 1.35 }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: (t) => (mono ? t.typography.fontFamilyMono : undefined),
          fontSize: { xs: '1.05rem', sm: '1.15rem', md: '1.25rem' },
          fontWeight: 700,
          lineHeight: 1.25,
          color,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      spacing={2}
      sx={{ py: 1.25, borderBottom: (t) => `1px solid ${t.palette.surface.line}`, '&:last-of-type': { borderBottom: 'none' } }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: (t) => (mono ? t.typography.fontFamilyMono : undefined), textAlign: 'right', wordBreak: 'break-word' }}
      >
        {value ?? '—'}
      </Typography>
    </Stack>
  );
}

function IncidentRow({ incident }) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.5,
        borderBottom: (t) => `1px solid ${t.palette.surface.line}`,
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            label={INCIDENT_TYPE_LABEL[incident.type] || incident.type}
            color={incident.severity === 'critical' ? 'error' : 'warning'}
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
          <Chip
            size="small"
            label={incident.status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
            color={incident.status === 'ongoing' ? 'error' : 'default'}
            sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {formatDateTime(incident.startedAt)}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        {incident.cause || '—'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Durasi: {durationLabel(incident.durationSeconds)}
      </Typography>
    </Box>
  );
}

export default function SslMonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        const res = await api.get(`/ssl/${id}`);
        setData(res.data.monitor);
        setIncidents(res.data.incidents || []);
      } catch (err) {
        if (!silent) {
          setError(err.response?.data?.message || 'Gagal memuat detail monitor SSL.');
        }
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useSocketEvent('ssl:update', (updated) => {
    if (updated._id === id) setData((prev) => ({ ...prev, ...updated }));
  });

  useSocketEvent('ssl:incident', (incident) => {
    if (incident.sslMonitor === id || incident.sslMonitor?._id === id) load({ silent: true });
  });

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await api.post(`/ssl/${id}/check`);
      setData((prev) => ({ ...prev, ...res.data.monitor }));
      await load({ silent: true });
      enqueueSnackbar('Pengecekan selesai.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal memeriksa sertifikat.', { variant: 'error' });
    } finally {
      setChecking(false);
    }
  };

  const handleToggle = async () => {
    try {
      const res = await api.patch(`/ssl/${id}/toggle`);
      setData((prev) => ({ ...prev, ...res.data.monitor }));
    } catch {
      enqueueSnackbar('Gagal mengubah status.', { variant: 'error' });
    }
  };

  const handleUpdate = async (payload) => {
    const res = await api.put(`/ssl/${id}`, payload);
    setData((prev) => ({ ...prev, ...res.data.monitor }));
    enqueueSnackbar('Monitor SSL diperbarui.', { variant: 'success' });
    setFormOpen(false);
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/ssl/${id}`);
      enqueueSnackbar('Monitor SSL dihapus.', { variant: 'success' });
      navigate('/ssl');
    } catch {
      enqueueSnackbar('Gagal menghapus monitor SSL.', { variant: 'error' });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate('/ssl')} sx={{ mb: 2 }}>
          Kembali
        </Button>
        <Alert severity="error">{error || 'Monitor SSL tidak ditemukan.'}</Alert>
      </Box>
    );
  }

  const ssl = data;
  const ongoing = incidents.filter((i) => i.status === 'ongoing').length;

  return (
    <Box>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate('/ssl')} sx={{ mb: 2 }}>
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
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="h3" noWrap>
              {ssl.name}
            </Typography>
            <SslStatusChip status={ssl.status} isActive={ssl.isActive} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}>
            {sslTarget(ssl)}
            {ssl.issuer ? ` · ${ssl.issuer}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            variant="outlined"
            startIcon={checking ? <CircularProgress size={16} /> : <RefreshRoundedIcon />}
            onClick={handleCheck}
            disabled={checking}
          >
            Periksa
          </Button>
          <Tooltip title={ssl.isActive ? 'Nonaktifkan' : 'Aktifkan'}>
            <IconButton onClick={handleToggle}>
              {ssl.isActive ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
            </IconButton>
          </Tooltip>
          <IconButton onClick={() => setFormOpen(true)}>
            <EditRoundedIcon />
          </IconButton>
          <IconButton color="error" onClick={() => setDeleteOpen(true)}>
            <DeleteRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      {ssl.status === 'expired' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Sertifikat sudah <strong>kedaluwarsa</strong>. Segera perbarui agar situs kembali aman diakses.
        </Alert>
      )}
      {ssl.status === 'expiring' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Sertifikat akan kedaluwarsa dalam <strong>{ssl.daysRemaining} hari</strong>. Segera lakukan perpanjangan.
        </Alert>
      )}
      {ssl.status === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Gagal membaca sertifikat: {ssl.lastMessage || 'Pengecekan TLS gagal.'}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 1 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, flex: '1 1 60%' }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Informasi Sertifikat
          </Typography>
          <DetailRow label="Domain" value={sslTarget(ssl)} mono />
          <DetailRow label="Penerbit (Issuer)" value={ssl.issuer} />
          <DetailRow label="Subjek" value={ssl.subject} />
          <DetailRow label="Nomor Seri" value={ssl.serialNumber} mono />
          <DetailRow label="Berlaku sejak" value={formatDate(ssl.validFrom)} />
          <DetailRow label="Tanggal Kedaluwarsa" value={formatDate(ssl.expiresAt)} />
          <DetailRow
            label="Sisa hari"
            value={<DaysLeft days={ssl.daysRemaining} />}
          />
          <DetailRow label="Status" value={<SslStatusChip status={ssl.status} isActive={ssl.isActive} />} />
          <DetailRow label="Terakhir dinotifikasi" value={lastNotifiedLabel(ssl.lastNotifiedAt)} />
          <DetailRow label="Terakhir dicek" value={ssl.lastCheckedAt ? formatDateTime(ssl.lastCheckedAt) : 'Belum pernah'} />
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, flex: '1 1 40%' }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Ringkasan
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
              border: (t) => `1px solid ${t.palette.surface.line}`,
              borderRadius: 1.5,
              overflow: 'hidden',
              mb: 2,
            }}
          >
            <StatCard
              label="Sisa hari"
              value={ssl.daysRemaining ?? '—'}
              mono
              color={(t) => (ssl.daysRemaining < 0 ? t.palette.status.down : undefined)}
            />
            <StatCard label="Insiden aktif" value={ongoing} mono />
            <StatCard label="Total insiden" value={incidents.length} mono />
          </Box>
          <Divider sx={{ mb: 2 }} />
          <DetailRow label="Interval" value={`${Math.round(ssl.interval / 60)} menit`} />
          <DetailRow label="Ambang peringatan" value={`${ssl.alertThresholdDays ?? 14} hari`} />
          <DetailRow label="Timeout" value={`${ssl.timeout} detik`} />
          <DetailRow label="Percobaan ulang" value={ssl.retries ?? 1} />
          <DetailRow
            label="Kanal notifikasi"
            value={
              ssl.notificationChannels?.length
                ? ssl.notificationChannels.map((c) => c.name || c).join(', ')
                : 'Tidak ada'
            }
          />
        </Paper>
      </Stack>

      <Paper variant="outlined" sx={{ mt: 3 }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="h6">Riwayat Insiden</Typography>
        </Box>
        <Divider />
        {incidents.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <Typography color="text.secondary">Belum ada insiden untuk monitor ini.</Typography>
          </Box>
        ) : (
          incidents.map((incident) => <IncidentRow key={incident._id} incident={incident} />)
        )}
      </Paper>

      <SslMonitorFormDialog
        open={formOpen}
        initialMonitor={ssl}
        onClose={() => setFormOpen(false)}
        onSubmit={handleUpdate}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus Monitor SSL"
        description={`Hapus monitor SSL "${ssl.name}"? Semua riwayat insiden terkait akan dihapus.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </Box>
  );
}
