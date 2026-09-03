import { Box, Chip } from '@mui/material';

const STATUS_META = {
  up: { label: 'UP', color: 'success' },
  down: { label: 'DOWN', color: 'error' },
  pending: { label: 'MEMERIKSA', color: 'default' },
};

function dotColor(theme, status, isActive) {
  if (!isActive) return theme.palette.status.paused;
  if (status === 'up') return theme.palette.status.up;
  if (status === 'down') return theme.palette.status.down;
  return theme.palette.status.pending;
}

// The single deliberate motion moment in this UI: a slow breathing pulse,
// used only on a confirmed-healthy monitor. Down/paused/pending dots stay
// static — the animation itself communicates "alive and confirmed good."
const pulseKeyframes = {
  '@keyframes livePulse': {
    '0%, 100%': { boxShadow: '0 0 0 0 rgba(52, 211, 153, 0.45)' },
    '50%': { boxShadow: '0 0 0 5px rgba(52, 211, 153, 0)' },
  },
};

export function StatusDot({ status, isActive = true, size = 9 }) {
  const animate = isActive && status === 'up';
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: dotColor(theme, status, isActive),
        flexShrink: 0,
        ...(animate ? { ...pulseKeyframes, animation: 'livePulse 2.2s ease-in-out infinite' } : {}),
      })}
    />
  );
}

export function StatusBadge({ status, isActive = true, size = 'small' }) {
  if (!isActive) {
    return <Chip size={size} label="DIJEDA" sx={{ bgcolor: 'action.disabledBackground', color: 'text.secondary', fontFamily: 'var(--font-mono)' }} />;
  }
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <Chip
      size={size}
      label={meta.label}
      color={meta.color}
      variant={status === 'pending' ? 'outlined' : 'filled'}
      sx={{ fontFamily: (theme) => theme.typography.fontFamilyMono, letterSpacing: '0.02em' }}
    />
  );
}

export function uptimeColor(theme, percent) {
  if (percent == null) return theme.palette.text.secondary;
  if (percent >= 99) return theme.palette.status.up;
  if (percent >= 95) return theme.palette.warning.main;
  return theme.palette.status.down;
}
