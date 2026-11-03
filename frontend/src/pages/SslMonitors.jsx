import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SslMonitorFormDialog from '../components/ssl/SslMonitorFormDialog';
import {
  SslStatusChip,
  SslStatusDot,
  DaysLeft,
  formatDate,
  lastNotifiedLabel,
} from '../components/ssl/SslPieces';

const REFRESH_INTERVAL_MS = 60 * 1000;

function sslTarget(ssl) {
  return ssl.port && ssl.port !== 443 ? `${ssl.domain}:${ssl.port}` : ssl.domain;
}

function SslRow({ ssl, onEdit, onDelete, onToggle, onCheck, checking }) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const openMenu = (event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const closeMenu = () => setAnchorEl(null);

  const stripe =
    !ssl.isActive
      ? 'status.paused'
      : ssl.status === 'valid'
      ? 'status.up'
      : ssl.status === 'pending'
      ? 'status.pending'
      : ssl.status === 'expiring'
      ? 'warning.main'
      : 'status.down';

  return (
    <Box
      onClick={() => navigate(`/ssl/${ssl._id}`)}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.5,
        cursor: 'pointer',
        borderBottom: (t) => `1px solid ${t.palette.surface.line}`,
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: stripe }} />

      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SslStatusDot status={ssl.status} isActive={ssl.isActive} />
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {ssl.name}
          </Typography>
          {ssl.ongoingIncidents > 0 && (
            <Chip
              size="small"
              color="error"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem' }}
              label="INSIDEN"
            />
          )}
        </Stack>
        <Typography
          variant="caption"
          noWrap
          sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'text.secondary' }}
        >
          {sslTarget(ssl)}
          {ssl.issuer ? ` · ${ssl.issuer}` : ''}
        </Typography>
        {ssl.tags?.length ? (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
            {ssl.tags.slice(0, 3).map((tag) => (
              <Chip key={tag} label={`#${tag}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
            ))}
          </Stack>
        ) : null}
      </Box>

      <Box sx={{ width: 160, display: { xs: 'none', md: 'block' } }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Kedaluwarsa
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}>
          {formatDate(ssl.expiresAt)}
        </Typography>
      </Box>

      <Box sx={{ width: 110, display: { xs: 'none', sm: 'block' } }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Sisa
        </Typography>
        <DaysLeft days={ssl.daysRemaining} />
      </Box>

      <Box sx={{ width: 150, display: { xs: 'none', lg: 'block' } }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Terakhir dinotifikasi
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}>
          {lastNotifiedLabel(ssl.lastNotifiedAt)}
        </Typography>
      </Box>

      <Box sx={{ width: 140, display: { xs: 'none', sm: 'block' } }}>
        <SslStatusChip status={ssl.status} isActive={ssl.isActive} />
      </Box>

      <Tooltip title="Periksa sekarang">
        <span>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onCheck(ssl);
            }}
            disabled={checking}
          >
            {checking ? <CircularProgress size={16} /> : <RefreshRoundedIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>

      <IconButton size="small" aria-label={`Menu tindakan ${ssl.name}`} onClick={openMenu}>
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={closeMenu} onClick={(event) => event.stopPropagation()}>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation();
            closeMenu();
            onToggle(ssl);
          }}
        >
          <ListItemIcon>
            {ssl.isActive ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{ssl.isActive ? 'Nonaktifkan' : 'Aktifkan'}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation();
            closeMenu();
            onEdit(ssl);
          }}
        >
          <ListItemIcon>
            <EditRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Ubah</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={(event) => {
            event.stopPropagation();
            closeMenu();
            onDelete(ssl);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Hapus</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default function SslMonitors() {
  const { enqueueSnackbar } = useSnackbar();
  const [monitors, setMonitors] = useState(null);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [checkingId, setCheckingId] = useState(null);

  const loadMonitors = useCallback(
    async ({ silent } = {}) => {
      try {
        const res = await api.get('/ssl');
        setMonitors(res.data.monitors || []);
      } catch {
        if (!silent) enqueueSnackbar('Gagal memuat daftar monitor SSL.', { variant: 'error' });
        setMonitors((prev) => prev ?? []);
      }
    },
    [enqueueSnackbar]
  );

  useEffect(() => {
    loadMonitors();
    const timer = setInterval(() => loadMonitors({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadMonitors]);

  useSocketEvent('ssl:update', (updated) => {
    setMonitors((prev) =>
      prev ? prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)) : prev
    );
  });

  useSocketEvent('ssl:incident', () => {
    // Incident edge — refresh so the "INSIDEN" badge stays accurate.
    loadMonitors({ silent: true });
  });

  const filtered = useMemo(() => {
    if (!monitors) return [];
    const term = search.trim().toLowerCase();
    if (!term) return monitors;
    return monitors.filter((m) =>
      [m.name, m.domain, m.issuer]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [monitors, search]);

  const summary = useMemo(() => {
    const list = monitors || [];
    return {
      total: list.length,
      valid: list.filter((m) => m.status === 'valid').length,
      expiring: list.filter((m) => m.status === 'expiring').length,
      expired: list.filter((m) => m.status === 'expired' || m.status === 'error').length,
    };
  }, [monitors]);

  const handleCreateOrUpdate = async (payload) => {
    if (editing) {
      const res = await api.put(`/ssl/${editing._id}`, payload);
      const updated = res.data.monitor;
      setMonitors((prev) => prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)));
      enqueueSnackbar('Monitor SSL diperbarui.', { variant: 'success' });
    } else {
      const res = await api.post('/ssl', payload);
      const created = res.data.monitor;
      setMonitors((prev) => [created, ...(prev || [])]);
      enqueueSnackbar('Monitor SSL ditambahkan.', { variant: 'success' });
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handleToggle = async (ssl) => {
    try {
      const res = await api.patch(`/ssl/${ssl._id}/toggle`);
      const updated = res.data.monitor;
      setMonitors((prev) => prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)));
    } catch {
      enqueueSnackbar('Gagal mengubah status monitor SSL.', { variant: 'error' });
    }
  };

  const handleCheck = async (ssl) => {
    setCheckingId(ssl._id);
    try {
      const res = await api.post(`/ssl/${ssl._id}/check`);
      const updated = res.data.monitor;
      setMonitors((prev) => prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)));
      enqueueSnackbar('Pengecekan selesai.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal memeriksa sertifikat.', { variant: 'error' });
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/ssl/${deleteTarget._id}`);
      setMonitors((prev) => prev.filter((m) => m._id !== deleteTarget._id));
      enqueueSnackbar('Monitor SSL dihapus.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal menghapus monitor SSL.', { variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h3">SSL &amp; Domain</Typography>
          <Typography variant="body2" color="text.secondary">
            Pantau masa berlaku sertifikat SSL/TLS: domain, penerbit, tanggal kedaluwarsa, dan sisa hari.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Tambah Monitor
        </Button>
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Total
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}>
            {summary.total}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Valid
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'status.up' }}>
            {summary.valid}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Segera Expired
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'warning.main' }}>
            {summary.expiring}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Kedaluwarsa / Gagal
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'status.down' }}>
            {summary.expired}
          </Typography>
        </Box>
      </Stack>

      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cari domain, nama, atau penerbit..."
        size="small"
        fullWidth
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchRoundedIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      <Paper variant="outlined">
        {!monitors ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <VerifiedUserRoundedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">
              {monitors.length === 0
                ? 'Belum ada monitor SSL. Tambahkan domain untuk mulai memantau sertifikatnya.'
                : 'Tidak ada monitor SSL yang cocok dengan pencarian.'}
            </Typography>
          </Box>
        ) : (
          filtered.map((ssl) => (
            <SslRow
              key={ssl._id}
              ssl={ssl}
              checking={checkingId === ssl._id}
              onEdit={(m) => {
                setEditing(m);
                setFormOpen(true);
              }}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
              onCheck={handleCheck}
            />
          ))
        )}
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Sisa hari ditampilkan hijau bila masih jauh, kuning saat masuk ambang peringatan, dan merah
        saat ≤ 7 hari atau sudah kedaluwarsa.
      </Typography>

      <SslMonitorFormDialog
        open={formOpen}
        initialMonitor={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleCreateOrUpdate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Monitor SSL"
        description={`Hapus monitor SSL "${deleteTarget?.name || ''}"? Semua riwayat insiden terkait akan dihapus.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
