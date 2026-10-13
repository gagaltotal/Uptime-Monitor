import { Box, Stack, Typography } from '@mui/material';

// Nama pemilik hak cipta & tahun mulai proyek. Ubah di sini jika diperlukan.
const COPYRIGHT_HOLDER = 'Uptime Monitor - Gagaltotal666';
const START_YEAR = 2026;

function copyrightYears() {
  const current = new Date().getFullYear();
  return current > START_YEAR ? `${START_YEAR}–${current}` : `${START_YEAR}`;
}

export default function AppFooter() {
  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        px: { xs: 2, sm: 3, md: 4 },
        py: 2,
        mt: 'auto',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={0.5}
        sx={{ maxWidth: 1400, mx: 'auto' }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          © {copyrightYears()} {COPYRIGHT_HOLDER}. Hak cipta dilindungi.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Dilisensikan di bawah MIT License
        </Typography>
      </Stack>
    </Box>
  );
}
