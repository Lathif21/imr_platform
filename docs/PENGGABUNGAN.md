# Penggabungan IMR_keu + LaporanKeuangan

Satu platform untuk dua sistem yang selama ini berdiri sendiri:

| Asal | Isi | Stack lama |
|---|---|---|
| IMR_keu | Portal laporan laba rugi & konsolidasi 4 entitas | SvelteKit + Neon |
| LaporanKeuangan | Sistem operasional ILJ: kapal, truk, transaksi, rekap, pencairan, laporan & cetak | Laravel 12 + Blade + Alpine |

Platform ini adalah **salinan IMR_keu** yang diperluas. Design dan aturan
(`CLAUDE.md`, invarian 1–8) berlaku apa adanya untuk modul operasional. UX
feedback-nya ditiru dari LaporanKeuangan.

Kedua sistem lama **tidak disentuh** dan tetap berjalan sampai cutover.

---

## Keputusan 7 Oktober 2026

Diputuskan pemilik sistem. Dicatat supaya terbaca sebagai pilihan, bukan kebetulan.

| # | Keputusan | Akibatnya |
|---|---|---|
| P-1 | Basis SvelteKit (IMR_keu); seluruh modul Laravel di-port | Tidak ada PHP di platform ini |
| P-2 | Satu database Neon, **project baru** | Integrasi HTTP + token diganti query SQL langsung (lihat "Integrasi") |
| P-3 | Feedback: **modal sukses + modal error** | `notify()` di `src/lib/feedback.svelte.ts`; toast hanya untuk info |
| P-4 | Data produksi kedua sistem **dimigrasikan** | Skrip migrasi data, diuji di branch Neon dulu |
| P-5 | Peran baru `admin_operasional` | Ditugaskan per entitas lewat `user_entity_access` |
| P-6 | Peran `hrd` **tidak dibuat** untuk saat ini; akun HRD memakai peran `direksi` | Lihat konsekuensinya di "Hak akses" |
| P-7 | Data operasional ber-`entity_id`; seluruh data lama = ILJ | RLS memakai `has_entity_access()` yang sudah ada |
| P-8 | `activity_logs` diganti `audit_log` (trigger) | Notifikasi kolaborasi membaca `audit_log` |
| P-9 | Akun Laravel dibuat ulang oleh direksi | Password bcrypt tidak dipindah; email lama dipakai untuk memetakan `created_by` |

---

## Sudah dikerjakan (fondasi)

| Hal | Di mana |
|---|---|
| Salinan IMR_keu tanpa `.git`, `node_modules`, `.env`, kredensial lokal | folder ini, `git init` |
| Stack Supabase lokal tersendiri: `project_id = IMR_platform`, port **553xx** | `supabase/config.toml` — tidak bentrok dengan stack IMR_keu (543xx) |
| Peran `admin_operasional` | `migrations/20250107000000_role_admin_operasional.sql` |
| 16 tabel operasional + RLS + audit + indeks | `migrations/20250108000000_operasional.sql` |
| Hak laporan P&L jadi daftar izin eksplisit | migrasi yang sama, bagian 1b |
| Akun dev `admin.ilj@example.test` (admin_operasional, ILJ) | `supabase/seed.sql` |
| Tes RLS operasional — 16 assertion | `tests/operasional-rls.test.ts` |
| Modal sukses/error + kotak akibat di konfirmasi | `src/lib/components/Feedback.svelte` |
| Layar Input Laporan memakai modal | `src/routes/(app)/entry/[period]/+page.svelte` |

`npm test`: **206/206 lulus** (190 tes lama + 16 baru). `npm run check`: 0 error.

### Temuan saat membangun: celah hak P&L

`periods_insert`, `periods_update`, dan `lines_write` hanya mensyaratkan
"punya akses entitas dan bukan auditor". Begitu `admin_operasional` ditugaskan
ke ILJ, ia otomatis bisa membuat periode P&L ILJ, mengubah angkanya, dan
mengajukannya — `guard_period_transition` tidak membatasi siapa yang mengajukan.

Ditutup dengan `can_read_reports()` / `can_write_reports()`: daftar izin yang
mempertahankan hak keempat peran lama persis seperti sebelumnya. Seluruh tes
RLS dan workflow lama tetap lulus, dan `operasional-rls.test.ts` mengunci
keduanya.

---

## Hak akses

| | Data operasional | Laporan P&L | Admin |
|---|---|---|---|
| `direksi` (termasuk akun HRD, P-6) | baca semua entitas | penuh | ya |
| `admin_operasional` | baca + tulis entitas yang ditugaskan | **tidak** | tidak |
| `manajer_keuangan` | **tidak** | seperti sekarang | tidak |
| `staf_entitas` | **tidak** | seperti sekarang | tidak |
| `auditor` | **tidak** | seperti sekarang | tidak |

Sel yang dicetak tebal adalah **default tertutup**, belum keputusan — lihat
"Pertanyaan terbuka". Semuanya cukup diubah di satu fungsi SQL.

**Konsekuensi P-6 yang perlu diketahui:** di Laravel, HRD hanya membaca. Dengan
peran direksi, akun HRD juga bisa mengelola pengguna, entitas, template, dan
membuka kunci periode. Karena itulah direksi sengaja **tidak** diberi hak tulis
data operasional — supaya HRD tetap tidak bisa mengubah transaksi.

---

## Peta port modul

Urutan dari yang paling banyak dipakai sebagai dasar modul lain. Ukuran = baris
Blade + controller di Laravel, sebagai gambaran besar pekerjaan.

| Fase | Modul | Laravel | Rute baru (usulan) | Ukuran |
|---|---|---|---|---|
| 1 | Master data: pemilik, kendaraan, karyawan (+ catatan SP) | `PemilikController`, `KendaraanController`, `KaryawanController` | `/operasional/pemilik`, `/kendaraan`, `/karyawan` | ~1.500 |
| 1 | Kapal + rute + rincian muatan truk | `KapalController` | `/operasional/kapal`, `/kapal/[id]` | ~700 |
| 2 | Transaksi operasional | `TransaksiOperasionalController` | `/operasional/transaksi` | ~2.500 |
| 2 | Rekap operasional (input massal, edit kegiatan) | `OperasionalController` | `/operasional/rekap` | ~2.100 |
| 3 | Pengeluaran | `PengeluaranController` | `/operasional/pengeluaran` | ~500 |
| 3 | Pencairan + approval Jetty → Gudang → Accounting | `PencairanController` | `/operasional/pencairan` | ~1.000 |
| 4 | Laporan: partner, telly/gaji, paguyuban, karyawan, pendapatan, kumpulan, keuangan | `LaporanController` (2.131 baris) | `/operasional/laporan/*` | ~6.000 |
| 4 | Cetak (BA, pendapatan, kumpulan, gaji, pengeluaran, operasional) | `*_cetak.blade.php` | halaman cetak + CSS `@media print` | ~1.200 |
| 5 | Dasbor operasional (3 bagian: pendapatan bersih, pengeluaran kotor, pencairan) | `DashboardController` | `/operasional` | ~400 |
| 5 | Notifikasi kolaborasi dari `audit_log` | `layouts/app.blade.php` polling 5 dtk | toast `info` | kecil |

Tiap modul dikerjakan di branch sendiri dan di-review sebelum modul berikutnya.

Aturan untuk setiap port:

- **Logika hitung dipindah apa adanya dulu, diperbaiki kemudian, terpisah.**
  Port yang sekaligus "membetulkan" rumus membuat selisih angka tidak bisa
  dilacak ke salah satu penyebabnya. Untuk setiap laporan, angka platform baru
  dibandingkan dengan angka Laravel pada data yang sama sebelum dianggap selesai.
- Setiap aksi tulis memakai `notify('success' | 'error')`; error validasi
  mengirim `details` (satu baris per isian) seperti modal "Gagal Menyimpan
  Data" di Laravel. Hapus memakai `confirmDialog` dengan `consequence`.
- Bug yang sudah tercatat di sisi Laravel (`docs/task/10-integrasi-operasional.md`)
  tidak ikut di-port: label `pendapatan` di laporan keuangan yang sebenarnya
  beban, dan `max()` gaji.

---

## Integrasi: dari HTTP ke SQL

Dengan satu database, `GET /api/integrasi/rekap-bulanan` dan tokennya tidak
diperlukan lagi. Penggantinya: satu fungsi SQL baca-saja, misalnya
`rekap_operasional_bulanan(entity_id, periode)`, yang menerjemahkan
`IntegrasiController@rekapBulanan` **baris demi baris** — termasuk keputusan
20 September dan 4 Oktober 2026 (COGS_OPS dari rekap, aturan transaksi-atau-rekap
per rute, tiga jenis baris `gaji_telly`, `biaya_per_jenis`).

Yang ikut pensiun setelahnya: `operational_sync_config`, `OPERATIONAL_SYNC_TOKEN`,
dan pemanggilan `fetch` di action `tarikOperasional`. Tes di
`tests/operational-mapping.test.ts` dan kasus di
`LaporanKeuangan/tests/Feature/IntegrasiRekapBulananTest.php` menjadi tes fungsi itu.

Bukti kesetaraan sebelum endpoint lama dimatikan: untuk setiap bulan yang ada
datanya, hasil fungsi = hasil endpoint Laravel, **sampai ke sen**.

---

## Migrasi data produksi

Skrip `scripts/migrasi-data.ts` (belum ditulis), mengikuti pola
`scripts/neon-migrate.ts`:

1. Baca dari database Laravel (`neondb`), tulis ke database platform baru.
   Hanya membaca dari sumber — tidak ada satu pun tulis ke sistem lama.
2. `id` lama disisipkan apa adanya (kolom `generated by default`), lalu
   sequence di-`setval` ke `max(id)`. Nomor yang sudah tercetak di dokumen tetap
   menunjuk baris yang sama.
3. `entity_id` = ILJ untuk seluruh baris.
4. `created_by` / `updated_by`: dipetakan lewat email `users` Laravel ke
   `profiles` platform baru. Akun yang belum dibuat ulang → `null`, dan
   jumlahnya dilaporkan.
5. `gaji_telly.created_at` disalin persis — untuk gaji admin itu penanda bulan.
6. `activity_logs` disalin ke tabel arsip terpisah, tidak ke `audit_log`
   (`audit_log` append-only dan hanya ditulis trigger, invarian 4).
7. Data IMR_keu (entitas, profil, periode, baris laporan, kebijakan, audit) dipindah
   dengan `pg_dump` per tabel; `audit_log` ikut utuh.
8. **Verifikasi, bukan sekadar sukses tanpa error:** jumlah baris dan jumlah
   nominal per tabel per bulan di sumber vs tujuan, ditulis ke laporan. Skrip
   menolak selesai bila ada selisih.

Dijalankan pertama kali ke **branch Neon**, bukan production.

---

## Pertanyaan terbuka

Sampai dijawab, sistem memakai default tertutup yang disebut.

| # | Pertanyaan | Default sekarang |
|---|---|---|
| Q-1 | Apakah `admin_operasional` boleh **membaca** Laporan P&L entitasnya? | tidak |
| Q-2 | Apakah `direksi` boleh **menulis** data operasional? (Ingat P-6: HRD ikut) | tidak |
| Q-3 | Apakah `manajer_keuangan` / `auditor` boleh membaca data operasional? | tidak |
| Q-4 | Neon project baru: dibuat oleh siapa, nama dan region? Koneksi MCP Neon di sesi ini terbatas ke satu project dan tidak bisa membuat project. | belum ada |
| Q-5 | Nama aplikasi di sidebar dan judul tab (sekarang "Portal Keuangan") | tidak diubah |
| Q-6 | Referensi lintas entitas (mis. transaksi entitas A menunjuk kapal entitas B) belum dicegah di database. Ditambah composite FK sebelum entitas kedua memakai modul operasional? | belum dicegah — hanya ILJ yang memakai |
| Q-7 | `transaksi_operasional.pendapatan` dan `kapal_muatan_detail.pendapatan_rekanan` menyimpan hasil hitung. Dihitung di view saja setelah port? | disimpan, seperti Laravel |
| Q-8 | Kapan cutover, dan apakah ada masa paralel (kedua sistem diisi) sebelumnya? | belum ditentukan |
