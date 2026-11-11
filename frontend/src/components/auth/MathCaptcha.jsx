import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import FunctionsIcon from '@mui/icons-material/Functions';
import api from '../../api/axios';

/**
 * Captcha matematika untuk halaman login.
 *
 * Soal (+ − × ÷) diambil dari GET /api/auth/captcha. Jawaban BENAR tidak pernah
 * dikirim ke browser: server hanya mengembalikan soal sebagai teks dan sebuah
 * token terenkripsi. Komponen ini meneruskan keduanya ke induk lewat
 * `onChange({ token, answer })`, lalu /auth/login memverifikasinya.
 *
 * Latar belakang warna & tipografi memakai token tema (surface.raised,
 * typography.fontFamilyMono) agar tetap konsisten di mode terang/gelap.
 *
 * Responsif:
 *  - < sm (mobile): soal di atas, input jawaban di bawahnya (full width).
 *  - ≥ sm (desktop): soal di kiri, input di kanan dalam satu baris.
 *
 * Untuk memuat soal baru, induk cukup mengganti `key` komponen ini (remount
 * memicu fetch ulang) atau komponen memuat ulang sendiri saat tombol refresh
 * ditekan.
 */
export default function MathCaptcha({ onChange, disabled = false, error: externalError = '' }) {
  const [question, setQuestion] = useState('');
  const [token, setToken] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Callback induk disimpan di ref supaya efek fetch tidak ikut berjalan ulang
  // setiap render ketika induk mengirim arrow function baru.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCaptcha = useCallback(async () => {
    setLoading(true);
    setError('');
    setAnswer('');
    try {
      const { data } = await api.get('/auth/captcha');
      if (!mountedRef.current) return;
      setQuestion(data?.captcha?.question || '');
      setToken(data?.captcha?.token || '');
      onChangeRef.current?.({ token: data?.captcha?.token || '', answer: '' });
    } catch (err) {
      if (!mountedRef.current) return;
      setQuestion('');
      setToken('');
      setError(err.response?.data?.message || 'Gagal memuat captcha. Coba muat ulang.');
      onChangeRef.current?.({ token: '', answer: '' });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  const handleAnswerChange = (event) => {
    // Hanya angka yang dipertahankan: pengguna tidak perlu mengetik tanda
    // baca apa pun, dan ini mencegah input aneh terkirim ke server.
    const raw = event.target.value.replace(/[^\d-]/g, '').slice(0, 5);
    setAnswer(raw);
    onChangeRef.current?.({ token, answer: raw });
  };

  const message = error || externalError;
  const isError = Boolean(message);

  return (
    <Box>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.25, sm: 1.5 },
          borderColor: isError ? 'error.main' : 'divider',
          bgcolor: 'transparent',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1.25, sm: 1.5 }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ flexShrink: 0, minWidth: 0 }}
          >
            <Box
              aria-live="polite"
              aria-label={question ? `Soal captcha: ${question}` : 'Memuat soal captcha'}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                flex: { xs: 1, sm: 'initial' },
                minWidth: { xs: 0, sm: 132 },
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: '1px dashed',
                borderColor: 'divider',
                bgcolor: 'surface.raised',
                fontFamily: (t) => t.typography.fontFamilyMono,
                fontSize: { xs: '1.05rem', sm: '1rem' },
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'text.primary',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {loading ? (
                <CircularProgress size={16} thickness={5} />
              ) : (
                <>
                  <FunctionsIcon sx={{ fontSize: 17, color: 'text.secondary', flexShrink: 0 }} />
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {question || '—'}
                  </Box>
                </>
              )}
            </Box>

            <Tooltip title="Ganti soal">
              <span>
                <IconButton
                  type="button"
                  size="small"
                  onClick={loadCaptcha}
                  disabled={loading || disabled}
                  aria-label="Ganti soal captcha"
                  sx={{ color: 'text.secondary' }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <TextField
            label="Jawab"
            size="small"
            value={answer}
            onChange={handleAnswerChange}
            disabled={disabled || loading || !token}
            placeholder="Hasil"
            inputProps={{
              inputMode: 'numeric',
              pattern: '[0-9-]*',
              autoComplete: 'off',
              maxLength: 5,
              'aria-label': 'Jawab captcha',
            }}
            error={isError}
            fullWidth
            sx={{ flex: 1 }}
            InputProps={{
              sx: { fontFamily: (t) => t.typography.fontFamilyMono, letterSpacing: '0.02em' },
              endAdornment: (
                <InputAdornment position="end">
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    =
                  </Typography>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </Paper>

      <Typography
        variant="caption"
        color={isError ? 'error.main' : 'text.secondary'}
        sx={{ display: 'block', mt: 0.75, px: 0.25, lineHeight: 1.5 }}
      >
        {message || 'Hitung hasil soal di atas untuk melanjutkan.'}
      </Typography>
    </Box>
  );
}