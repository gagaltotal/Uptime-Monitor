import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ReportRoundedIcon from '@mui/icons-material/ReportRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
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

const PRINT_SOURCE = { monitors: 'Insiden Monitor', agents: 'Insiden Agent' };

const AGENT_INCIDENT_TYPE = {
  disconnect: 'Terputus',
  cpu: 'CPU Tinggi',
  memory: 'Memori Tinggi',
  disk: 'Disk Penuh',
  load: 'Load Tinggi',
  service: 'Service Gagal',
  reported: 'Dilaporkan Agent',
};

function agentTargetLabel(agent) {
  if (!agent) return '';
  return [agent.hostname, agent.ipAddress].filter(Boolean).join(' · ') || agent.distro || '';
}

const MONITOR_COLUMNS = '1.6fr 2fr 0.9fr 1.4fr 1fr';
const AGENT_COLUMNS = '1.2fr 1.4fr 1.2fr 0.8fr 1.1fr 1.3fr 0.9fr';

function severityLabel(severity) {
  return severity === 'critical' ? 'Critical' : 'Warning';
}

function StatusChip({ status }) {
  return (
    <Chip
      size="small"
      label={status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
      color={status === 'ongoing' ? 'error' : 'default'}
      sx={{ fontFamily: (t) => t.typography.fontFamilyMono, flexShrink: 0 }}
    />
  );
}

function IncidentRow({ incident, source, onOpen }) {
  const isAgent = source === 'agents';
  const target = isAgent ? incident.agent : incident.monitor;
  const columns = isAgent ? AGENT_COLUMNS : MONITOR_COLUMNS;
  const targetText = isAgent ? agentTargetLabel(target) : targetLabel(target);
  const title = target?.name || (isAgent ? 'Agent telah dihapus' : 'Monitor telah dihapus');
  const startedLabel = new Date(incident.startedAt).toLocaleString('id-ID');
  const cause = incident.cause || '';

  return (
    <Box
      onClick={onOpen}
      sx={{
        px: { xs: 2, sm: 2.5 },
        py: { xs: 1.5, md: 1.75 },
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: target ? 'pointer' : 'default',
        '&:hover': { bgcolor: 'action.hover' },
        '&:last-of-type': { borderBottom: 'none' },
        // Desktop/tablet: baris sejajar kolom
        display: { xs: 'block', md: 'grid' },
        gridTemplateColumns: { md: columns },
        alignItems: 'center',
        gap: { md: 2 },
      }}
    >
      {/* Mobile: judul + status di baris pertama */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ display: { xs: 'flex', md: 'none' }, mb: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}
      >
        <StatusChip status={incident.status} />
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0, wordBreak: 'break-word' }}>
          {title}
        </Typography>
      </Stack>

      {/* Kolom nama (desktop) */}
      <Box sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {title}
        </Typography>
      </Box>

      {/* Target */}
      <Typography
        variant="caption"
        color="text.secondary"
        title={targetText || undefined}
        sx={{
          display: 'block',
          fontFamily: (t) => t.typography.fontFamilyMono,
          wordBreak: 'break-word',
          // Desktop: satu baris dengan ellipsis agar kolom tetap rapi.
          md: {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      >
        {targetText || '—'}
      </Typography>

      {/* Jenis insiden agent (mobile & desktop) */}
      {isAgent && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: { xs: 0.75, md: 0 }, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip
            size="small"
            variant="outlined"
            label={AGENT_INCIDENT_TYPE[incident.type] || incident.type}
            color={incident.severity === 'critical' ? 'error' : 'warning'}
            sx={{ fontSize: '0.7rem' }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'inline', md: 'none' } }}>
            {severityLabel(incident.severity)}
          </Typography>
        </Stack>
      )}

      {/* Tingkat keparahan (desktop, kolom sendiri) */}
      {isAgent && (
        <Typography
          variant="body2"
          sx={{ display: { xs: 'none', md: 'block' }, color: incident.severity === 'critical' ? 'error.main' : 'warning.main' }}
        >
          {severityLabel(incident.severity)}
        </Typography>
      )}

      {/* Status (desktop) */}
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <Chip
          size="small"
          label={incident.status === 'ongoing' ? 'BERLANGSUNG' : 'SELESAI'}
          color={incident.status === 'ongoing' ? 'error' : 'default'}
          sx={{ fontFamily: (t) => t.typography.fontFamilyMono }}
        />
      </Box>

      {/* Waktu mulai */}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: { xs: 0.75, md: 0 }, fontSize: { xs: '0.78rem', md: undefined }, wordBreak: 'break-word' }}
      >
        {startedLabel}
      </Typography>

      {/* Durasi */}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mt: { xs: 0.25, md: 0 }, whiteSpace: 'nowrap' }}
      >
        Durasi: {durationLabel(incident.durationSeconds)}
      </Typography>

      {/* Cause dipakai sebagai keterangan tambahan pada insiden agent */}
      {isAgent && cause && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', gridColumn: { md: '1 / -1' }, mt: 0.5, wordBreak: 'break-word' }}
        >
          {cause}
        </Typography>
      )}
    </Box>
  );
}

const MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const YEAR_RANGE = 10;

export default function Incidents() {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_RANGE }, (_, i) => currentYear - i);

  const [source, setSource] = useState('monitors');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  // debounce pencarian supaya tidak memanggil API setiap ketukan
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // state cetak
  const [dialogOpen, setDialogOpen] = useState(false);
  const [printSource, setPrintSource] = useState('monitors');
  const [printYear, setPrintYear] = useState(currentYear);
  const [printMonth, setPrintMonth] = useState(0); // 0 = semua bulan dalam tahun
  const [printing, setPrinting] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [printMeta, setPrintMeta] = useState(null);
  const [printRequest, setPrintRequest] = useState(false);

  const handlePrint = async () => {
    setDialogOpen(false);
    setPrinting(true);
    try {
      // hanya ambil insiden pada periode yang dipilih (tanpa pagination)
      const start = printMonth ? new Date(printYear, printMonth - 1, 1) : new Date(printYear, 0, 1);
      const end = printMonth ? new Date(printYear, printMonth, 1) : new Date(printYear + 1, 0, 1);
      const params = { from: start.toISOString(), to: end.toISOString(), source: printSource };
      if (status !== 'all') params.status = status;

      const { data: res } = await api.get('/incidents/report', { params });
      setPrintMeta({
        source: printSource,
        periodLabel: printMonth ? `${MONTHS[printMonth - 1]} ${printYear}` : `Tahun ${printYear}`,
        truncated: res.truncated,
      });
      setPrintData(res.incidents);
      setPrintRequest(true);
    } catch {
      setPrinting(false);
      enqueueSnackbar('Gagal menyiapkan laporan.', { variant: 'error' });
    }
  };

  // cetak setelah area laporan sudah dirender
  useEffect(() => {
    if (!printRequest || !printData) return undefined;
    const prevTitle = document.title;
    const t = setTimeout(() => {
      // judul dokumen dipakai sebagai nama file saat "Simpan sebagai PDF"
      const sourceLabel = printMeta?.source === 'agents' ? 'Agent' : 'Monitor';
      document.title = `Laporan-Insiden-${sourceLabel}-${(printMeta?.periodLabel || '').replace(/\s+/g, '-')}`;
      window.print();
      document.title = prevTitle;
      setPrinting(false);
      setPrintRequest(false);
      setPrintData(null);
    }, 200);
    return () => clearTimeout(t);
  }, [printRequest, printData, printMeta]);

  const reportIncidents = printData || [];
  const ongoingCount = reportIncidents.filter((i) => i.status === 'ongoing').length;
  const resolvedCount = reportIncidents.filter((i) => i.status === 'resolved').length;
  const reportYear = new Date().getFullYear();
  const reportIsAgent = printMeta?.source === 'agents';
  // Pakai sumber dari respons agar header & baris selalu konsisten saat ganti filter.
  const listSource = data?.source || source;

  useEffect(() => {
    let active = true;
    const params = { page, limit: 20, source };
    if (status !== 'all') params.status = status;
    if (query) params.q = query;
    api
      .get('/incidents', { params })
      .then((r) => active && setData(r.data))
      .catch(() => {
        if (active) enqueueSnackbar('Gagal memuat daftar insiden.', { variant: 'error' });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, status, query, page]);

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
            Seluruh riwayat downtime dari semua monitor dan insiden yang dilaporkan agent.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<PrintRoundedIcon />}
          onClick={() => {
            setPrintSource(source);
            setDialogOpen(true);
          }}
          disabled={printing}
          sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' } }}
        >
          {printing ? 'Menyiapkan...' : 'Cetak Laporan PDF'}
        </Button>
      </Stack>

      <Stack
        className="no-print"
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1.5, md: 2 }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <TextField
            select
            size="small"
            label="Jenis Insiden"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setData(null);
              setPage(1);
            }}
            sx={{ minWidth: { xs: '100%', sm: 220 } }}
          >
            <MenuItem value="monitors">Insiden Monitor</MenuItem>
            <MenuItem value="agents">Insiden Agent</MenuItem>
          </TextField>

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
            sx={{ flexWrap: 'wrap' }}
          >
            <ToggleButton value="all">Semua</ToggleButton>
            <ToggleButton value="ongoing">Berlangsung</ToggleButton>
            <ToggleButton value="resolved">Selesai</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <TextField
          size="small"
          placeholder={source === 'agents' ? 'Cari agent, host, jenis…' : 'Cari monitor, target…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 260 }, maxWidth: { md: 320 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Stack>

      <Paper variant="outlined">
        {/* Header tabel — hanya tampil di desktop */}
        {data && data.incidents.length > 0 && (
          <Box
            sx={{
              display: { xs: 'none', md: 'grid' },
              gridTemplateColumns: listSource === 'agents' ? AGENT_COLUMNS : MONITOR_COLUMNS,
              gap: 2,
              px: 2.5,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              {listSource === 'agents' ? 'Agent' : 'Monitor'}
            </Typography>
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              Target
            </Typography>
            {listSource === 'agents' && (
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Jenis
              </Typography>
            )}
            {listSource === 'agents' && (
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Tingkat
              </Typography>
            )}
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              Status
            </Typography>
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              Mulai
            </Typography>
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              Durasi
            </Typography>
          </Box>
        )}

        {!data ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography color="text.secondary">Memuat…</Typography>
          </Box>
        ) : data.incidents.length === 0 ? (
          <Box sx={{ p: { xs: 5, sm: 8 }, textAlign: 'center' }}>
            <ReportRoundedIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">
              {query ? `Tidak ada insiden yang cocok dengan “${query}”.` : 'Tidak ada insiden untuk ditampilkan.'}
            </Typography>
          </Box>
        ) : (
          data.incidents.map((incident) => (
            <IncidentRow
              key={incident._id}
              incident={incident}
              source={listSource}
              onOpen={() => {
                if (listSource === 'agents') {
                  if (incident.agent?._id) navigate(`/agents/${incident.agent._id}`);
                } else if (incident.monitor?._id) {
                  navigate(`/monitors/${incident.monitor._id}`);
                }
              }}
            />
          ))
        )}
      </Paper>

      {data && data.pages > 1 && (
        <Stack className="no-print" alignItems="center" sx={{ mt: 3 }}>
          <Pagination
            count={data.pages}
            page={page}
            onChange={(e, v) => setPage(v)}
            color="primary"
            siblingCount={0}
            boundaryCount={1}
            size="small"
          />
        </Stack>
      )}

      {/* Dialog pilihan periode cetak */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Cetak Laporan Insiden</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="print-source-label">Jenis Insiden</InputLabel>
              <Select
                labelId="print-source-label"
                label="Jenis Insiden"
                value={printSource}
                onChange={(e) => setPrintSource(e.target.value)}
              >
                <MenuItem value="monitors">Insiden Monitor (seluruh downtime)</MenuItem>
                <MenuItem value="agents">Insiden Agent</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="print-year-label">Tahun</InputLabel>
              <Select
                labelId="print-year-label"
                label="Tahun"
                value={printYear}
                onChange={(e) => setPrintYear(e.target.value)}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="print-month-label">Bulan</InputLabel>
              <Select
                labelId="print-month-label"
                label="Bulan"
                value={printMonth}
                onChange={(e) => setPrintMonth(e.target.value)}
              >
                <MenuItem value={0}>Seluruh tahun</MenuItem>
                {MONTHS.map((m, i) => (
                  <MenuItem key={m} value={i + 1}>
                    {m}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Status mengikuti filter yang sedang aktif ({STATUS_LABEL[status]}).
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pilih “Insiden Monitor” untuk seluruh riwayat downtime monitor, atau “Insiden Agent”
              untuk insiden yang dilaporkan dari log agent (disconnect, CPU, memori, disk, service).
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Batal</Button>
          <Button variant="contained" startIcon={<PrintRoundedIcon />} onClick={handlePrint}>
            Cetak PDF
          </Button>
        </DialogActions>
      </Dialog>

      {/* Area laporan — dirender ke body, hanya tampil saat dicetak */}
      {printData && createPortal(
        <Box className="print-report">
          <Box className="print-header">
            <Typography component="h1" sx={{ fontSize: '20pt', fontWeight: 700, color: '#111' }}>
              {reportIsAgent ? 'Laporan Insiden Agent' : 'Laporan Insiden Monitor'}
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
                <td>Jenis insiden</td>
                <td>{PRINT_SOURCE[printMeta?.source] || '-'}</td>
              </tr>
              <tr>
                <td>Periode</td>
                <td>{printMeta?.periodLabel}</td>
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

          {printMeta?.truncated && (
            <Typography sx={{ fontSize: '9pt', color: '#b00020', mb: 1 }}>
              Data dibatasi. Persempit periode untuk melihat seluruh insiden.
            </Typography>
          )}

          <table className="print-table">
            <thead>
              {reportIsAgent ? (
                <tr>
                  <th style={{ width: '4%' }}>No</th>
                  <th style={{ width: '18%' }}>Agent</th>
                  <th style={{ width: '18%' }}>Target</th>
                  <th style={{ width: '15%' }}>Jenis</th>
                  <th style={{ width: '9%' }}>Tingkat</th>
                  <th style={{ width: '10%' }}>Status</th>
                  <th style={{ width: '13%' }}>Mulai</th>
                  <th style={{ width: '13%' }}>Durasi</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ width: '4%' }}>No</th>
                  <th style={{ width: '18%' }}>Monitor</th>
                  <th style={{ width: '20%' }}>Target</th>
                  <th style={{ width: '11%' }}>Status</th>
                  <th style={{ width: '17%' }}>Mulai</th>
                  <th style={{ width: '17%' }}>Selesai</th>
                  <th style={{ width: '13%' }}>Durasi</th>
                </tr>
              )}
            </thead>
            <tbody>
              {reportIncidents.length === 0 ? (
                <tr>
                  <td colSpan={reportIsAgent ? 8 : 7} style={{ textAlign: 'center' }}>
                    Tidak ada insiden.
                  </td>
                </tr>
              ) : reportIsAgent ? (
                reportIncidents.map((incident, idx) => (
                  <tr key={incident._id}>
                    <td>{idx + 1}</td>
                    <td>{incident.agent?.name || 'Agent telah dihapus'}</td>
                    <td className="mono">{agentTargetLabel(incident.agent)}</td>
                    <td>
                      {AGENT_INCIDENT_TYPE[incident.type] || incident.type}
                      {incident.cause && (
                        <div style={{ fontSize: '8pt', color: '#555', marginTop: 2 }}>{incident.cause}</div>
                      )}
                    </td>
                    <td>{incident.severity === 'critical' ? 'Critical' : 'Warning'}</td>
                    <td>{incident.status === 'ongoing' ? 'Berlangsung' : 'Selesai'}</td>
                    <td>{new Date(incident.startedAt).toLocaleString('id-ID')}</td>
                    <td>{durationLabel(incident.durationSeconds)}</td>
                  </tr>
                ))
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
        </Box>,
        document.body
      )}

      <style>{`
        .print-report { display: none; }
        @media print {
          @page { size: A4; margin: 15mm; }
          body > *:not(.print-report) { display: none !important; }
          .print-report {
            display: block !important;
            position: static;
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
