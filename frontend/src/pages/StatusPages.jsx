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
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useSnackbar } from 'notistack';
import api from '../api/axios';
import ConfirmDialog from '../components/common/ConfirmDialog';

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

const emptyForm = { slug: '', title: '', description: '', isPublished: true, monitors: [] };

export default function StatusPages() {
  const { enqueueSnackbar } = useSnackbar();
  const [pages, setPages] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => api.get('/status-pages').then((r) => setPages(r.data.statusPages));

  useEffect(() => {
    load().catch(() => enqueueSnackbar('Gagal memuat halaman status.', { variant: 'error' }));
    api.get('/monitors').then((r) => setMonitors(r.data.monitors)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publicOrigin = window.location.origin;

  const handleCopy = (slug) => {
    navigator.clipboard.writeText(`${publicOrigin}/status/${slug}`);
    enqueueSnackbar('Tautan disalin ke clipboard.', { variant: 'success' });
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/status-pages/${deleteTarget._id}`);
      setPages((prev) => prev.filter((p) => p._id !== deleteTarget._id));
      enqueueSnackbar('Halaman status dihapus.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Gagal menghapus halaman status.', { variant: 'error' });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h3">Halaman Status</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Buat halaman status publik untuk dibagikan ke pengguna Anda.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          Buat Halaman
        </Button>
      </Stack>

      <Paper variant="outlined">
        {!pages ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : pages.length === 0 ? (
          <Box sx={{ p: 8, textAlign: 'center' }}>
            <PublicRoundedIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">Belum ada halaman status. Buat satu untuk mulai berbagi status layanan Anda.</Typography>
          </Box>
        ) : (
          pages.map((page) => (
            <Box
              key={page._id}
              sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body1" fontWeight={600} noWrap>
                    {page.title}
                  </Typography>
                  {!page.isPublished && <Chip size="small" label="Draf" />}
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                  sx={{ fontFamily: (t) => t.typography.fontFamilyMono, fontSize: '0.75rem' }}
                >
                  /status/{page.slug} · {page.monitors.length} layanan
                </Typography>
              </Box>
              <Tooltip title="Salin tautan publik">
                <IconButton size="small" onClick={() => handleCopy(page.slug)}>
                  <ContentCopyRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Buka halaman publik">
                <IconButton size="small" component="a" href={`/status/${page.slug}`} target="_blank" rel="noopener">
                  <OpenInNewRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton
                size="small"
                onClick={() => {
                  setEditing(page);
                  setDialogOpen(true);
                }}
              >
                <EditRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => setDeleteTarget(page)}>
                <DeleteRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))
        )}
      </Paper>

      <StatusPageDialog
        open={dialogOpen}
        initial={editing}
        monitors={monitors}
        onClose={() => setDialogOpen(false)}
        onSaved={(saved) => {
          setPages((prev) => {
            const exists = prev?.some((p) => p._id === saved._id);
            return exists ? prev.map((p) => (p._id === saved._id ? saved : p)) : [saved, ...(prev || [])];
          });
          setDialogOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus halaman status ini?"
        description={`Tautan publik "/status/${deleteTarget?.slug}" tidak akan bisa diakses lagi setelah dihapus.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Box>
  );
}

function StatusPageDialog({ open, initial, monitors, onClose, onSaved }) {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    setError('');
    setSlugTouched(false);
    if (initial) {
      setForm({
        slug: initial.slug,
        title: initial.title,
        description: initial.description || '',
        isPublished: initial.isPublished,
        monitors: initial.monitors.map((m) => ({ monitor: m.monitor?._id || m.monitor, displayName: m.displayName || '' })),
      });
      setSlugTouched(true);
    } else {
      setForm(emptyForm);
    }
  }, [open, initial]);

  const selectedMonitorObjects = useMemo(
    () => form.monitors.map((sel) => monitors.find((m) => m._id === sel.monitor)).filter(Boolean),
    [form.monitors, monitors]
  );

  const handleTitleChange = (title) => {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
  };

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, slug: slugify(form.slug) };
      const { data } = isEdit
        ? await api.put(`/status-pages/${initial._id}`, payload)
        : await api.post('/status-pages', payload);
      onSaved(data.statusPage);
      enqueueSnackbar(isEdit ? 'Halaman status diperbarui.' : 'Halaman status dibuat.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan halaman status.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Halaman Status' : 'Buat Halaman Status'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField label="Judul" value={form.title} onChange={(e) => handleTitleChange(e.target.value)} fullWidth autoFocus />

          <TextField
            label="Slug URL"
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
            }}
            helperText={`Akan dapat diakses di: /status/${form.slug || '…'}`}
            fullWidth
          />

          <TextField
            label="Deskripsi (opsional)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            multiline
            minRows={2}
            fullWidth
          />

          <Divider />

          <Autocomplete
            multiple
            options={monitors}
            value={selectedMonitorObjects}
            getOptionLabel={(m) => m.name}
            isOptionEqualToValue={(a, b) => a._id === b._id}
            onChange={(e, selected) =>
              setForm((f) => ({
                ...f,
                monitors: selected.map((m) => {
                  const existing = f.monitors.find((sel) => sel.monitor === m._id);
                  return existing || { monitor: m._id, displayName: '' };
                }),
              }))
            }
            renderInput={(params) => <TextField {...params} label="Layanan yang ditampilkan" placeholder="Pilih monitor" />}
          />

          {form.monitors.length > 0 && (
            <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              {form.monitors.map((sel, idx) => {
                const monitor = monitors.find((m) => m._id === sel.monitor);
                return (
                  <ListItem key={sel.monitor} divider={idx < form.monitors.length - 1}>
                    <ListItemText primary={monitor?.name} secondary="Nama publik (opsional)" sx={{ flex: '0 0 40%' }} />
                    <TextField
                      size="small"
                      placeholder={monitor?.name}
                      value={sel.displayName}
                      onChange={(e) => {
                        const displayName = e.target.value;
                        setForm((f) => ({
                          ...f,
                          monitors: f.monitors.map((s, i) => (i === idx ? { ...s, displayName } : s)),
                        }));
                      }}
                      fullWidth
                    />
                  </ListItem>
                );
              })}
            </List>
          )}

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="body2">Publikasikan</Typography>
              <Typography variant="caption" color="text.secondary">
                Jika nonaktif, halaman tidak dapat diakses publik.
              </Typography>
            </Box>
            <Switch checked={form.isPublished} onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>
          Batal
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving || !form.title.trim() || !form.slug.trim()}>
          {isEdit ? 'Simpan Perubahan' : 'Buat Halaman'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
