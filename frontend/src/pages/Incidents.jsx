import { useEffect, useState } from 'react';
import { Box, Button, Chip, Pagination, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ReportRoundedIcon from '@mui/icons-material/ReportRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
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

const STATUS_LABEL = { all: 'Semua', ongoing: 'Berlangsung', resolved: 'Selesai' };

export default function Incidents() {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [printData, setPrintData] = useState(null);

  const fetchAllForPrint = async () => {
    const all = [];
    let p = 1;
    let pages = 1;
    do {
      const params = { page: p, limit: 100 };
      if (status !== 'all') params.status = status;
      const { data: res } = await api.get('/incidents', { params });
      all.push(...res.incidents);
      pages = res.pages;
      p += 1;
    } while (p <= pages);
    return all;
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const incidents = await fetchAllForPrint();
      setPrintData(incidents);
      // beri waktu React merender area cetak sebelum dialog print terbuka
      setTimeout(() => {
        window.print();
        setPrinting(false);
      }, 150);
    } catch {
      setPrinting(false);
      enqueueSnackbar('Gagal menyiapkan laporan.', { variant: 'error' });
    }
  };

  const reportIncidents = printData || [];
  const ongoingCount = reportIncidents.filter((i) => i.status === 'ongoing').length;
  const resolvedCount = reportIncidents.filter((i) => i.status === 'resolved').length;
  const reportYear = new Date().getFullYear();

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
      <Stack
        className="no-print"
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            Insiden
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Seluruh riwayat downtime dari semua monitor Anda.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<PrintRoundedIcon />}
          onClick={handlePrint}
          disabled={printing}
          sx={{ flexShrink: 0 }}
        >
          {printing ? 'Menyiapkan...' : 'Cetak Laporan PDF'}
        </Button>
      </Stack>

      <ToggleButtonGroup
        className="no-print"
        size="small"
        exclusive
        value={status}
        onChange={(e, v) => {
          if (v) {
            setStatus(v);
            setPage(1);
          }
        }}
        sx={{ mb: 2, flexWrap: 'wrap' }}
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
        <Stack className="no-print" alignItems="center" sx={{ mt: 3 }}>
          <Pagination count={data.pages} page={page} onChange={(e, v) => setPage(v)} color="primary" />
        </Stack>
      )}

      {/* Area laporan — hanya tampil saat dicetak */}
      {printData && (
        <Box className="print-report">
          <Box className="print-header">
            <Typography component="h1" sx={{ fontSize: '20pt', fontWeight: 700, color: '#111' }}>
              Laporan Insiden
            </Typography>
            <Typography sx={{ fontSize: '10pt', color: '#444' }}>Uptime Monitor</Typography>
          </Box>

          <table className="print-meta">
            <tbody>
              <tr>
                <td>Tanggal cetak</td>
                <td>{new Date().toLocaleString('id-ID')}</td>
              </tr>
              <tr>
                <td>Filter status</td>
                <td>{STATUS_LABEL[status]}</td>
              </tr>
              <tr>
                <td>Total insiden</td>
                <td>{reportIncidents.length}</td>
              </tr>
              <tr>
                <td>Berlangsung / Selesai</td>
                <td>
                  {ongoingCount} / {resolvedCount}
                </td>
              </tr>
            </tbody>
          </table>

          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: '4%' }}>No</th>
                <th style={{ width: '18%' }}>Monitor</th>
                <th style={{ width: '20%' }}>Target</th>
                <th style={{ width: '11%' }}>Status</th>
                <th style={{ width: '17%' }}>Mulai</th>
                <th style={{ width: '17%' }}>Selesai</th>
                <th style={{ width: '13%' }}>Durasi</th>
              </tr>
            </thead>
            <tbody>
              {reportIncidents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center' }}>
                    Tidak ada insiden.
                  </td>
                </tr>
              ) : (
                reportIncidents.map((incident, idx) => (
                  <tr key={incident._id}>
                    <td>{idx + 1}</td>
                    <td>{incident.monitor?.name || 'Monitor telah dihapus'}</td>
                    <td className="mono">{targetLabel(incident.monitor)}</td>
                    <td>{incident.status === 'ongoing' ? 'Berlangsung' : 'Selesai'}</td>
                    <td>{new Date(incident.startedAt).toLocaleString('id-ID')}</td>
                    <td>{incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString('id-ID') : '-'}</td>
                    <td>{durationLabel(incident.durationSeconds)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Box className="print-footer">
            <Typography sx={{ fontSize: '8pt', color: '#555' }}>
              © {reportYear} Uptime Monitor Contributors. Dokumen ini dibuat otomatis oleh sistem.
            </Typography>
          </Box>
        </Box>
      )}

      <style>{`
        .print-report { display: none; }
        @media print {
          @page { size: A4; margin: 15mm; }
          body * { visibility: hidden; }
          .print-report, .print-report * { visibility: visible; }
          .print-report {
            display: block;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            color: #111;
            font-family: Arial, Helvetica, sans-serif;
          }
          .print-header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
          .print-meta { border-collapse: collapse; margin-bottom: 16px; font-size: 10pt; }
          .print-meta td { padding: 3px 12px 3px 0; }
          .print-meta td:first-child { font-weight: 600; width: 180px; }
          .print-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
          .print-table th, .print-table td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: top; }
          .print-table th { background: #e9ecef !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-table tr { page-break-inside: avoid; }
          .print-table thead { display: table-header-group; }
          .mono { font-family: 'Courier New', monospace; word-break: break-all; }
          .print-footer { margin-top: 16px; border-top: 1px solid #999; padding-top: 6px; }
        }
      `}</style>
    </Box>
  );
}
