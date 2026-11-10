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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/common/ConfirmDialog';

// Role hanya mengubah apa yang tampil di UI — backend tetap menegakkan
// aturannya lewat middleware requireSuperAdmin.
const ROLE_META = {
  superadmin: { label: 'Super Admin', description: 'Akses penuh, termasuk manajemen pengguna.' },
  admin: { label: 'Admin', description: 'Dapat mengelola data & pengaturan, tanpa manajemen pengguna.' },
};

export default function Settings() {
  const { isSuperAdmin } = useAuth();
  const [tab, setTab] = useState(0);

  // Tab "Pengguna" hanya relevan untuk superadmin; menyembunyikannya lebih
  // jelas daripada menampilkannya lalu gagal memuat data.
  const tabs = isSuperAdmin
    ? ['Notifikasi', 'Akun', 'Pengguna']
    : ['Notifikasi', 'Akun'];

  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 3 }}>
        Pengaturan
      </Typography>
      <Tabs
        value={Math.min(tab, tabs.length - 1)}
        onChange={(e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {tabs.map((label) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      {tab === 0 && <NotificationsTab />}
      {tab === 1 && <AccountTab />}
      {tab === 2 && isSuperAdmin && <UsersTab />}
    </Box>
  );
}

// --- Tab: Notifikasi -------------------------------------------------------
const emptyChannel = {
  name: '',
  type: 'discord',
  webhookUrl: '',
  telegramBotToken: '',
  telegramChatId: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  emailFrom: '',
  emailTo: '',
};

const CHANNEL_TYPE_META = {
  discord: { label: 'Discord', color: 'primary' },
  slack: { label: 'Slack', color: 'secondary' },
  telegram: { label: 'Telegram', color: 'info' },
  email: { label: 'Email (SMTP)', color: 'success' },
};

function channelSummary(c) {
  if (c.type === 'email') {
    const recipients = Array.isArray(c.emailTo) ? c.emailTo : [];
    const host = c.smtpHost ? `${c.smtpHost}${c.smtpPort ? `:${c.smtpPort}` : ''}` : '-';
    return `${host} → ${recipients.length ? recipients.join(', ') : 'belum ada penerima'}`;
  }
  if (c.type === 'telegram') return `Chat ID: ${c.telegramChatId || '-'}`;
  return 'Webhook terhubung';
}

function NotificationsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [channels, setChannels] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
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

  const openCreate = () => {
    setEditTarget(null);
    setForm(emptyChannel);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (channel) => {
    setEditTarget(channel);
    setForm({
      ...emptyChannel,
      name: channel.name || '',
      type: channel.type || 'discord',
      // Rahasia tidak pernah dikirim balik oleh backend. Dibiarkan kosong =
      // "jangan ubah", nilai lama dipertahankan di server.
      telegramChatId: channel.telegramChatId || '',
      smtpHost: channel.smtpHost || '',
      smtpPort: channel.smtpPort ?? 587,
      smtpSecure: !!channel.smtpSecure,
      smtpUser: channel.smtpUser || '',
      emailFrom: channel.emailFrom || '',
      emailTo: Array.isArray(channel.emailTo) ? channel.emailTo.join(', ') : '',
    });
    setError('');
    setDialogOpen(true);
  };

  const buildPayload = () => {
    // isActive ikut dikirim agar menyimpan perubahan tidak diam-diam
    // mengaktifkan kembali channel yang sengaja dinonaktifkan.
    const isActive = editTarget ? editTarget.isActive !== false : true;
    if (form.type === 'email') {
      return {
        name: form.name,
        type: 'email',
        smtpHost: form.smtpHost,
        smtpPort: Number(form.smtpPort) || 587,
        smtpSecure: !!form.smtpSecure,
        smtpUser: form.smtpUser,
        smtpPassword: form.smtpPassword,
        emailFrom: form.emailFrom,
        // Backend menerima string berkoma maupun array — dikirim string agar
        // operator bisa menempel daftar penerima sekaligus.
        emailTo: form.emailTo,
        isActive,
      };
    }
    if (form.type === 'telegram') {
      return {
        name: form.name,
        type: 'telegram',
        telegramBotToken: form.telegramBotToken,
        telegramChatId: form.telegramChatId,
        isActive,
      };
    }
    return { name: form.name, type: form.type, webhookUrl: form.webhookUrl, isActive };
  };

  const isFormValid = () => {
    if (!form.name.trim()) return false;
    if (form.type === 'email') return !!form.smtpHost.trim() && !!form.emailTo.trim();
    if (form.type === 'telegram') {
      // Saat edit, token boleh kosong (dipertahankan dari server).
      const tokenOk = editTarget?.hasTelegramBotToken || !!form.telegramBotToken.trim();
      return tokenOk && !!form.telegramChatId.trim();
    }
    return editTarget?.hasWebhookUrl || !!form.webhookUrl.trim();
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      if (editTarget) {
        const { data } = await api.put(`/notification-channels/${editTarget._id}`, buildPayload());
        setChannels((prev) => prev.map((c) => (c._id === data.channel._id ? data.channel : c)));
        enqueueSnackbar('Channel notifikasi diperbarui.', { variant: 'success' });
      } else {
        const { data } = await api.post('/notification-channels', buildPayload());
        setChannels((prev) => [data.channel, ...(prev || [])]);
        enqueueSnackbar('Channel notifikasi ditambahkan.', { variant: 'success' });
      }
      setDialogOpen(false);
      setForm(emptyChannel);
      setEditTarget(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan channel.');
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
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: { xs: '100%', sm: 520 } }}>
          Hubungkan Discord, Slack, Telegram, atau server SMTP email agar mendapat notifikasi saat ada layanan down
          atau sertifikat SSL akan kedaluwarsa.
        </Typography>
        <Button
          variant="contained"
          fullWidth
          startIcon={<AddRoundedIcon />}
          onClick={openCreate}
          sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' }}
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
          channels.map((c) => {
            const meta = CHANNEL_TYPE_META[c.type] || { label: c.type, color: 'default' };
            return (
              <Box
                key={c._id}
                sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
              >
                <Chip size="small" label={meta.label} color={meta.color} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={600} noWrap>
                    {c.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {channelSummary(c)}
                  </Typography>
                </Box>
                <Tooltip title="Edit channel">
                  <IconButton size="small" onClick={() => openEdit(c)}>
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
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
            );
          })
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editTarget ? 'Edit Channel Notifikasi' : 'Tambah Channel Notifikasi'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              select
              label="Tipe"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              fullWidth
              disabled={!!editTarget}
              helperText={editTarget ? 'Tipe channel tidak dapat diubah setelah dibuat.' : undefined}
            >
              <MenuItem value="discord">Discord</MenuItem>
              <MenuItem value="slack">Slack</MenuItem>
              <MenuItem value="telegram">Telegram</MenuItem>
              <MenuItem value="email">Email (SMTP)</MenuItem>
            </TextField>
            <TextField
              label="Nama Channel"
              placeholder="mis. Tim Ops"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
            />
            {form.type === 'telegram' ? (
              <>
                <TextField
                  label="Bot Token"
                  placeholder={editTarget?.hasTelegramBotToken ? '••••••• (kosongkan agar tidak berubah)' : 'mis. 123456789:AA...'}
                  value={form.telegramBotToken}
                  onChange={(e) => setForm((f) => ({ ...f, telegramBotToken: e.target.value }))}
                  helperText="Token bot dari @BotFather."
                  fullWidth
                />
                <TextField
                  label="Chat ID"
                  placeholder="mis. -1001234567890"
                  value={form.telegramChatId}
                  onChange={(e) => setForm((f) => ({ ...f, telegramChatId: e.target.value }))}
                  helperText="ID chat/grup tujuan notifikasi."
                  fullWidth
                />
              </>
            ) : form.type === 'email' ? (
              <EmailChannelFields form={form} setForm={setForm} editTarget={editTarget} />
            ) : (
              <TextField
                label="URL Webhook"
                placeholder={
                  editTarget?.hasWebhookUrl
                    ? '••••••• (kosongkan agar tidak berubah)'
                    : form.type === 'discord'
                      ? 'https://discord.com/api/webhooks/...'
                      : 'https://hooks.slack.com/services/...'
                }
                value={form.webhookUrl}
                onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button color="inherit" onClick={() => setDialogOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !isFormValid()}>
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

// Field khusus channel email/SMTP. Dipisah agar alur tipe lain tetap ringkas.
function EmailChannelFields({ form, setForm, editTarget }) {
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Host SMTP"
          placeholder="mis. smtp.gmail.com"
          value={form.smtpHost}
          onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
          fullWidth
        />
        <TextField
          label="Port"
          type="number"
          value={form.smtpPort}
          onChange={(e) => setForm((f) => ({ ...f, smtpPort: e.target.value }))}
          sx={{ width: { xs: '100%', sm: 140 } }}
          helperText="587 / 465"
        />
      </Stack>
      <FormControlLabel
        control={
          <Switch
            checked={!!form.smtpSecure}
            onChange={(e) => setForm((f) => ({ ...f, smtpSecure: e.target.checked }))}
          />
        }
        label="Gunakan TLS langsung (biasanya port 465)"
        sx={{ m: 0, alignSelf: 'flex-start' }}
      />
      <TextField
        label="Username SMTP"
        placeholder="mis. notifikasi@contoh.com"
        value={form.smtpUser}
        onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
        helperText="Kosongkan bila server SMTP tidak memakai autentikasi."
        fullWidth
      />
      <TextField
        label="Password SMTP"
        type="password"
        placeholder={editTarget?.hasSmtpPassword ? '••••••• (kosongkan agar tidak berubah)' : 'Password / App Password'}
        value={form.smtpPassword}
        onChange={(e) => setForm((f) => ({ ...f, smtpPassword: e.target.value }))}
        fullWidth
        autoComplete="new-password"
      />
      <TextField
        label="Email Pengirim (From)"
        placeholder="mis. Uptime Monitor <notifikasi@contoh.com>"
        value={form.emailFrom}
        onChange={(e) => setForm((f) => ({ ...f, emailFrom: e.target.value }))}
        helperText="Opsional. Bila kosong, dipakai username SMTP."
        fullWidth
      />
      <TextField
        label="Email Penerima (To)"
        placeholder="mis. ops@contoh.com, oncall@contoh.com"
        value={form.emailTo}
        onChange={(e) => setForm((f) => ({ ...f, emailTo: e.target.value }))}
        helperText="Pisahkan beberapa alamat dengan koma."
        fullWidth
        multiline
        minRows={1}
      />
    </>
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
const emptyUser = { name: '', email: '', password: '', role: 'admin', isActive: true };

function RoleChip({ role }) {
  const meta = ROLE_META[role] || ROLE_META.admin;
  return (
    <Chip
      size="small"
      label={meta.label}
      color={role === 'superadmin' ? 'primary' : 'default'}
      variant={role === 'superadmin' ? 'filled' : 'outlined'}
      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
    />
  );
}

function StatusChip({ isActive }) {
  return (
    <Chip
      size="small"
      label={isActive ? 'Aktif' : 'Nonaktif'}
      color={isActive ? 'success' : 'default'}
      variant={isActive ? 'outlined' : 'filled'}
      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
    />
  );
}

function UsersTab() {
  const { user: currentUser, refreshMe } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [users, setUsers] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = mode tambah
  const [form, setForm] = useState(emptyUser);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const load = () => api.get('/auth/users').then((r) => setUsers(r.data.users));

  useEffect(() => {
    load().catch(() => enqueueSnackbar('Gagal memuat daftar pengguna.', { variant: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyUser);
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email, password: '', role: u.role || 'admin', isActive: u.isActive !== false });
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      if (editing) {
        // Kata sandi hanya dikirim bila diisi — itu berarti reset kata sandi
        // oleh superadmin, dan sesi lama pengguna tersebut otomatis batal.
        const payload = {
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        const { data } = await api.patch(`/auth/users/${editing._id}`, payload);
        setUsers((prev) => prev.map((u) => (u._id === data.user._id ? data.user : u)));
        // Bila superadmin mengubah namanya sendiri, nama di header/sidebar
        // harus ikut berubah tanpa perlu reload halaman.
        if (data.user._id === currentUser?._id) await refreshMe();
        enqueueSnackbar('Perubahan pengguna disimpan.', { variant: 'success' });
      } else {
        const { data } = await api.post('/auth/users', {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          isActive: form.isActive,
        });
        setUsers((prev) => [...(prev || []), data.user]);
        enqueueSnackbar('Pengguna ditambahkan.', { variant: 'success' });
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan pengguna.');
    } finally {
      setSaving(false);
    }
  };

  // Aktif/nonaktifkan akun langsung dari daftar. Backend menolak bila ini akan
  // mematikan superadmin aktif terakhir, jadi pesan errornya diteruskan apa
  // adanya agar alasannya jelas.
  const handleToggle = async (u) => {
    setTogglingId(u._id);
    try {
      // `u.isActive !== false` agar dokumen lama tanpa field ini dianggap
      // aktif (migrasi 005 juga sudah membackfill, ini hanya jaring kedua).
      const { data } = await api.patch(`/auth/users/${u._id}`, { isActive: u.isActive === false });
      setUsers((prev) => prev.map((row) => (row._id === data.user._id ? data.user : row)));
      enqueueSnackbar(`Akun "${u.name}" ${data.user.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`, {
        variant: 'success',
      });
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Gagal mengubah status akun.', { variant: 'error' });
    } finally {
      setTogglingId(null);
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

  const isSelf = (u) => u._id === currentUser?._id;
  const passwordTooShort = !editing && form.password.length < 8;
  const resetPasswordTooShort = !!editing && form.password.length > 0 && form.password.length < 8;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: { xs: '100%', sm: 520 } }}>
          Kelola akun yang dapat masuk ke dashboard. <strong>Super Admin</strong> punya akses penuh termasuk mengelola pengguna,{' '}
          <strong>Admin</strong> hanya dapat mengelola data &amp; pengaturan. Akun <strong>Nonaktif</strong> tidak bisa login.
        </Typography>
        <Button
          variant="contained"
          fullWidth
          startIcon={<AddRoundedIcon />}
          onClick={openCreate}
          sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' }, whiteSpace: 'nowrap' }}
        >
          Tambah Pengguna
        </Button>
      </Stack>

      <Paper variant="outlined">
        {!users ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : users.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Belum ada pengguna.</Typography>
          </Box>
        ) : (
          users.map((u) => (
            <Box
              key={u._id}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: { xs: 1.5, sm: 2 },
                px: { xs: 2, sm: 2.5 },
                py: { xs: 2, sm: 1.75 },
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 'none' },
                opacity: u.isActive === false ? 0.65 : 1,
              }}
            >
              {/* Identitas: avatar + nama + email */}
              <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    opacity: u.isActive === false ? 0.6 : 1,
                  }}
                >
                  {u.name?.[0]?.toUpperCase()}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                      {u.name}
                    </Typography>
                    {isSelf(u) && <Chip size="small" label="Anda" sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0 }} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap title={u.email}>
                    {u.email}
                  </Typography>
                </Box>
              </Stack>

              {/* Badge + aksi: membungkus di layar sempit, rata kanan di desktop */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  flexShrink: 0,
                  flexWrap: 'wrap',
                  rowGap: 1,
                  justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                  pl: { xs: 6.5, sm: 0 }, // sejajarkan dengan teks (melewati avatar 36px + gap 16px)
                }}
              >
                <RoleChip role={u.role} />
                <StatusChip isActive={u.isActive !== false} />
                <Tooltip
                  title={
                    isSelf(u)
                      ? 'Tidak dapat menonaktifkan akun sendiri'
                      : u.isActive
                        ? 'Nonaktifkan akun'
                        : 'Aktifkan akun'
                  }
                >
                  <span>
                    <Switch
                      size="small"
                      checked={u.isActive !== false}
                      onChange={() => handleToggle(u)}
                      disabled={isSelf(u) || togglingId === u._id}
                      inputProps={{ 'aria-label': `Ubah status akun ${u.name}` }}
                      sx={{ ml: { xs: 0, sm: 0.5 } }}
                    />
                  </span>
                </Tooltip>
                <Tooltip title="Ubah pengguna">
                  <IconButton size="small" onClick={() => openEdit(u)} aria-label={`Ubah ${u.name}`}>
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={isSelf(u) ? 'Tidak dapat menghapus akun sendiri' : 'Hapus pengguna'}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={isSelf(u)}
                      onClick={() => setDeleteTarget(u)}
                      aria-label={`Hapus ${u.name}`}
                    >
                      <DeleteRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          ))
        )}
      </Paper>

      <Dialog
        open={dialogOpen}
        onClose={(e, reason) => {
          // Menutup lewat backdrop/Esc saat sedang menyimpan bisa membuat
          // perubahan "hilang" tanpa penjelasan — tahan sampai request selesai.
          if (saving) return;
          setDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{editing ? 'Ubah Pengguna' : 'Tambah Pengguna'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Nama"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              fullWidth
            />
            <TextField
              label={editing ? 'Kata Sandi Baru (opsional)' : 'Kata Sandi Sementara'}
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              helperText={
                editing
                  ? 'Kosongkan jika tidak ingin mengubah kata sandi. Minimal 8 karakter.'
                  : 'Minimal 8 karakter'
              }
              error={passwordTooShort || resetPasswordTooShort}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel id="user-role-label">Peran</InputLabel>
              <Select
                labelId="user-role-label"
                label="Peran"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                renderValue={(value) => ROLE_META[value]?.label || value}
              >
                {Object.entries(ROLE_META).map(([value, meta]) => (
                  <MenuItem key={value} value={value}>
                    <Box sx={{ py: 0.25 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {meta.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {meta.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  disabled={editing && isSelf({ _id: editing._id })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Akun Aktif
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Nonaktifkan untuk mencegah pengguna ini login.
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: { xs: 2, sm: 3 },
            py: 2,
            flexDirection: { xs: 'column-reverse', sm: 'row' },
            gap: { xs: 1, sm: 0 },
            '& > :not(:first-of-type)': { ml: { xs: 0, sm: 1 } },
          }}
        >
          <Button fullWidth color="inherit" onClick={() => setDialogOpen(false)} disabled={saving} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            Batal
          </Button>
          <Button
            fullWidth
            variant="contained"
            onClick={handleSubmit}
            disabled={
              saving ||
              !form.name.trim() ||
              !form.email.trim() ||
              passwordTooShort ||
              resetPasswordTooShort
            }
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {editing ? 'Simpan' : 'Tambah'}
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
