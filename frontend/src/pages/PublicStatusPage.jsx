import { useEffect, useState } from 'react';
import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const POLL_INTERVAL_MS = 30 * 1000;
const DAYS_TO_SHOW = 45;

const BANNER = {
  operational: { label: 'Semua Layanan Beroperasi Normal', color: 'success.main', Icon: CheckCircleRoundedIcon },
  degraded: { label: 'Sebagian Layanan Mengalami Gangguan Ringan', color: 'warning.main', Icon: WarningRoundedIcon },
  outage: { label: 'Gangguan Layanan Terdeteksi', color: 'error.main', Icon: ErrorRoundedIcon },
};

function lastNDays(n) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function DailyUptimeBar({ dailyUptime }) {
  const days = lastNDays(DAYS_TO_SHOW);
  return (
    <Box sx={{ display: 'flex', gap: '2px' }}>
      {days.map((day) => {
        const value = dailyUptime[day];
        const color = value == null ? 'action.disabledBackground' : value >= 99.5 ? 'status.up' : 'status.down';
        return (
          <Tooltip key={day} title={`${day} — ${value != null ? `${value}% uptime` : 'Tidak ada data'}`} arrow>
            <Box sx={{ flex: 1, height: 28, borderRadius: '2px', bgcolor: color, minWidth: 3 }} />
          </Tooltip>
        );
      })}
    </Box>
  );
}

export default function PublicStatusPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // A dedicated, credential-less axios call — this page must work even
      // for a visitor with no session at all, and must never attach the
      // dashboard's Authorization header.
      axios
        .get(`${import.meta.env.VITE_API_URL || '/api'}/public/status/${slug}`)
        .then((r) => {
          if (!cancelled) setData(r.data);
        })
        .catch((err) => {
          if (!cancelled && err.response?.status === 404) setNotFound(true);
        });
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug]);

  useEffect(() => {
    if (data?.title) document.title = `${data.title} — Status`;
  }, [data]);

  if (notFound) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ mb: 1 }}>
            Halaman tidak ditemukan
          </Typography>
          <Typography color="text.secondary">Halaman status ini tidak ada atau belum dipublikasikan.</Typography>
        </Box>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary">Memuat…</Typography>
      </Box>
    );
  }

  const banner = BANNER[data.overallStatus] || BANNER.operational;

  return (
    <Box sx={{ minHeight: '100vh', py: { xs: 4, sm: 8 }, px: 2 }}>
      <Box sx={{ maxWidth: 720, mx: 'auto' }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          {data.title}
        </Typography>
        {data.description && (
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            {data.description}
          </Typography>
        )}

        <Paper variant="outlined" sx={{ p: 3, mb: 4, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <banner.Icon sx={{ color: banner.color, fontSize: 28 }} />
          <Typography variant="h5" sx={{ color: banner.color }}>
            {banner.label}
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ mb: 4 }}>
          {data.services.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">Belum ada layanan yang ditampilkan.</Typography>
            </Box>
          ) : (
            data.services.map((service) => (
              <Box
                key={service.id}
                sx={{ px: 3, py: 2.5, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
                  <Typography variant="body1" fontWeight={600}>
                    {service.label}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: (t) => t.typography.fontFamilyMono,
                      fontWeight: 700,
                      color: service.status === 'up' ? 'status.up' : service.status === 'down' ? 'status.down' : 'text.secondary',
                    }}
                  >
                    {service.status === 'up' ? 'Normal' : service.status === 'down' ? 'Gangguan' : 'Memeriksa'}
                  </Typography>
                </Stack>
                <DailyUptimeBar dailyUptime={service.dailyUptime} />
              </Box>
            ))
          )}
        </Paper>

        {data.incidents.length > 0 && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Insiden Terbaru
            </Typography>
            <Stack spacing={2}>
              {data.incidents.map((incident, i) => (
                <Box key={i}>
                  <Typography variant="body2" fontWeight={600}>
                    {incident.status === 'ongoing' ? 'Gangguan sedang berlangsung' : 'Gangguan telah teratasi'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(incident.startedAt).toLocaleString('id-ID')}
                    {incident.resolvedAt && ` — ${new Date(incident.resolvedAt).toLocaleString('id-ID')}`}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 4 }}>
          Diperbarui {new Date(data.updatedAt).toLocaleTimeString('id-ID')}
        </Typography>
      </Box>
    </Box>
  );
}
