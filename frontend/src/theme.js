import { createTheme } from '@mui/material/styles';

// --- Design tokens -----------------------------------------------------
// Visual language: an instrument panel / phosphor terminal, not a generic
// SaaS dashboard. Flat, information-dense rows over boxed card grids;
// hairline dividers instead of drop shadows; a single warm amber accent
// (nodding to amber CRT terminals — familiar territory for the sysadmin
// audience this tool serves) that does double duty as both the brand color
// and the "pay attention" signal for things like SSL warnings. Status
// colors (up/down) stay conventional green/red for instant recognition.
const tokens = {
  dark: {
    background: '#0B0F14',
    panel: '#121821',
    panelRaised: '#1A2230',
    line: '#232C38',
    textPrimary: '#E8ECF1',
    textSecondary: '#8592A3',
  },
  light: {
    background: '#F4F6F8',
    panel: '#FFFFFF',
    panelRaised: '#EFF2F5',
    line: '#DDE3E9',
    textPrimary: '#121821',
    textSecondary: '#5B6774',
  },
  brand: { main: '#F0A94E', light: '#FFC97A', dark: '#C97F1F', contrastText: '#1A1206' },
  up: { main: '#34D399', dark: '#1F9D74' },
  down: { main: '#F5484B', dark: '#C22B2E' },
  warn: { main: '#E8B23D', dark: '#B8841F' },
  fontDisplay: "'Space Grotesk', 'Inter', sans-serif",
  fontBody: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
};

export function getTheme(mode = 'dark') {
  const t = tokens[mode];
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      background: { default: t.background, paper: t.panel },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.line,
      primary: { main: tokens.brand.main, light: tokens.brand.light, dark: tokens.brand.dark, contrastText: tokens.brand.contrastText },
      success: { main: tokens.up.main, dark: tokens.up.dark, contrastText: '#052014' },
      error: { main: tokens.down.main, dark: tokens.down.dark, contrastText: '#2B0505' },
      warning: { main: tokens.warn.main, dark: tokens.warn.dark, contrastText: '#241A03' },
      // Custom, non-standard palette entries — referenced directly as
      // theme.palette.status.* / theme.palette.surface.* around the app.
      status: {
        up: tokens.up.main,
        down: tokens.down.main,
        pending: t.textSecondary,
        paused: isDark ? '#4B5768' : '#B7C0CA',
      },
      surface: { panel: t.panel, raised: t.panelRaised, line: t.line },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: tokens.fontBody,
      fontFamilyMono: tokens.fontMono,
      h1: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '2.5rem', letterSpacing: '-0.01em' },
      h2: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '2rem', letterSpacing: '-0.01em' },
      h3: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '1.5rem' },
      h4: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '1.25rem' },
      h5: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '1.125rem' },
      h6: { fontFamily: tokens.fontDisplay, fontWeight: 600, fontSize: '1rem' },
      body1: { fontSize: '0.9375rem' },
      body2: { fontSize: '0.8125rem' },
      button: { fontWeight: 600, fontSize: '0.875rem', textTransform: 'none' },
      caption: { fontSize: '0.75rem' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: `${t.line} transparent`,
          },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-thumb': { backgroundColor: t.line, borderRadius: 8 },
          '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
        defaultProps: { elevation: 0 },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: t.panel,
            boxShadow: 'none',
            borderBottom: `1px solid ${t.line}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundColor: t.panel, borderRight: `1px solid ${t.line}`, backgroundImage: 'none' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, textTransform: 'none', fontWeight: 600 },
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { border: `1px solid ${t.line}`, backgroundImage: 'none', borderRadius: 10 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 14, border: `1px solid ${t.line}` },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 6 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 8 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: t.panelRaised,
            border: `1px solid ${t.line}`,
            color: t.textPrimary,
            fontSize: '0.75rem',
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: t.line } },
      },
      MuiTableCell: {
        styleOverrides: { root: { borderColor: t.line } },
      },
    },
  });
}

export default getTheme;
