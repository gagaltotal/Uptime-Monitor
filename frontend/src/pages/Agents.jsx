import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
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
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useSocketEvent } from '../hooks/useSocket';
import { StatusDot, StatusBadge } from '../components/monitors/StatusPieces';
import ConfirmDialog from '../components/common/ConfirmDialog';

const REFRESH_INTERVAL_MS = 60 * 1000;

const INTERVAL_OPTIONS = [
  { value: 20, label: '20 detik' },
  { value: 30, label: '30 detik' },
  { value: 60, label: '1 menit' },
  { value: 120, label: '2 menit' },
  { value: 300, label: '5 menit' },
  { value: 600, label: '10 menit' },
  { value: 1800, label: '30 menit' },
  { value: 3600, label: '1 jam' },
];

const emptyForm = {
  name: '',
  description: '',
  hostname: '',
  distro: '',
  ipAddress: '',
  tags: [],
  interval: 60,
  isActive: true,
  notificationChannels: [],
};

function agentStatus(agent) {
  if (!agent.isActive) return 'paused';
  return agent.currentStatus === 'online' ? 'up' : 'down';
}

function lastSeenLabel(agent) {
  if (!agent.lastSeenAt) return 'Belum pernah';
  const diff = Date.now() - new Date(agent.lastSeenAt).getTime();
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function targetLabel(agent) {
  return agent.hostname || agent.ipAddress || agent.distro || '—';
}

function AgentRow({ agent, onEdit, onDelete, onToggle, onRegenerateToken }) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const openMenu = (event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const closeMenu = () => setAnchorEl(null);

  const status = agentStatus(agent);
  const stripeColor =
    status === 'up' ? 'status.up' : status === 'down' ? 'status.down' : 'status.paused';

  return (
    <Box
      onClick={() => navigate(`/agents/${agent._id}`)}
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
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          bgcolor: stripeColor,
        }}
      />
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <StatusDot status={status} isActive={agent.isActive} />
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {agent.name}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          noWrap
          sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'text.secondary' }}
        >
          {targetLabel(agent)}
          {agent.distro ? ` · ${agent.distro}` : ''}
        </Typography>
      </Box>
      <Box sx={{ width: 140, display: { xs: 'none', md: 'block' } }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Terakhir terlihat
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}>
          {lastSeenLabel(agent)}
        </Typography>
      </Box>
      <Box sx={{ width: 96, display: { xs: 'none', sm: 'block' } }}>
        <StatusBadge status={status} isActive={agent.isActive} />
      </Box>
      <IconButton size="small" onClick={openMenu}>
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu();
            onToggle(agent);
          }}
        >
          <ListItemIcon>
            {agent.isActive ? (
              <PauseRoundedIcon fontSize="small" />
            ) : (
              <PlayArrowRoundedIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{agent.isActive ? 'Nonaktifkan' : 'Aktifkan'}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onEdit(agent);
          }}
        >
          <ListItemIcon>
            <EditRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Ubah</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onRegenerateToken(agent);
          }}
        >
          <ListItemIcon>
            <VpnKeyRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Token Baru</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onDelete(agent);
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

export function AgentFormDialog({ open, initialAgent, onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isEdit = !!initialAgent;

  useEffect(() => {
    if (!open) return;
    setError('');
    api
      .get('/notification-channels')
      .then((res) => setChannels(res.data.channels || []))
      .catch(() => setChannels([]));
    if (initialAgent) {
      setForm({
        name: initialAgent.name || '',
        description: initialAgent.description || '',
        hostname: initialAgent.hostname || '',
        distro: initialAgent.distro || '',
        ipAddress: initialAgent.ipAddress || '',
        tags: initialAgent.tags || [],
        interval: initialAgent.interval || 60,
        isActive: initialAgent.isActive !== false,
        notificationChannels: (initialAgent.notificationChannels || []).map(
          (c) => c._id || c
        ),
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, initialAgent]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const selectedChannelObjects = useMemo(
    () => channels.filter((c) => form.notificationChannels.includes(c._id)),
    [channels, form.notificationChannels]
  );

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: form.name.trim(),
        description: form.description,
        hostname: form.hostname,
        distro: form.distro,
        ipAddress: form.ipAddress,
        tags: form.tags,
        interval: Number(form.interval),
        isActive: form.isActive,
        notificationChannels: form.notificationChannels,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan agent.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Ubah Agent' : 'Tambah Agent'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Nama"
            value={form.name}
            onChange={set('name')}
            autoFocus
            fullWidth
            required
          />
          <TextField
            label="Deskripsi"
            value={form.description}
            onChange={set('description')}
            fullWidth
            multiline
            minRows={2}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Hostname"
              value={form.hostname}
              onChange={set('hostname')}
              fullWidth
            />
            <TextField
              label="Distro"
              value={form.distro}
              onChange={set('distro')}
              fullWidth
            />
          </Stack>
          <TextField
            label="Alamat IP"
            value={form.ipAddress}
            onChange={set('ipAddress')}
            fullWidth
          />
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={form.tags}
            onChange={(_, value) => setForm((prev) => ({ ...prev, tags: value }))}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip label={option} size="small" {...getTagProps({ index })} />
              ))
            }
            renderInput={(params) => <TextField {...params} label="Tag" />}
          />
          <Divider />
          <TextField
            select
            label="Interval"
            value={form.interval}
            onChange={set('interval')}
            fullWidth
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={form.isActive} onChange={set('isActive')} />}
            label="Aktif"
          />
          <Autocomplete
            multiple
            options={channels}
            getOptionLabel={(option) => `${option.name} (${option.type})`}
            value={selectedChannelObjects}
            onChange={(_, value) =>
              setForm((prev) => ({
                ...prev,
                notificationChannels: value.map((c) => c._id),
              }))
            }
            renderInput={(params) => (
              <TextField {...params} label="Kanal Notifikasi" placeholder="Pilih kanal" />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Batal
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={saving || !form.name.trim()}
        >
          {isEdit ? 'Simpan Perubahan' : 'Tambah Agent'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TokenDialog({ open, token, onClose }) {
  const { enqueueSnackbar } = useSnackbar();
  const copy = () => {
    navigator.clipboard?.writeText(token).then(
      () => enqueueSnackbar('Token disalin ke clipboard.', { variant: 'success' }),
      () => enqueueSnackbar('Gagal menyalin token.', { variant: 'error' })
    );
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Token Agent</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning">
            Simpan token ini sekarang. Token hanya ditampilkan sekali dan tidak dapat dilihat
            lagi.
          </Alert>
          <TextField
            value={token || ''}
            fullWidth
            InputProps={{
              readOnly: true,
              sx: { fontFamily: (t) => t.typography.fontFamilyMono },
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title="Salin">
                    <IconButton onClick={copy} edge="end">
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained">
          Selesai
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Agents() {
  const { enqueueSnackbar } = useSnackbar();
  const [agents, setAgents] = useState(null);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [tokenTarget, setTokenTarget] = useState(null);
  const [issuedToken, setIssuedToken] = useState('');
  const [tokenOpen, setTokenOpen] = useState(false);

  const loadAgents = useCallback(async ({ silent } = {}) => {
    try {
      const res = await api.get('/agents');
      setAgents(res.data.agents || []);
    } catch {
      if (!silent) enqueueSnackbar('Gagal memuat daftar agent.', { variant: 'error' });
      setAgents((prev) => prev ?? []);
    }
  }, [enqueueSnackbar]);

  useEffect(() => {
    loadAgents();
    const timer = setInterval(() => loadAgents({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadAgents]);

  useSocketEvent('agent:update', (updated) => {
    setAgents((prev) =>
      prev ? prev.map((a) => (a._id === updated._id ? { ...a, ...updated } : a)) : prev
    );
  });

  useSocketEvent('agent:heartbeat', ({ agentId, metric }) => {
    setAgents((prev) =>
      prev
        ? prev.map((a) =>
            a._id === agentId
              ? {
                  ...a,
                  currentStatus: 'online',
                  lastSeenAt: metric?.recordedAt || new Date().toISOString(),
                  currentMetrics: metric || a.currentMetrics,
                }
              : a
          )
        : prev
    );
  });

  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    const term = search.trim().toLowerCase();
    if (!term) return agents;
    return agents.filter((a) =>
      [a.name, a.hostname, a.distro, a.ipAddress]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term))
    );
  }, [agents, search]);

  const summary = useMemo(() => {
    const list = agents || [];
    return {
      total: list.length,
      online: list.filter((a) => a.isActive && a.currentStatus === 'online').length,
      offline: list.filter((a) => a.isActive && a.currentStatus !== 'online').length,
    };
  }, [agents]);

  const handleCreateOrUpdate = async (payload) => {
    if (editingAgent) {
      const res = await api.put(`/agents/${editingAgent._id}`, payload);
      const updated = res.data.agent;
      setAgents((prev) => prev.map((a) => (a._id === updated._id ? updated : a)));
      enqueueSnackbar('Agent diperbarui.', { variant: 'success' });
    } else {
      const res = await api.post('/agents', payload);
      const created = res.data.agent;
      setAgents((prev) => [created, ...(prev || [])]);
      setIssuedToken(res.data.token);
      setTokenOpen(true);
      enqueueSnackbar('Agent ditambahkan.', { variant: 'success' });
    }
    setFormOpen(false);
    setEditingAgent(null);
  };

  const handleToggle = async (agent) => {
    try {
      const res = await api.patch(`/agents/${agent._id}/toggle`);
      const updated = res.data.agent;
      setAgents((prev) => prev.map((a) => (a._id === updated._id ? updated : a)));
    } catch {
      enqueueSnackbar('Gagal mengubah status agent.', { variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/agents/${deleteTarget._id}`);
      setAgents((prev) => prev.filter((a) => a._id !== deleteTarget._id));
      enqueueSnackbar('Agent dihapus.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal menghapus agent.', { variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleRegenerateToken = async (agent) => {
    try {
      const res = await api.post(`/agents/${agent._id}/token`);
      setIssuedToken(res.data.token);
      setTokenOpen(true);
    } catch {
      enqueueSnackbar('Gagal membuat token baru.', { variant: 'error' });
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
          <Typography variant="h3">Agent</Typography>
          <Typography variant="body2" color="text.secondary">
            Pantau server Linux melalui agent yang terpasang di setiap host.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setEditingAgent(null);
            setFormOpen(true);
          }}
        >
          Tambah Agent
        </Button>
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
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
            Online
          </Typography>
          <Typography
            variant="h6"
            sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'status.up' }}
          >
            {summary.online}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Terputus
          </Typography>
          <Typography
            variant="h6"
            sx={{ fontFamily: (t) => t.typography.fontFamilyMono, color: 'status.down' }}
          >
            {summary.offline}
          </Typography>
        </Box>
      </Stack>

      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cari agent..."
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
        {!agents ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : filteredAgents.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <DnsRoundedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">
              {agents.length === 0
                ? 'Belum ada agent. Tambahkan agent untuk mulai memantau server.'
                : 'Tidak ada agent yang cocok dengan pencarian.'}
            </Typography>
          </Box>
        ) : (
          filteredAgents.map((agent) => (
            <AgentRow
              key={agent._id}
              agent={agent}
              onEdit={(a) => {
                setEditingAgent(a);
                setFormOpen(true);
              }}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
              onRegenerateToken={handleRegenerateToken}
            />
          ))
        )}
      </Paper>

      <AgentFormDialog
        open={formOpen}
        initialAgent={editingAgent}
        onClose={() => {
          setFormOpen(false);
          setEditingAgent(null);
        }}
        onSubmit={handleCreateOrUpdate}
      />

      <TokenDialog open={tokenOpen} token={issuedToken} onClose={() => setTokenOpen(false)} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Agent"
        description={`Hapus agent "${deleteTarget?.name || ''}"? Semua metrik, insiden, dan log terkait akan dihapus.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
