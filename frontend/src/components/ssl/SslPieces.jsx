import { Box, Chip, Typography } from '@mui/material';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';

// Central definition of every SSL/Domain status the backend can emit
// (see utils/helpers.computeSslStatus + sslEngine). Keeping labels/colors in
// one place means the list, detail page and incidents view always agree.
export const SSL_STATUS_META = {
  valid: { label: 'VALID', color: 'success', dot: 'up' },
  expiring: { label: 'SEGERA EXPIRED', color: 'warning', dot: 'down' },
  expired: { label: 'KEDALUWARSA', color: 'error', dot: 'down' },
  error: { label: 'GAGAL DICEK', color: 'error', dot: 'down' },
  pending: { label: 'MEMERIKSA', color: 'default', dot: 'pending' },
};

export function sslStatusMeta(status) {
  return SSL_STATUS_META[status] || SSL_STATUS_META.pending;
}

// A coloured pill for the certificate status, matching the flat, instrument
// look of the rest of the dashboard.
export function SslStatusChip({ status, isActive = true, size = 'small' }) {
  if (!isActive) {
    return (
      <Chip
        size={size}
        label="DIJEDA"
        sx={{
          bgcolor: 'action.disabledBackground',
          color: 'text.secondary',
          fontFamily: (t) => t.typography.fontFamilyMono,
        }}
      />
    );
  }
  const meta = sslStatusMeta(status);
  return (
    <Chip
      size={size}
      label={meta.label}
      color={meta.color}
      variant={status === 'pending' ? 'outlined' : 'filled'}
      sx={{ fontFamily: (t) => t.typography.fontFamilyMono, letterSpacing: '0.02em' }}
    />
  );
}

export function sslDotColor(theme, status, isActive) {
  if (!isActive) return theme.palette.status.paused;
  const meta = sslStatusMeta(status);
  if (meta.dot === 'up') return theme.palette.status.up;
  if (meta.dot === 'down') return theme.palette.status.down;
  return theme.palette.status.pending;
}

export function SslStatusDot({ status, isActive = true, size = 9 }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: sslDotColor(theme, status, isActive),
        flexShrink: 0,
      })}
    />
  );
}

// Days-left is the single most important number on an SSL row, so it gets its
// own colour treatment: green when comfortable, amber inside the warn window,
// red once expired.
export function daysLeftColor(theme, days) {
  if (days == null) return theme.palette.text.secondary;
  if (days < 0) return theme.palette.status.down;
  if (days <= 7) return theme.palette.status.down;
  if (days <= 14) return theme.palette.warning.main;
  return theme.palette.status.up;
}

export function DaysLeft({ days }) {
  if (days == null) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  const overdue = days < 0;
  const label = overdue ? `${Math.abs(days)} hari lalu` : `${days} hari`;
  return (
    <Typography
      variant="body2"
      sx={(t) => ({
        fontFamily: t.typography.fontFamilyMono,
        color: daysLeftColor(t, days),
        fontWeight: 600,
      })}
    >
      {label}
    </Typography>
  );
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export function lastNotifiedLabel(value) {
  if (!value) return 'Belum pernah';
  const diff = Date.now() - new Date(value).getTime();
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

// Icon + label combo for the certificate card header.
export function SslStatusIcon({ status, isActive = true }) {
  if (!isActive) return <ScheduleRoundedIcon fontSize="small" color="disabled" />;
  const meta = sslStatusMeta(status);
  if (status === 'valid') return <VerifiedRoundedIcon fontSize="small" color="success" />;
  if (status === 'pending') return <ScheduleRoundedIcon fontSize="small" color="disabled" />;
  if (status === 'error') return <ErrorRoundedIcon fontSize="small" color="error" />;
  return <GppMaybeRoundedIcon fontSize="small" color={meta.color === 'warning' ? 'warning' : 'error'} />;
}
