import { useCallback, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MathCaptcha from '../components/auth/MathCaptcha';

export default function Login() {
  const { login, isAuthenticated, needsSetup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState({ token: '', answer: '' });
  // Menaikkan nilai ini me-remount <MathCaptcha> sehingga soal dimuat ulang —
  // token captcha bersifat sekali pakai, jadi setiap percobaan login (termasuk
  // yang gagal) harus memakai soal baru.
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCaptchaChange = useCallback((value) => {
    setCaptcha(value || { token: '', answer: '' });
  }, []);

  if (needsSetup) return <Navigate to="/setup" replace />;
  if (isAuthenticated) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Dicek lebih dulu di sisi klien supaya percobaan yang jelas tidak lengkap
    // tidak menghabiskan token captcha (dan kuota rate limit).
    if (!captcha.token) {
      setError('Captcha belum siap. Tunggu soal muncul atau tekan tombol muat ulang.');
      return;
    }
    if (!String(captcha.answer).trim()) {
      setError('Jawaban captcha wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      await login(email, password, captcha);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal masuk. Periksa email dan kata sandi Anda.');
      // Soal lama sudah terpakai di server (berhasil didekripsi = hangus),
      // jadi selalu terbitkan soal baru setelah kegagalan apa pun.
      setCaptcha({ token: '', answer: '' });
      setCaptchaAttempt((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: (t) => `radial-gradient(circle, ${t.palette.primary.main}14 0%, transparent 70%)`,
          pointerEvents: 'none',
        },
      }}
    >
      <Paper
        component="form"
        onSubmit={handleSubmit}
        variant="outlined"
        sx={{ p: { xs: 2.5, sm: 4 }, width: '100%', maxWidth: 380, position: 'relative' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 3 }}>
          <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: 'primary.main' }} />
          <Typography sx={{ fontFamily: (t) => t.typography.h1.fontFamily, fontWeight: 700, fontSize: '1.15rem' }}>
            Uptime Monitor
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Masuk untuk melihat status semua server dan situs Anda.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            fullWidth
          />
          <TextField
            label="Kata Sandi"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
          />
          {/* Captcha matematika — jawaban diverifikasi server sebelum kredensial
              diperiksa (lihat backend/src/routes/auth.routes.js). */}
          <MathCaptcha key={captchaAttempt} onChange={handleCaptchaChange} disabled={loading} />
          <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth>
            {loading ? 'Memproses…' : 'Masuk'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
