import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  useMediaQuery,
} from '@mui/material';
import api from '../../api/axios';

// Certificates change slowly, so the sensible cadences are much longer than an
// uptime check's. Sub-hour intervals are deliberately not offered.
const INTERVAL_OPTIONS = [
  { value: 900, label: '15 menit' },
  { value: 3600, label: '1 jam' },
  { value: 10800, label: '3 jam' },
  { value: 21600, label: '6 jam' },
  { value: 43200, label: '12 jam' },
  { value: 86400, label: '1 hari' },
  { value: 259200, label: '3 hari' },
];

const THRESHOLD_OPTIONS = [
  { value: 3, label: '3 hari' },
  { value: 7, label: '7 hari' },
  { value: 14, label: '14 hari' },
  { value: 30, label: '30 hari' },
  { value: 60, label: '60 hari' },
  { value: 90, label: '90 hari' },
];

const TIMEOUT_OPTIONS = [
  { value: 5, label: '5 detik' },
  { value: 10, label: '10 detik' },
  { value: 20, label: '20 detik' },
  { value: 30, label: '30 detik' },
];

const emptyForm = {
  name: '',
  domain: '',
  port: 443,
  interval: 21600,
  timeout: 10,
  retries: 1,
  alertThresholdDays: 14,
  tags: [],
  isActive: true,
  notificationChannels: [],
};

export default function SslMonitorFormDialog({ open, initialMonitor, onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [tagInput, setTagInput] = useState('');
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'));
  const isEdit = !!initialMonitor;

  useEffect(() => {
    if (!open) return;
    setError('');
    api
      .get('/notification-channels')
      .then((res) => setChannels(res.data.channels || []))
      .catch(() => setChannels([]));

    if (initialMonitor) {
      setForm({
        name: initialMonitor.name || '',
        domain: initialMonitor.domain || '',
        port: initialMonitor.port || 443,
        interval: initialMonitor.interval || 21600,
        timeout: initialMonitor.timeout || 10,
        retries: initialMonitor.retries ?? 1,
        alertThresholdDays: initialMonitor.alertThresholdDays || 14,
        tags: initialMonitor.tags || [],
        isActive: initialMonitor.isActive !== false,
        notificationChannels: (initialMonitor.notificationChannels || []).map((c) => c._id || c),
      });
    } else {
      setForm(emptyForm);
    }
    setTagInput('');
  }, [open, initialMonitor]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addTags = (value) => {
    const newTags = String(value || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
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
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: form.name.trim(),
        domain: form.domain.trim(),
        port: Number(form.port),
        interval: Number(form.interval),
        timeout: Number(form.timeout),
        retries: Number(form.retries),
        alertThresholdDays: Number(form.alertThresholdDays),
        tags: Array.from(
          new Set(
            [...form.tags, ...tagInput.split(',')]
              .map((tag) => String(tag).trim())
              .filter(Boolean)
          )
        ).slice(0, 20),
        isActive: form.isActive,
        notificationChannels: form.notificationChannels,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan monitor SSL.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{isEdit ? 'Ubah Monitor SSL & Domain' : 'Tambah Monitor SSL & Domain'}</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Nama"
            value={form.name}
            onChange={set('name')}
            autoFocus
            fullWidth
            required
            helperText="Nama untuk mengenali monitor ini, mis. “Website Perusahaan”."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Domain / URL"
              value={form.domain}
              onChange={set('domain')}
              fullWidth
              required
              placeholder="example.com atau https://example.com"
              helperText="Boleh hostname, host:port, atau URL lengkap."
            />
            <TextField
              select
              label="Port"
              value={form.port}
              onChange={set('port')}
              sx={{ minWidth: { sm: 140 } }}
              helperText="Default 443 untuk HTTPS."
            >
              <MenuItem value={443}>443 (HTTPS)</MenuItem>
              <MenuItem value={8443}>8443</MenuItem>
              <MenuItem value={9443}>9443</MenuItem>
              <MenuItem value={465}>465 (SMTPS)</MenuItem>
              <MenuItem value={993}>993 (IMAPS)</MenuItem>
              <MenuItem value={995}>995 (POP3S)</MenuItem>
            </TextField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Interval pengecekan" value={form.interval} onChange={set('interval')} fullWidth>
              {INTERVAL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Ambang peringatan"
              value={form.alertThresholdDays}
              onChange={set('alertThresholdDays')}
              fullWidth
              helperText="Notifikasi dikirim saat sisa hari ≤ nilai ini."
            >
              {THRESHOLD_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Timeout" value={form.timeout} onChange={set('timeout')} fullWidth>
              {TIMEOUT_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Percobaan ulang"
              value={form.retries}
              onChange={set('retries')}
              fullWidth
              helperText="Jumlah kegagalan berturut-turut sebelum dicatat sebagai error."
            >
              {[0, 1, 2, 3, 5].map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

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
                placeholder={form.tags.length ? '' : 'Contoh: website, production'}
                helperText="Tekan Enter atau koma untuk menambahkan tag."
                inputProps={{
                  ...params.inputProps,
                  onKeyDown: (event) => {
                    params.inputProps.onKeyDown?.(event);
                    if (event.key === ',') {
                      event.preventDefault();
                      addTags(tagInput);
                    }
                  },
                }}
              />
            )}
          />

          <Divider />

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
          <Alert severity="info" sx={{ py: 0.5 }}>
            Notifikasi dikirim saat sertifikat masuk ambang peringatan, saat kedaluwarsa, dan saat
            kembali sehat. Pengingat diulang maksimal sekali per 24 jam.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          py: 2,
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1,
        }}
      >
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Batal
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={saving || !form.name.trim() || !form.domain.trim()}
          fullWidth={fullScreen}
        >
          {isEdit ? 'Simpan Perubahan' : 'Tambah Monitor'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
