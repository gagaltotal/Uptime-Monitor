import { useState } from 'react';
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { useNavigate } from 'react-router-dom';
import HeartbeatBar from './HeartbeatBar';
import { StatusDot, StatusBadge, uptimeColor } from './StatusPieces';

function targetLabel(monitor) {
  if (monitor.type === 'http') return monitor.url;
  if (monitor.type === 'tcp') return `${monitor.host}:${monitor.port}`;
  return monitor.host;
}

export default function MonitorRow({ monitor, recentHeartbeats = [], onEdit, onDelete, onToggle }) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);

  const openMenu = (e) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const closeMenu = () => setAnchorEl(null);

  const stripeColor = !monitor.isActive
    ? 'status.paused'
    : monitor.currentStatus === 'up'
      ? 'status.up'
      : monitor.currentStatus === 'down'
        ? 'status.down'
        : 'status.pending';

  return (
    <Box
      onClick={() => navigate(`/monitors/${monitor._id}`)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        py: 1.5,
        pl: 0,
        pr: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        opacity: monitor.isActive ? 1 : 0.55,
        transition: 'background-color 0.12s',
        '&:hover': { bgcolor: 'action.hover' },
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box sx={{ width: 3, alignSelf: 'stretch', bgcolor: stripeColor, borderRadius: 1, flexShrink: 0 }} />

      <Box sx={{ minWidth: 0, width: { xs: 140, sm: 220 }, flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <StatusDot status={monitor.currentStatus} isActive={monitor.isActive} />
          <Typography variant="body1" fontWeight={600} noWrap>
            {monitor.name}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ fontFamily: (theme) => theme.typography.fontFamilyMono, fontSize: '0.75rem', mt: 0.25 }}
        >
          {targetLabel(monitor)}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}>
        <HeartbeatBar heartbeats={recentHeartbeats} maxBars={36} height={26} />
      </Box>

      <Box sx={{ width: 76, textAlign: 'right', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
        <Typography sx={{ fontFamily: (theme) => theme.typography.fontFamilyMono, fontSize: '0.8125rem' }}>
          {monitor.lastResponseTime != null ? `${monitor.lastResponseTime} ms` : '—'}
        </Typography>
      </Box>

      <Box sx={{ width: 64, textAlign: 'right', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
        <Typography
          sx={{
            fontFamily: (theme) => theme.typography.fontFamilyMono,
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: (theme) => uptimeColor(theme, monitor.uptime24h),
          }}
        >
          {monitor.uptime24h != null ? `${monitor.uptime24h.toFixed(1)}%` : '—'}
        </Typography>
      </Box>

      <Box sx={{ width: 96, flexShrink: 0 }}>
        <StatusBadge status={monitor.currentStatus} isActive={monitor.isActive} />
      </Box>

      <IconButton size="small" onClick={openMenu}>
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={closeMenu} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          onClick={() => {
            closeMenu();
            onToggle(monitor);
          }}
        >
          <ListItemIcon>
            {monitor.isActive ? <PauseRoundedIcon fontSize="small" /> : <PlayArrowRoundedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{monitor.isActive ? 'Jeda pemantauan' : 'Lanjutkan pemantauan'}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onEdit(monitor);
          }}
        >
          <ListItemIcon>
            <EditRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onDelete(monitor);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteRoundedIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Hapus</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
