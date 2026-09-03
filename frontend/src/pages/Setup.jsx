import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Setup() {
  const { setupAdmin, needsSetup, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // This route only makes sense before any admin exists; once it does,
  // send visitors straight to the normal login screen.
  if (!needsSetup && !isAuthenticated) return <Navigate to="/login" replace />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Kata sandi minimal 8 karakter.');
      return;
    }
    setLoading(true);
    try {
      await setupAdmin(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal membuat akun admin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Paper component="form" onSubmit={handleSubmit} variant="outlined" sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 3 }}>
          <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: 'primary.main' }} />
          <Typography sx={{ fontFamily: (t) => t.typography.h1.fontFamily, fontWeight: 700, fontSize: '1.15rem' }}>
            Uptime Monitor
          </Typography>
        </Stack>

        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Selamat datang 👋
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Buat akun admin pertama untuk mulai memantau server dan situs Anda. Setelah ini dibuat,
          pendaftaran publik akan otomatis dinonaktifkan.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField label="Nama" value={name} onChange={(e) => setName(e.target.value)} required autoFocus fullWidth />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="Kata Sandi"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            helperText="Minimal 8 karakter"
          />
          <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth>
            {loading ? 'Membuat akun…' : 'Buat Akun Admin'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
