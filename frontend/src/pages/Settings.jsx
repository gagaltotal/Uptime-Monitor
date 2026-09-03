import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/common/ConfirmDialog';

export default function Settings() {
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 3 }}>
        Pengaturan
      </Typography>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tab label="Notifikasi" />
        <Tab label="Akun" />
        <Tab label="Pengguna" />
      </Tabs>
      {tab === 0 && <NotificationsTab />}
      {tab === 1 && <AccountTab />}
      {tab === 2 && <UsersTab />}
    </Box>
  );
}

// --- Tab: Notifikasi -------------------------------------------------------
const emptyChannel = { name: '', type: 'discord', webhookUrl: '' };

function NotificationsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [channels, setChannels] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [form, setForm] = useState(emptyChannel);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/notification-channels').then((r) => setChannels(r.data.channels));

  useEffect(() => {
    load().catch(() => enqueueSnackbar('Gagal memuat channel notifikasi.', { variant: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setError('');
    setSaving(true);
    try {
      const { data } = await api.post('/notification-channels', form);
      setChannels((prev) => [data.channel, ...(prev || [])]);
      setDialogOpen(false);
      setForm(emptyChannel);
      enqueueSnackbar('Channel notifikasi ditambahkan.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menambahkan channel.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel) => {
    setTestingId(channel._id);
    try {
      await api.post(`/notification-channels/${channel._id}/test`);
      enqueueSnackbar(`Notifikasi uji coba terkirim ke "${channel.name}".`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Gagal mengirim notifikasi uji coba.', { variant: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/notification-channels/${deleteTarget._id}`);
      setChannels((prev) => prev.filter((c) => c._id !== deleteTarget._id));
      enqueueSnackbar('Channel dihapus.', { variant: 'success' });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
          Hubungkan Discord atau Slack agar mendapat notifikasi saat ada layanan down atau sertifikat SSL akan kedaluwarsa.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setForm(emptyChannel);
            setError('');
            setDialogOpen(true);
          }}
        >
          Tambah Channel
        </Button>
      </Stack>

      <Paper variant="outlined">
        {!channels ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : channels.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Belum ada channel notifikasi.</Typography>
          </Box>
        ) : (
          channels.map((c) => (
            <Box
              key={c._id}
              sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
            >
              <Chip size="small" label={c.type === 'discord' ? 'Discord' : 'Slack'} />
              <Typography sx={{ flex: 1 }} fontWeight={600}>
                {c.name}
              </Typography>
              <Tooltip title="Kirim notifikasi uji coba">
                <span>
                  <IconButton size="small" onClick={() => handleTest(c)} disabled={testingId === c._id}>
                    <ScienceRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton size="small" color="error" onClick={() => setDeleteTarget(c)}>
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Tambah Channel Notifikasi</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              select
              label="Tipe"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              fullWidth
            >
              <MenuItem value="discord">Discord</MenuItem>
              <MenuItem value="slack">Slack</MenuItem>
            </TextField>
            <TextField
              label="Nama Channel"
              placeholder="mis. Tim Ops"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
            />
            <TextField
              label="URL Webhook"
              placeholder={form.type === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'}
              value={form.webhookUrl}
              onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button color="inherit" onClick={() => setDialogOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !form.name || !form.webhookUrl}>
            Simpan
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus channel ini?"
        description={`Monitor yang memakai channel "${deleteTarget?.name}" tidak akan mengirim notifikasi lagi ke sana.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

// --- Tab: Akun ---------------------------------------------------------
function AccountTab() {
  const { user, refreshMe } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [name, setName] = useState(user?.name || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const handleProfileSave = async () => {
    setSavingProfile(true);
    try {
      await api.patch('/auth/profile', { name });
      await refreshMe();
      enqueueSnackbar('Profil diperbarui.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal memperbarui profil.', { variant: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    setSavingPassword(true);
    try {
      await api.patch('/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      enqueueSnackbar('Kata sandi berhasil diubah. Sesi lain telah dikeluarkan otomatis.', { variant: 'success' });
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Gagal mengubah kata sandi.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 420 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Profil
        </Typography>
        <Stack spacing={2}>
          <TextField label="Email" value={user?.email || ''} disabled fullWidth />
          <TextField label="Nama" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Button variant="contained" onClick={handleProfileSave} disabled={savingProfile || !name.trim()} sx={{ alignSelf: 'flex-start' }}>
            Simpan Profil
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Ubah Kata Sandi
        </Typography>
        {passwordError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {passwordError}
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField
            label="Kata Sandi Saat Ini"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            fullWidth
          />
          <TextField
            label="Kata Sandi Baru"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            helperText="Minimal 8 karakter"
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handlePasswordChange}
            disabled={savingPassword || !currentPassword || newPassword.length < 8}
            sx={{ alignSelf: 'flex-start' }}
          >
            Ubah Kata Sandi
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

// --- Tab: Pengguna -------------------------------------------------------
const emptyUser = { name: '', email: '', password: '' };

function UsersTab() {
  const { user: currentUser } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [users, setUsers] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyUser);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => api.get('/auth/users').then((r) => setUsers(r.data.users));

  useEffect(() => {
    load().catch(() => enqueueSnackbar('Gagal memuat daftar pengguna.', { variant: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setError('');
    setSaving(true);
    try {
      const { data } = await api.post('/auth/users', form);
      setUsers((prev) => [...(prev || []), data.user]);
      setDialogOpen(false);
      setForm(emptyUser);
      enqueueSnackbar('Pengguna ditambahkan.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menambahkan pengguna.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/auth/users/${deleteTarget._id}`);
      setUsers((prev) => prev.filter((u) => u._id !== deleteTarget._id));
      enqueueSnackbar('Pengguna dihapus.', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Gagal menghapus pengguna.', { variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setForm(emptyUser);
            setError('');
            setDialogOpen(true);
          }}
        >
          Tambah Pengguna
        </Button>
      </Stack>

      <Paper variant="outlined">
        {!users ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : (
          users.map((u) => (
            <Box
              key={u._id}
              sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
            >
              <Avatar sx={{ width: 32, height: 32, fontSize: '0.85rem', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                {u.name?.[0]?.toUpperCase()}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={600} noWrap>
                  {u.name} {u._id === currentUser?._id && <Chip size="small" label="Anda" sx={{ ml: 1 }} />}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {u.email}
                </Typography>
              </Box>
              <Tooltip title={u._id === currentUser?._id ? 'Tidak dapat menghapus akun sendiri' : 'Hapus pengguna'}>
                <span>
                  <IconButton size="small" color="error" disabled={u._id === currentUser?._id} onClick={() => setDeleteTarget(u)}>
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          ))
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Tambah Pengguna</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Nama" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Kata Sandi Sementara"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              helperText="Minimal 8 karakter"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button color="inherit" onClick={() => setDialogOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || !form.name || !form.email || form.password.length < 8}>
            Tambah
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus pengguna ini?"
        description={`"${deleteTarget?.name}" tidak akan bisa masuk lagi setelah dihapus.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
