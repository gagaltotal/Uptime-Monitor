import { useEffect, useState } from 'react';
import { Box, Chip, Pagination, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ReportRoundedIcon from '@mui/icons-material/ReportRounded';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import api from '../api/axios';

function targetLabel(monitor) {
  if (!monitor) return '';
  if (monitor.type === 'http') return monitor.url;
  if (monitor.type === 'tcp') return `${monitor.host}:${monitor.port}`;
  return monitor.host;
}

function durationLabel(seconds) {
  if (!seconds) return 'Sedang berlangsung';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} jam`;
  return `${Math.round(seconds / 60)} menit`;
}

export default function Incidents() {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = { page, limit: 20 };
    if (status !== 'all') params.status = status;
    api
      .get('/incidents', { params })
      .then((r) => setData(r.data))
      .catch(() => enqueueSnackbar('Gagal memuat daftar insiden.', { variant: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        Insiden
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Seluruh riwayat downtime dari semua monitor Anda.
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={status}
        onChange={(e, v) => {
          if (v) {
            setStatus(v);
            setPage(1);
          }
        }}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all">Semua</ToggleButton>
        <ToggleButton value="ongoing">Berlangsung</ToggleButton>
        <ToggleButton value="resolved">Selesai</ToggleButton>
      </ToggleButtonGroup>

      <Paper variant="outlined">
        {!data ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : data.incidents.length === 0 ? (
          <Box sx={{ p: 8, textAlign: 'center' }}>
            <ReportRoundedIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">Tidak ada insiden untuk ditampilkan.</Typography>
          </Box>
        ) : (
          data.incidents.map((incident) => (
            <Box
              key={incident._id}
              onClick={() => incident.monitor?._id && navigate(`/monitors/${incident.monitor._id}`)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2.5,
                py: 1.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
                cursor: incident.monitor?._id ? 'pointer' : 'default',
                '&:hover': { bgcolor: 'action.hover' },
                '&:last-of-type': { borderBottom: 'none' },
              }}
            >
              <Chip
                size="small"
                label={incident.status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
                color={incident.status === 'ongoing' ? 'error' : 'default'}
                sx={{ fontFamily: (t) => t.typography.fontFamilyMono, flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {incident.monitor?.name || 'Monitor telah dihapus'}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block', fontFamily: (t) => t.typography.fontFamilyMono }}
                >
                  {targetLabel(incident.monitor)}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="body2">{new Date(incident.startedAt).toLocaleString('id-ID')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {durationLabel(incident.durationSeconds)}
                </Typography>
              </Box>
            </Box>
          ))
        )}
      </Paper>

      {data && data.pages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination count={data.pages} page={page} onChange={(e, v) => setPage(v)} color="primary" />
        </Stack>
      )}
    </Box>
  );
}
