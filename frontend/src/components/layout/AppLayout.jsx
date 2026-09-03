import { useState } from 'react';
import {
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SpaceDashboardRoundedIcon from '@mui/icons-material/SpaceDashboardRounded';
import ReportRoundedIcon from '@mui/icons-material/ReportRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { SocketProvider, useSocket } from '../../hooks/useSocket';
import { useColorMode } from '../../main.jsx';

const DRAWER_WIDTH = 240;

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: SpaceDashboardRoundedIcon, end: true },
  { to: '/incidents', label: 'Insiden', icon: ReportRoundedIcon },
  { to: '/status-pages', label: 'Halaman Status', icon: PublicRoundedIcon },
  { to: '/settings', label: 'Pengaturan', icon: SettingsRoundedIcon },
];

function Brand() {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 2.5, py: 2.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: 'primary.main' }} />
      <Typography sx={{ fontFamily: (t) => t.typography.h1.fontFamily, fontWeight: 700, fontSize: '1.05rem' }}>
        Uptime Monitor
      </Typography>
    </Stack>
  );
}

function ConnectionStatus() {
  const { connected } = useSocket();
  const { mode, toggle } = useColorMode();
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pl: 2.5, pr: 1.5, py: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: connected ? 'status.up' : 'status.down',
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {connected ? 'Real-time' : 'Terputus…'}
        </Typography>
      </Stack>
      <IconButton size="small" onClick={toggle} title={mode === 'dark' ? 'Mode terang' : 'Mode gelap'}>
        {mode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
      </IconButton>
    </Stack>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);

  const handleLogout = async () => {
    setAnchorEl(null);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ px: 2.5, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Avatar sx={{ width: 30, height: 30, fontSize: '0.85rem', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          {user?.name?.[0]?.toUpperCase() || '?'}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {user?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {user?.email}
          </Typography>
        </Box>
      </Stack>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutRoundedIcon fontSize="small" />
          </ListItemIcon>
          Keluar
        </MenuItem>
      </Menu>
    </>
  );
}

function SidebarContent() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Brand />
      <Box sx={{ flex: 1, px: 1.5 }}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <Box
            key={to}
            component={NavLink}
            to={to}
            end={end}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1.5,
              py: 1.1,
              mb: 0.5,
              borderRadius: 2,
              textDecoration: 'none',
              color: 'text.secondary',
              fontSize: '0.9rem',
              fontWeight: 600,
              '&.active': { color: 'text.primary', bgcolor: 'action.selected' },
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            <Icon fontSize="small" />
            {label}
          </Box>
        ))}
      </Box>
      <Divider />
      <ConnectionStatus />
      <Divider />
      <UserMenu />
    </Box>
  );
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <SocketProvider>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          <SidebarContent />
        </Drawer>

        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <SidebarContent />
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Toolbar
            variant="dense"
            sx={{ display: { xs: 'flex', md: 'none' }, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <IconButton edge="start" onClick={() => setMobileOpen(true)}>
              <MenuRoundedIcon />
            </IconButton>
          </Toolbar>
          <Box sx={{ flex: 1, p: { xs: 2, sm: 3, md: 4 }, maxWidth: 1400, width: '100%', mx: 'auto' }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </SocketProvider>
  );
}
