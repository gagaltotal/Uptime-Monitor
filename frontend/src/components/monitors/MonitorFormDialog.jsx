import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import api from '../../api/axios';

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

const RETRY_OPTIONS = [0, 1, 2, 3, 5];

const emptyForm = {
  name: '',
  type: 'http',
  url: 'https://',
  method: 'GET',
  ignoreTlsErrors: false,
  host: '',
  port: '',
  interval: 60,
  timeout: 10,
  retries: 1,
  tags: [],
  notificationChannels: [],
};

export default function MonitorFormDialog({ open, onClose, onSubmit, initialMonitor }) {
  const [form, setForm] = useState(emptyForm);
  const [tagInput, setTagInput] = useState('');
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'));
  const isEdit = !!initialMonitor;

  useEffect(() => {
    if (!open) return;
    api
      .get('/notification-channels')
      .then(({ data }) => setChannels(data.channels))
      .catch(() => setChannels([]));

    if (initialMonitor) {
      setForm({
        ...emptyForm,
        ...initialMonitor,
        tags: Array.isArray(initialMonitor.tags) ? initialMonitor.tags : [],
        port: initialMonitor.port ?? '',
        notificationChannels: (initialMonitor.notificationChannels || []).map((c) => (typeof c === 'string' ? c : c._id)),
      });
    } else {
      setForm(emptyForm);
    }
    setTagInput('');
    setError('');
  }, [open, initialMonitor]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const addTags = (value) => {
    const newTags = String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
    if (newTags.length) {
      setForm((current) => ({
        ...current,
        tags: Array.from(new Set([...current.tags, ...newTags])).slice(0, 20),
      }));
    }
    setTagInput('');
  };

  const selectedChannelObjects = useMemo(
    () => channels.filter((c) => form.notificationChannels.includes(c._id)),
    [channels, form.notificationChannels]
  );

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        interval: Number(form.interval),
        timeout: Number(form.timeout),
        retries: Number(form.retries),
        tags: Array.from(new Set((form.tags || []).map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 20),
        notificationChannels: form.notificationChannels,
      };
      if (form.type === 'http') {
        payload.url = form.url.trim();
        payload.method = form.method;
        payload.ignoreTlsErrors = !!form.ignoreTlsErrors;
      } else {
        payload.host = form.host.trim();
        if (form.type === 'tcp') payload.port = Number(form.port);
      }
      await onSubmit(payload);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan monitor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{isEdit ? 'Edit Monitor' : 'Tambah Monitor Baru'}</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Nama"
            placeholder="mis. Website Utama, API Produksi"
            value={form.name}
            onChange={set('name')}
            fullWidth
            autoFocus
          />

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Tipe pemeriksaan
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={form.type}
              onChange={(e, val) => val && setForm((f) => ({ ...f, type: val }))}
            >
              <ToggleButton value="http">HTTP(S)</ToggleButton>
              <ToggleButton value="tcp">TCP Port</ToggleButton>
              <ToggleButton value="ping">Ping</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {form.type === 'http' && (
            <>
              <TextField
                label="URL"
                placeholder="https://situs-saya.com"
                value={form.url}
                onChange={set('url')}
                fullWidth
                helperText="Sertifikat SSL akan otomatis diperiksa untuk URL https://"
              />
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={6}>
                  <TextField select label="Metode" value={form.method} onChange={set('method')} fullWidth>
                    <MenuItem value="GET">GET</MenuItem>
                    <MenuItem value="HEAD">HEAD</MenuItem>
                    <MenuItem value="POST">POST</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch checked={form.ignoreTlsErrors} onChange={(e) => setForm((f) => ({ ...f, ignoreTlsErrors: e.target.checked }))} />
                    }
                    label="Abaikan error TLS"
                    sx={{
                      m: 0,
                      minHeight: 56,
                      px: 1.5,
                      width: '100%',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                    }}
                  />
                </Grid>
              </Grid>
            </>
          )}

          {(form.type === 'tcp' || form.type === 'ping') && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={form.type === 'tcp' ? 9 : 12}>
                <TextField
                  label="Host / IP"
                  placeholder="192.168.1.10 atau server.contoh.com"
                  value={form.host}
                  onChange={set('host')}
                  fullWidth
                />
              </Grid>
              {form.type === 'tcp' && (
                <Grid item xs={12} sm={3}>
                  <TextField label="Port" type="number" value={form.port} onChange={set('port')} fullWidth />
                </Grid>
              )}
            </Grid>
          )}

          <Divider />

          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField select label="Interval cek" value={form.interval} onChange={set('interval')} fullWidth>
                {INTERVAL_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField label="Timeout (detik)" type="number" value={form.timeout} onChange={set('timeout')} fullWidth />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField select label="Percobaan ulang" value={form.retries} onChange={set('retries')} fullWidth>
                {RETRY_OPTIONS.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}x sebelum "down"
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={form.tags}
            inputValue={tagInput}
            onInputChange={(_, value) => setTagInput(value)}
            onChange={(_, value) => {
              setForm((current) => ({
                ...current,
                tags: Array.from(new Set(value.map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 20),
              }));
              setTagInput('');
            }}
            onBlur={() => tagInput.trim() && addTags(tagInput)}
            renderTags={(value, getTagProps) =>
              value.map((tag, index) => (
                <Chip variant="outlined" size="small" label={tag} {...getTagProps({ index })} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Tag (opsional)"
                placeholder={form.tags.length ? '' : 'Contoh: server, production'}
                helperText="Tekan Enter atau koma untuk menambahkan tag."
                onKeyDown={(event) => {
                  if (event.key === ',') {
                    event.preventDefault();
                    addTags(tagInput);
                  }
                  params.inputProps.onKeyDown?.(event);
                }}
              />
            )}
          />

          <Autocomplete
            multiple
            options={channels}
            value={selectedChannelObjects}
            getOptionLabel={(c) => `${c.name} (${c.type})`}
            isOptionEqualToValue={(a, b) => a._id === b._id}
            onChange={(e, val) => setForm((f) => ({ ...f, notificationChannels: val.map((c) => c._id) }))}
            renderInput={(params) => (
              <TextField {...params} label="Notifikasi" placeholder="Pilih channel Notifikasi" />
            )}
            noOptionsText="Belum ada channel notifikasi — tambahkan dulu di menu Pengaturan"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, gap: 1 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Batal
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving || !form.name.trim()} fullWidth={fullScreen}>
          {isEdit ? 'Simpan Perubahan' : 'Tambah Monitor'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
