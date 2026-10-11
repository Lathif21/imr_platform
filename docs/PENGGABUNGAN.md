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
| `admin_operasional` | baca + tulis entitas yang ditugaskan | baca saja, entitas yang ditugaskan | tidak |
| `manajer_keuangan` | baca entitas yang ditugaskan | seperti sekarang | tidak |
| `staf_entitas` | **tidak** | seperti sekarang | tidak |
| `auditor` | baca entitas yang ditugaskan | seperti sekarang | tidak |

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
| 2 ✓ | Transaksi operasional (Database General) | `TransaksiOperasionalController` | `/operasional/general` | ~2.500 |
| 2 ✓ | Rekap operasional (Detail Kegiatan, Lengkapi Data, Pembayaran Truk) | `OperasionalController` | `/operasional/kegiatan`, `/kegiatan/[id]` | ~2.100 |
| 3 ✓ | Pengeluaran | `PengeluaranController` | `/operasional/pengeluaran` | ~500 |
| 3 ✓ | Pencairan + approval Jetty → Gudang → Accounting | `PencairanController` | `/operasional/pencairan` | ~1.000 |
| 4 ✓ | Laporan: partner, telly/gaji, paguyuban, karyawan, pendapatan (4a), kumpulan, keuangan (4b) | `LaporanController` (2.131 baris) | `/operasional/laporan/*` | ~6.000 |
| 4 ✓ | Cetak (BA, pendapatan, kumpulan, gaji, pengeluaran, operasional) | `*_cetak.blade.php` | halaman cetak + CSS `@media print` | ~1.200 |
| 5 ✓ | Dasbor operasional (3 bagian: pendapatan bersih, pengeluaran kotor, pencairan) | `DashboardController` | `/operasional` | ~400 |
| 5 ✓ | Notifikasi kolaborasi dari `audit_log` | `layouts/app.blade.php` polling 5 dtk | toast `info` | kecil |

Tiap modul dikerjakan di branch sendiri dan di-review sebelum modul berikutnya.

### Fase 1a — selesai 7 Oktober 2026

`/operasional/pemilik`, `/operasional/kendaraan`, `/operasional/karyawan`
(+ catatan kinerja/SP). Angka ringkasan dari view
`v_pemilik_ringkasan`, `v_kendaraan_ringkasan`, `v_karyawan_ringkasan`
(`20250111000000`); tes di `tests/operasional-master.test.ts`.

Yang **sengaja berbeda** dari Laravel — tinjau bila tidak setuju:

| Hal | Laravel | Di sini | Alasan |
|---|---|---|---|
| Hapus kendaraan | ditolak bila ada transaksi | ditolak bila ada transaksi **atau rincian muatan kapal** | FK muatan `ON DELETE CASCADE`: rinciannya akan ikut terhapus diam-diam |
| Nopol saat diubah | huruf besar hanya saat dibuat | huruf besar + spasi dirapikan saat dibuat **dan** diubah | perubahan bisa menyelipkan duplikat huruf kecil melewati indeks unik |
| Daftar | paginasi 10 baris | semua baris + kotak cari | master data satu entitas berukuran puluhan–ratusan baris |
| Detail pemilik | halaman `pemilik/show` | tautan "n unit" → Kendaraan terfilter pemilik itu | isinya sama: daftar kendaraan pemilik |
| Label kolom pemilik | "Pendapatan Bruto" | "Pendapatan Bruto Rekanan" | angkanya uang yang DIBAYAR ke rekanan, bukan pendapatan entitas |

### Fase 1b — selesai 12 Oktober 2026

`/operasional/kapal`: daftar kapal (nama, perusahaan pemilik), tambah, ubah,
hapus. Hapus lewat `hapus_kapal()` (`20250112000000`); tes di
`tests/operasional-kapal.test.ts`.

**Rute dan rincian muatan truk tidak di-port di sini**, karena di Laravel
keduanya kode mati: `kapal/show.blade.php` memanggil `kapal.rute.store` dan
`kapal.muatan.store`, tetapi `KapalController` tidak punya `show`,
`storeRute`, maupun `storeMuatan`, dan tidak ada tautan ke halaman itu. Rute
dan truk yang dipakai admin diisi lewat Database General / Detail Kegiatan
Kapal (Fase 2).

| Hal | Laravel | Di sini | Alasan |
|---|---|---|---|
| Nama kapal ganda | `unique:kapal,nama_kapal` | ditolak per entitas, tanpa memedulikan besar-kecil huruf dan spasi berlebih | kolomnya sengaja tidak unik di skema; tanpa cek, "KM Sinar" dan "km  sinar" membelah satu riwayat |
| Hapus: honor telly per kegiatan | dihapus eksplisit | dihapus eksplisit di `hapus_kapal()` | FK `gaji_telly.operasional_rekap_id` SET NULL — tanpa itu baris tersisa tanpa induk dan terbaca sebagai **gaji admin** |
| Hapus: kapal yang punya pencairan | (tidak ada pencairan per kapal yang ikut terhapus) | **ditolak** | FK `pencairan.kapal_id` CASCADE akan menghapus pencairan dan riwayat approval diam-diam |
| Kolom daftar | No, Nama, Pemilik | + jumlah Kegiatan dan Truk | konfirmasi hapus menyebut apa saja yang ikut terhapus |

**Setiap migrasi yang menambah tabel atau fungsi butuh "Refresh schema
cache"** di Neon Console (Postgres database → Data API). Data API Neon tidak
mengikuti `NOTIFY pgrst`; sebelum di-refresh, panggilan ke objek baru gagal
`PGRST202`.

### Fase 2 — selesai 12 Oktober 2026

Empat layar, semuanya per bulan (`?bulan=&tahun=`):

| Layar | Rute | Laravel |
|---|---|---|
| Database General | `/operasional/general` | `transaksi/index` + `OperasionalController::storeBulk`, `updateRekapModal`, `destroy` |
| Detail Kegiatan Kapal | `/operasional/kegiatan` | `OperasionalController::index` |
| Lengkapi Data Kegiatan | `/operasional/kegiatan/[id]` | `OperasionalController::editKegiatan`, `updateKegiatan` |
| Rincian Pembayaran Truk | `/operasional/kegiatan/[id]/pembayaran` | `LaporanController::editKegiatanPartner`, `updatePembayaranBulk` |

Setiap simpan yang menyentuh lebih dari satu tabel adalah satu fungsi
database (`20250113000000_kegiatan_kapal.sql`): `tambah_kegiatan`,
`ubah_kegiatan`, `simpan_rincian_kegiatan`, `simpan_pembayaran_truk`, dengan
pembantu `hitung_ulang_kegiatan` (jumlah truk + honor telly) dan
`sinkron_paguyuban`. Laravel menulisnya berurutan tanpa transaksi. Hapus
kegiatan cukup `delete` biasa: truk, iuran, dan honor telly ikut lewat FK
CASCADE. Tes: `tests/operasional-kegiatan.test.ts` (DB) dan
`tests/kegiatan-helpers.test.ts` (rute, angka, periode).

Rumus dipindah apa adanya: jumlah kegiatan = jumlah truk; beban rekanan =
tonase × ongkos angkut; paguyuban = tonase × tarif (500); honor telly =
tonase kegiatan × gaji per ton (tersimpan → tarif telly → 400), PPh
dipertahankan. Dua perbaikan PR #5 ikut: Bulan Pengiriman mengikuti tanggal
kegiatan, dan Detail Kegiatan punya tombol Tambah Kegiatan.

Yang **sengaja berbeda** — semuanya kasus yang merusak data di Laravel:

| Hal | Laravel | Di sini |
|---|---|---|
| Tambah kapal yang sudah punya kegiatan di bulan itu | `updateOrCreate` menimpa kegiatan lama: tonase dan biaya operasional jadi 0 | selalu kegiatan baru |
| Membuka Lengkapi Data | GET membuat kegiatan bila belum ada | halaman hanya membaca, dibuka per id |
| Kapal di form tambah/ubah | `kapal_id` dari combobox tertinggal walau nama diketik ulang | hanya nama; dicari tanpa beda huruf/spasi, dibuat bila baru |
| Truk lama dicantumkan di kelompok pemilik lain | kendaraan dipindah ke pemilik itu, untuk semua kegiatan | pemilik truk lama tidak berubah (ubah di Master Kendaraan) |
| Truk baru dengan pemilik baru | nama pemilik hilang, `pemilik_id` kosong | pemilik dibuat; truk baru tanpa pemilik ditolak |
| Ritase/tonase 0 di Lengkapi Data | diabaikan, angka lama dipertahankan | tersimpan 0 |
| Tonase berubah di Lengkapi Data | paguyuban dan beban rekanan tidak ikut | keduanya dihitung ulang |
| Ubah Data memindahkan bulan/kapal | hanya kegiatan yang pindah; truknya tertinggal | truk dan iurannya ikut |
| Hitung ulang setelah Rincian Pembayaran | dicari lewat (kapal, rute, bulan) — dua kegiatan serupa tercampur | per kegiatan |
| Ganti petugas telly | tarif petugas lama tetap dipakai | tarif petugas baru |
| Biaya operasional kosong di Detail Kegiatan | ditampilkan tonase × 1.000 dan ikut total, padahal laporan keuangan membaca 0 | "Belum diisi" (perkiraan di tooltip), total = angka tersimpan |
| Hapus kegiatan | ikut menghapus baris Laporan Pendapatan yang namanya mirip nama kapal | hanya baris pendapatan **kegiatan itu** (tautan id, Fase 4a), dan hanya bila belum dibayar dan belum punya pencairan |
| Satu truk dua kali di satu kegiatan | saling menimpa | ditolak (`unique (operasional_rekap_id, kendaraan_id)`) |
| FK `gaji_telly.operasional_rekap_id` | — | `ON DELETE CASCADE` (dulu SET NULL → tersisa sebagai gaji admin) |

`syncMissingShipsToPendapatan` di-port di Fase 4a (trigger, tautan id).
Penghapusan snapshot `laporan_kumpulan` menyusul bersama layar Kumpulan (4b).

**Truk tanpa kegiatan** (`operasional_rekap_id` null) tidak dibuat oleh
platform; hanya bisa datang dari migrasi data Laravel. Database General
menghitung dan memberitahukannya, tidak menyembunyikannya. Skrip migrasi data
sebaiknya menautkannya ke kegiatan dengan (kapal, rute, bulan) yang sama.

### Fase 3 — selesai 12 Oktober 2026

- **Pengeluaran** `/operasional/pengeluaran`: daftar per bulan + total,
  tambah, ubah, hapus. Tabel biasa, tanpa fungsi. Jenis dipilih dari ejaan
  yang sudah ada (pengeluaran + `operational_expense_mapping`), jenis baru
  hanya lewat pilihan "+ Jenis pengeluaran baru" dan diberi tahu bahwa ia
  masuk "Pengeluaran lain-lain" sampai dipetakan. Pemetaan dicocokkan persis,
  jadi salah ketik berarti salah pos. Cetak: Fase 4.
- **Pencairan** `/operasional/pencairan`: invoice per kapal, persetujuan
  Jetty/Gudang/Accounting dengan preview BA, status final. Fungsi
  `simpan_pencairan`, `setujui_pencairan`, `hapus_pencairan`
  (`20250114000000_pencairan.sql`). Tes: `tests/operasional-pencairan.test.ts`.

Alur Laravel dipertahankan: invoice baru → tiga persetujuan Pending + baris
Laporan Pendapatan `PENDING` (total = nominal, net = nominal − pajak, tarif
pajak 0,5); ketiganya Approved → pencairan Approved + pendapatan
`PROSES PAYMENT`; ada yang Rejected → Rejected + `PENDING`; tanggal tanda
tangan kosong = hari ini; hapus ikut menghapus pendapatan invoice itu yang
belum dibayar.

| Hal | Laravel | Di sini |
|---|---|---|
| Membuka halaman Pencairan | GET membuat pencairan untuk setiap invoice pendapatan (kapal ditebak dari nama, gagal → kapal pertama) dan **menghapus** pencairan yang invoicenya tidak ada di pendapatan | halaman hanya membaca; tombol "Tarik dari Laporan Pendapatan" (Fase 4a) hanya menambah |
| Tahun | pencairan tanpa tahun; sinkron ke pendapatan memakai tahun jam server | kolom `pencairan.tahun` (data lama diisi dari `created_at`) |
| Status pencairan | bisa ditimpa di form Ubah dan tombol Proses Payment | hanya diturunkan dari ketiga persetujuan |
| Tombol "Lanjut ke Proses Payment" | menyetel Approved lalu membuka Pendapatan Bulanan | status "Approved · Proses Payment"; pendapatan sudah `PROSES PAYMENT` saat persetujuan ketiga; statusnya menautkan ke Laporan Pendapatan posisi Proses Payment |
| Ubah invoice yang pendapatannya LUNAS | angka pendapatan ditimpa | pendapatan LUNAS / sudah ada tanggal bayar tidak disentuh |
| Nominal dari pendapatan | sinkron GET memakai net tagihan sebagai nominal, lalu sinkron balik menulisnya sebagai total — total menyusut sebesar pajak setiap putaran | nominal selalu bruto (= total pendapatan) |
| Pencarian pendapatan per invoice | seluruh tabel, lintas entitas | per entitas |

### Fase 4a — Laporan Pendapatan, selesai 12 Oktober 2026

- `/operasional/pendapatan`: kartu ringkasan (total bulan, belum/sudah
  dibayar, total keseluruhan), filter posisi piutang, tabel yang diedit
  langsung + "Simpan Semua", Tambah Baris, Generate dari Kegiatan, Rapikan
  Nomor, hapus.
- Cetak tanpa bingkai aplikasi: `/cetak/operasional/pendapatan` (REKAP INCOME,
  A4 lanskap) dan `/cetak/operasional/ba/[id]` (Berita Acara).
- Pencairan: tombol "Tarik dari Laporan Pendapatan", status Approved menautkan
  ke posisi Proses Payment, preview BA menautkan ke cetak BA.
- Migrasi `20250115000000_laporan_pendapatan.sql`; tes
  `tests/operasional-pendapatan.test.ts`, `tests/pendapatan-helpers.test.ts`.

Rumus apa adanya: party = tonase × 1.000; total = party ÷ 1.000 × harga
(default 34.500); pajak = total × tarif% (0,5 / 2 / 0); net = total − pajak;
invoice `n/PT.IMR-<romawi>/<tahun>`; nomor BA `BA/IMR/<tahun>/<bulan>/<urut>`;
pendapatan → pencairan: nominal = total, pajak = pajak.

| Hal | Laravel | Di sini |
|---|---|---|
| Kaitan pendapatan ↔ kegiatan | nama kapal sebagai substring ("KM Sinar" cocok dengan "KM Sinar Jaya") | kolom `operasional_rekap_id`, unik; baris lama tanpa tautan diambil alih hanya bila namanya sama persis |
| Kapan sinkron berjalan | setiap kali halaman Pendapatan dibuka, dan saat Lengkapi Data disimpan | trigger saat kegiatan disimpan; tombol "Generate dari Kegiatan" untuk mengulang |
| Membuka halaman Pendapatan | menghapus baris yang dianggap duplikat (nama + tanggal) dan menomori ulang invoice | hanya membaca; penomoran ulang = tombol "Rapikan Nomor"; tidak ada hapus duplikat (tautan unik membuatnya tidak perlu) |
| Penomoran ulang | semua baris, termasuk yang sudah dibayar | invoice manual dan yang sudah dibayar tidak diganti |
| Ganti nomor invoice | pencairan dicari dengan nomor baru → pencairan lama terputus | nomor di pencairan ikut diganti |
| Sinkron kegiatan pada baris LUNAS | party dan total ditimpa | tidak disentuh |
| Tarif pajak 0% | dikembalikan ke 0,5% saat tonase berubah | dipertahankan |
| Kegiatan dipindah bulan | baris pendapatan tertinggal di bulan lama | ikut pindah, nomor urut berikutnya di bulan baru |
| "Belum terbayar" di cetak | hanya `payment_date` kosong (layar juga mengecualikan LUNAS) | aturan yang sama di layar dan cetak: tanpa tanggal bayar dan bukan LUNAS/PAID |
| Kop BA | nama PT, alamat, dan email tertulis tetap | nama legal entitas; alamat, email, dan logo "IMR" sama seperti Laravel (keputusan pemilik sistem, 12 Okt 2026) |
| Generate pertama di bulan kosong | nomor mulai 101 (`100 + count + 1`), lalu dinomori ulang saat halaman dibuka | mulai 1 |

"TOTAL KESELURUHAN PIUTANG" di cetak menjumlah **semua** invoice semua
periode, termasuk yang sudah lunas — dikonfirmasi pemilik sistem (12 Okt
2026) bahwa memang begitu maksudnya. Awalan invoice `PT.IMR` dan `BA/IMR`
tetap untuk semua entitas.

### Fase 4b — laporan lainnya, selesai 12 Oktober 2026

Tab **Laporan** (`/operasional/laporan`) memuat daftar laporan seperti
`laporan/index` Laravel, tanpa empat angka ringkasannya (salah satunya
"pendapatan" yang sebenarnya beban rekanan).

| Laporan | Rute | Cetak |
|---|---|---|
| Kumpulan Laporan Operasional & Laba Rugi (edit, simpan, reset) | `/operasional/laporan/kumpulan` | `/cetak/operasional/kumpulan` |
| Gaji Karyawan (honor telly, gaji admin bulanan) | `/operasional/laporan/gaji` | `/cetak/operasional/gaji` (slip) |
| Partner (pembayaran per pemilik truk) | `/operasional/laporan/partner` | `/cetak/operasional/partner` |
| Paguyuban | `/operasional/laporan/paguyuban` | — |
| Operasional (per kapal + per kegiatan) | `/operasional/laporan/operasional` | `/cetak/operasional/kegiatan` (juga dari Detail Kegiatan) |
| Keuangan (rincian truk + pengeluaran) | `/operasional/laporan/keuangan` | — |
| Catatan Karyawan | `/operasional/laporan/karyawan` | `/cetak/operasional/karyawan` |
| Pengeluaran | (layar Pengeluaran) | `/cetak/operasional/pengeluaran` |

Migrasi `20250116000000_laporan_gaji.sql` (`simpan_gaji_telly`,
`simpan_gaji_admin`); tes `tests/operasional-gaji.test.ts`,
`tests/kumpulan-helpers.test.ts`. Perbaikan PR #5 Laravel ikut: gaji admin
satu baris per bulan, dibuat saat disimpan, bulan dari `created_at`; bulan
tanpa gaji admin = nol.

Rumus Kumpulan apa adanya: hanya invoice lunas; kartu per kapal (pelayaran
kapal yang sama digabung); rekanan = saku supir kegiatan; terpal 50%; PBM 0;
pendapatan kartu = tagihan − pajak − rekanan − PBM − terpal 50% −
operasional; pengeluaran menurut kata di jenis (gaji / sewa / PPh sewa /
atensi-jalan / sisanya beban kantor).

| Hal | Laravel | Di sini |
|---|---|---|
| Gaji karyawan di Kumpulan | `max(telly+admin, pengeluaran gaji)`, lalu diganti `a + b` bila keduanya > 0 | `a + b` — hasilnya sama dalam semua kasus; `max()` tidak dipindah (aturan port) |
| Invoice ↔ kegiatan di Kumpulan | substring nama kapal, lalu urutan baris sebagai cadangan | tautan id; invoice tanpa tautan biayanya 0 dan disebut di layar |
| Ritase kosong di Kumpulan | ditaksir `ceil(muatan ÷ 30)` | 0 |
| Telly default kartu baru | "Pak Taufik" | kosong |
| Versi Kumpulan tersimpan | dihapus diam-diam setiap ada kegiatan bulan itu disimpan | bertahan sampai "Reset"; layar menyebut kapan disimpan |
| Membuka Laporan Gaji | membuat/menimpa baris honor dan tonase kegiatan | hanya membaca (barisnya dijaga `hitung_ulang_kegiatan`) |
| Ubah tonase dari form gaji | menimpa tonase kegiatan | tidak tersedia; tonase dari daftar truk |
| Paguyuban | hanya kapal yang punya `nama_paguyuban` — padahal tidak ada layar yang menyimpannya | grup "(Tanpa nama paguyuban)" supaya total cocok dengan iuran yang ditagih |
| Laporan Operasional | kolom "Pendapatan" dan "Laba" (beban dikurangi beban) | "Beban Rekanan" di antara biaya, tanpa kolom laba; honor telly dari baris per kegiatan |
| Laporan Keuangan | label "Bagian Rekanan" sudah benar | sama, ditambah kapal/nopol |

### Fase 5 — dasbor dan notifikasi, selesai 12 Oktober 2026

**Dasbor** `/operasional` (tab pertama; dulu mengalihkan ke Database General).
Tiga bagian sesuai rencana, masing-masing menautkan ke laporannya:

- **Pendapatan**: tagihan bruto, pajak, net, sudah/belum dibayar — dari
  Laporan Pendapatan.
- **Pengeluaran kotor**: beban rekanan, saku, terpal, biaya operasional
  kegiatan, paguyuban, honor telly, gaji admin, pengeluaran manual.
- **Pencairan**: jumlah dan nominal invoice, disetujui/pending/ditolak.

Ditambah kegiatan/truk/ritase/tonase, kapal-partner-telly teratas, dan
jumlah master data.

| Hal | Laravel | Di sini |
|---|---|---|
| "Pendapatan" | `sum(transaksi.pendapatan)` — pembayaran ke pemilik truk | tagihan dari Laporan Pendapatan; pembayaran truk masuk pengeluaran sebagai Beban Rekanan |
| "Laba Bersih" | pendapatan (beban) − biaya — beban dikurangi beban | "Selisih perkiraan: tagihan bruto − pajak − pengeluaran kotor", disebut perkiraan; laba rugi resmi di Laporan P&L |
| Honor telly | hanya baris per truk (tidak ada lagi yang membuatnya) | baris per kegiatan |
| Pencairan | difilter bulan saja | bulan dan tahun |

**Notifikasi kolaborasi**: layout Operasional menanyakan setiap 15 detik
(Laravel: 5 detik) apa yang diubah pengguna lain di entitas itu sejak halaman
dibuka, dan menampilkannya sebagai toast "Nama menambahkan/mengubah/menghapus
…". Sumbernya `audit_log` lewat `aktivitas_operasional()`
(`20250117000000_aktivitas_operasional.sql`): security definer, hanya
ringkasan (tanpa nilai lama/baru), hanya entitas yang boleh dibaca pemanggil,
tanpa aksi sendiri, 24 jam terakhir; satu simpanan (banyak baris dalam satu
transaksi) = satu notifikasi. Tes: `tests/operasional-aktivitas.test.ts`.
Halaman tidak dimuat ulang otomatis (isian yang belum disimpan bisa hilang);
toast menyarankan muat ulang. Laravel juga mewarnai baris yang baru diubah
orang lain di Database General — tidak dipindah.

**Catatan operasional.** Dua kali, uji pertama tepat setelah migrasi
diterapkan ke Neon menampilkan sebagian data kosong (sebagian query
mengembalikan nol baris tanpa galat), lalu normal pada muatan berikutnya.
Penyebabnya belum dipastikan; tidak tereproduksi di luar momen itu (diuji
berulang tepat setelah perubahan data). Bila setelah deploy migrasi sebuah
laporan tampak kosong, muat ulang sekali.

Seluruh fase penggabungan selesai.

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
- Perbaikan yang sudah dibuat di Laravel sesudah platform ini disalin
  (Lathif21/imr-operasional#5, Oktober 2026) **ikut di-port**, bukan logika
  lamanya. Port dari kode Laravel versi `main` *sesudah* PR itu di-merge:

  | Modul (fase) | Perilaku yang harus ada | Perilaku lama yang salah |
  |---|---|---|
  | Rekap / Pembayaran Truk (2, 4) | Iuran paguyuban = tonase × tarif (default 500) dihitung saat rincian truk disimpan; tarif tersimpan dipertahankan | hanya dihitung di form transaksi yang menyembunyikan tonase → selalu 0 |
  | Rekap: tambah/edit kegiatan (2) | Bulan Pengiriman mengikuti Tanggal Kegiatan | diam di bulan halaman → kegiatan bulan lalu tersimpan di bulan berjalan |
  | Laporan Gaji, admin (4) | satu baris gaji admin per bulan, difilter per bulan | satu baris untuk semua bulan |
  | Laporan keuangan (4) | bulan tanpa gaji admin = nol | fallback "jumlahkan seluruh riwayat" |
  | Pembayaran Truk / Detail Kegiatan (2, 4) | ada jalan ke form tambah kegiatan dari halaman yang menyuruh menambahnya | pesan menunjuk halaman tanpa tombol tambah |

  Pengujiannya ada di `tests/Feature/RincianTrukTest.php`,
  `GajiAdminTest.php`, dan `TambahKegiatanKapalTest.php` repo Laravel;
  bawa kasusnya ke tes platform.

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
| ~~Q-1~~ | ~~Apakah `admin_operasional` boleh membaca Laporan P&L?~~ **Dijawab 7 Okt: ya, baca saja** — `20250109000000_admin_operasional_baca_laporan.sql` | — |
| ~~Q-2~~ | ~~Apakah `direksi` boleh menulis data operasional?~~ **Dijawab 7 Okt: tidak** (P-6 dikonfirmasi: HRD = direksi, jadi direksi baca saja) | — |
| ~~Q-3~~ | ~~Manajer/auditor membaca data operasional?~~ **Dijawab 7 Okt: ya, baca saja** — `20250110000000_operasional_baca_dan_kunci_entitas.sql` | — |
| ~~Q-4~~ | ~~Neon project baru~~ **Selesai 7 Okt:** `neondb`, ap-southeast-1; Neon Auth + Data API aktif, migrasi diterapkan, 6 akun uji dibuat. Sisa: **matikan sign-up publik** di Console | — |
| ~~Q-5~~ | ~~Nama aplikasi~~ **Dijawab 7 Okt: "IMR Platform"** | — |
| ~~Q-6~~ | ~~Cegah referensi lintas entitas?~~ **Dijawab 7 Okt: ya, sekarang** — composite FK di migrasi yang sama | — |
| Q-7 | `transaksi_operasional.pendapatan` dan `kapal_muatan_detail.pendapatan_rekanan` menyimpan hasil hitung. Dihitung di view saja setelah port? | disimpan, seperti Laravel |
| Q-8 | Kapan cutover, dan apakah ada masa paralel (kedua sistem diisi) sebelumnya? | belum ditentukan |
