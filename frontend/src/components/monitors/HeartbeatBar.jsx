import { Box, Tooltip } from '@mui/material';

function formatTime(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function barColor(theme, status) {
  return status === 'up' ? theme.palette.status.up : theme.palette.status.down;
}

export default function HeartbeatBar({ heartbeats = [], maxBars = 40, height = 28 }) {
  const trimmed = heartbeats.slice(-maxBars);
  const placeholders = Math.max(maxBars - trimmed.length, 0);

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', width: '100%', height }}>
      {Array.from({ length: placeholders }).map((_, i) => (
        <Box
          key={`ph-${i}`}
          sx={{ flex: 1, height: '100%', borderRadius: '3px', bgcolor: 'action.hover', minWidth: 3 }}
        />
      ))}
      {trimmed.map((hb, i) => (
        <Tooltip
          key={hb._id || i}
          arrow
          title={
            <Box sx={{ fontFamily: (theme) => theme.typography.fontFamilyMono, fontSize: '0.7rem', lineHeight: 1.6 }}>
              <div>{formatTime(hb.checkedAt)}</div>
              <div>{hb.status === 'up' ? `${hb.responseTime ?? '-'} ms` : hb.message || 'Down'}</div>
            </Box>
          }
        >
          <Box
            sx={{
              flex: 1,
              height: '100%',
              borderRadius: '3px',
              bgcolor: (theme) => barColor(theme, hb.status),
              minWidth: 3,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 0.75 },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
