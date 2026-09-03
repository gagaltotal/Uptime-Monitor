import { Box, Typography, useTheme } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';

export default function ResponseTimeChart({ heartbeats = [], height = 260 }) {
  const theme = useTheme();

  if (heartbeats.length === 0) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Belum ada data pada rentang waktu ini.
        </Typography>
      </Box>
    );
  }

  const xData = heartbeats.map((h) => new Date(h.checkedAt));
  // Down checks become gaps in the line (connectNulls defaults to false)
  // rather than dropping to zero, which would misleadingly read as "0ms".
  const yData = heartbeats.map((h) => (h.status === 'up' ? h.responseTime : null));

  return (
    <LineChart
      height={height}
      xAxis={[
        {
          data: xData,
          scaleType: 'time',
          valueFormatter: (date) => date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        },
      ]}
      yAxis={[{ valueFormatter: (v) => `${v}ms` }]}
      series={[
        {
          data: yData,
          label: 'Waktu respons',
          color: theme.palette.primary.main,
          area: true,
          showMark: false,
          curve: 'monotoneX',
          valueFormatter: (v) => (v == null ? 'Down' : `${v} ms`),
        },
      ]}
      grid={{ horizontal: true }}
      margin={{ left: 55, right: 20, top: 20, bottom: 30 }}
      sx={{
        '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: theme.palette.divider },
        '& .MuiChartsAxis-tickLabel': { fill: theme.palette.text.secondary },
        '& .MuiChartsGrid-line': { stroke: theme.palette.divider, strokeDasharray: '3 4' },
        '& .MuiAreaElement-root': { fillOpacity: 0.12 },
      }}
    />
  );
}
