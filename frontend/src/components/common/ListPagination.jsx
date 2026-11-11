import {
  FormControl,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

/**
 * Pilihan jumlah baris per halaman. Default 10, maksimum 100.
 * Ubah di sini saja bila suatu saat perlu menambah opsi baru.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Kontrol pagination untuk daftar berbentuk baris (bukan <table>) — dipakai
 * oleh daftar monitor di Dashboard dan daftar agent.
 *
 * Komponen ini murni presentasional: pemilik state `page` dan `pageSize`
 * adalah halaman pemanggil, sehingga daftar barisnya bisa dipotong (slice)
 * dengan nilai yang sama persis.
 *
 * Responsif:
 *  - Mobile  (< sm): hitungan menampilkan di atas, pemilih baris per halaman
 *    selebar penuh, lalu tombol nomor halaman yang diringkas (tanpa angka
 *    tetangga dan tanpa tombol "pertama/terakhir") agar tidak berdesakan.
 *  - Desktop (>= sm): semuanya dalam satu baris — hitungan di kiri, pemilih
 *    baris dan tombol nomor halaman di kanan.
 *
 * @param {number}   page             Halaman aktif (1-based).
 * @param {number}   pageSize         Jumlah baris per halaman.
 * @param {number}   total            Total baris setelah filter.
 * @param {Function} onPageChange     Dipanggil dengan nomor halaman baru.
 * @param {Function} onPageSizeChange Dipanggil dengan jumlah baris baru.
 * @param {string}   itemLabel        Kata benda untuk label, mis. "monitor".
 */
export default function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'data',
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Tidak ada yang perlu dipaginasi bila daftarnya kosong.
  if (!total) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  // Pemilih jumlah baris selalu tampil selama ada data (kebiasaan DataTables
  // "Show N entries"), sedangkan tombol halaman hanya muncul bila memang ada
  // lebih dari satu halaman.
  const showNav = totalPages > 1;

  const sizeSelector = (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        Baris per halaman
      </Typography>
      <FormControl size="small" variant="outlined">
        <Select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          inputProps={{ 'aria-label': 'Jumlah baris per halaman' }}
          sx={{ minWidth: 76, fontSize: '0.8125rem' }}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <MenuItem key={option} value={option} sx={{ fontSize: '0.8125rem' }}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );

  return (
    <Stack
      direction={isMobile ? 'column' : 'row'}
      spacing={{ xs: 1.5, sm: 2 }}
      alignItems={isMobile ? 'stretch' : 'center'}
      justifyContent="space-between"
      sx={{ mt: 2 }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: { xs: 'center', sm: 'left' } }}
      >
        Menampilkan {start}–{end} dari {total} {itemLabel}
      </Typography>

      <Stack
        direction={isMobile ? 'column' : 'row'}
        spacing={{ xs: 1.25, sm: 2 }}
        alignItems="center"
        justifyContent="center"
      >
        {sizeSelector}

        {showNav && (
          <Pagination
            count={totalPages}
            page={page}
            onChange={(event, value) => onPageChange(value)}
            color="primary"
            size="small"
            shape="rounded"
            siblingCount={isMobile ? 0 : 1}
            boundaryCount={1}
            showFirstButton={!isMobile}
            showLastButton={!isMobile}
            sx={{ '& .MuiPagination-ul': { justifyContent: 'center', flexWrap: 'wrap' } }}
          />
        )}
      </Stack>
    </Stack>
  );
}
