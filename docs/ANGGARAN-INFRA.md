# Anggaran Infrastruktur — Deployment Produksi

Estimasi biaya memindahkan IMR dari demo Vercel ke lingkungan produksi.

- Disusun 2 September 2026
- Kurs asumsi Rp16.800/USD
- Seluruh angka adalah perkiraan, bukan penawaran resmi

## Ringkasan

| Pos | Perkiraan |
| --- | --- |
| Sekali bayar (setup, migrasi, hardening) | Rp7–17 jt |
| Infrastruktur per bulan | ~Rp500 rb |
| Pemeliharaan per bulan (jasa) | Rp1,5–4 jt |
| **Total tahun pertama** | **Rp31–71 jt** |

Rentangnya lebar karena pos jasa belum ditentukan penanggungnya. Lihat
bagian "Yang belum diputuskan".

## Koreksi asumsi awal

Asumsi "database pakai Postgres lokal lalu diupload ke VPS" tidak cukup.

Aplikasi ini tidak pernah berbicara langsung ke Postgres:

- Setiap query lewat **PostgREST** (`@supabase/ssr` di seluruh `+page.server.ts`)
- Login dan sesi ditangani **GoTrue** (`hooks.server.ts`)

Kalau hanya databasenya yang diangkat ke VPS, aplikasi tidak jalan sama
sekali. Yang perlu dijalankan adalah stack Supabase self-hosted: Postgres,
GoTrue, PostgREST, dan API gateway. Ini yang menentukan ukuran server, dan
karenanya menentukan seluruh angka di dokumen ini.

Kabar baiknya aplikasi ini ramping: tidak memakai Realtime, tidak memakai
Storage, dan `xlsx` hanya dipakai script import offline — bukan di server.
Ketiganya bisa dimatikan, sehingga kebutuhan memori turun jauh dibanding
instalasi Supabase penuh.

## Yang berjalan di server

Memori adalah perkiraan pemakaian tenang, bukan puncak.

| Komponen | Fungsi | Memori | Status |
| --- | --- | ---: | --- |
| PostgreSQL | Database, 10 tabel, seluruh aturan RLS | ~1 GB | Wajib |
| GoTrue | Login, sesi, JWT | ~64 MB | Wajib |
| PostgREST | Seluruh query aplikasi | ~80 MB | Wajib |
| Kong | Gateway API, penerapan kunci | ~250 MB | Wajib |
| Node (SvelteKit) | Aplikasi itu sendiri, `adapter-node` | ~200 MB | Wajib |
| Caddy | TLS dan reverse proxy | ~40 MB | Wajib |
| Storage, Realtime, Studio | Tidak dipakai aplikasi ini | — | Dimatikan |
| **Total** | Termasuk ruang lonjakan dan OS | **~4 GB** | |

## Opsi server

Ketiganya berspesifikasi setara: 2 vCPU, 4 GB RAM, 80 GB SSD. Yang berbeda
adalah lokasi, dan lokasi menentukan latensi bagi pengguna di Indonesia.

| Lokasi | Penyedia | Per bulan | Latensi | Catatan |
| --- | --- | ---: | --- | --- |
| Eropa | Hetzner, Contabo | Rp70 rb | 150–200 ms | Terasa lambat di setiap klik. Perlu kartu kredit, tanpa faktur PPN |
| **Singapura** | DigitalOcean, Vultr, Linode | **Rp400 rb** | 20–40 ms | **Rekomendasi.** Terasa seperti lokal, ekosistem paling matang |
| Indonesia | Biznet Gio, IDCloudHost | Rp350–600 rb | Terbaik | Faktur PPN, dukungan lokal, data di dalam negeri |

Untuk data keuangan perusahaan, opsi Indonesia layak dipertimbangkan meski
sedikit lebih mahal — bukan karena kewajiban hukum, tapi karena faktur PPN
dan dukungan lokal umumnya lebih mudah dipertanggungjawabkan secara
administratif.

## Biaya sekali bayar

| Pos | Isi pekerjaan | Perkiraan |
| --- | --- | ---: |
| Setup server | Provisioning, hardening SSH dan firewall, Docker, stack Supabase self-hosted, TLS otomatis. Termasuk mematikan Storage, Realtime, dan Studio | Rp4–8 jt |
| Deploy aplikasi | Ganti ke `adapter-node`, reverse proxy, service systemd, pipeline deploy. Perubahan kodenya kecil, sisanya konfigurasi | Rp1–3 jt |
| Backup otomatis | Dump terjadwal ke object storage, aturan retensi, dan uji restore | Rp1–2 jt |
| Migrasi data | Import data ILJ lewat `scripts/import-ilj.ts` dan verifikasi angka | Rp1–4 jt |
| **Total** | | **Rp7–17 jt** |

Catatan: backup yang belum pernah diuji restore belum bisa disebut backup.
Biaya uji restore sudah termasuk di baris ketiga dan sebaiknya tidak dipotong.

## Biaya berulang

Memakai opsi server Singapura. Domain ditampilkan per bulan agar sebanding.

| Pos | Keterangan | Per bulan | Per tahun |
| --- | --- | ---: | ---: |
| VPS | 2 vCPU, 4 GB, Singapura | Rp400 rb | Rp4,8 jt |
| Object storage | Backup harian, retensi 30 hari. Cloudflare R2 gratis sampai 10 GB — database ini kemungkinan besar masih masuk | Rp0–85 rb | Rp0–1 jt |
| Domain | `.com` Rp180 rb/thn atau `.co.id` Rp250 rb/thn | Rp15–21 rb | Rp180–250 rb |
| Sertifikat TLS | Otomatis via Caddy | Rp0 | Rp0 |
| SMTP | Untuk reset password mandiri. Paket gratis Resend 3.000 email/bulan | Rp0 | Rp0 |
| Monitoring uptime | UptimeRobot atau sejenisnya, paket gratis | Rp0 | Rp0 |
| **Subtotal infrastruktur** | | **~Rp500 rb** | **~Rp6 jt** |
| Pemeliharaan | Patching OS dan Supabase, pantau backup, uji restore berkala, penanganan insiden | Rp1,5–4 jt | Rp18–48 jt |
| **Total berulang** | | **Rp2–4,5 jt** | **Rp24–54 jt** |

## Alternatif tanpa VPS

| Pendekatan | Infra/bln | Jasa/bln | Setup | Konsekuensi |
| --- | ---: | ---: | ---: | --- |
| VPS self-hosted | Rp500 rb | Rp1,5–4 jt | Rp7–17 jt | Kendali penuh atas data. Patching, backup, dan pemulihan jadi tanggung jawab sendiri |
| Terkelola (Supabase Pro + Vercel) | Rp420 rb | Rp0–1 jt | Rp1–3 jt | Backup harian, patching, dan pemulihan ditangani penyedia. Data di infrastruktur pihak ketiga |

**Biaya infrastrukturnya nyaris sama.** Yang membedakan secara material
adalah jasa: opsi VPS menuntut seseorang yang siap turun tangan saat server
bermasalah, dan biaya itu berulang setiap bulan selama sistem hidup. Dalam
setahun selisihnya bisa mencapai Rp20–40 juta.

Self-hosting tetap masuk akal bila ada syarat data harus berada di server
milik sendiri, atau bila sudah ada tim yang memang mengelola server lain. Di
luar dua kondisi itu, opsi terkelola biasanya lebih murah secara total.

## Yang belum diputuskan

Empat hal ini mengubah angka secara signifikan.

1. **Siapa yang menanggung pos jasa?** Kalau dikerjakan sendiri sebagai
   bagian dari pekerjaan, seluruh baris jasa menjadi nol dan total tahun
   pertama tinggal sekitar Rp6 juta. Kalau ini penawaran ke klien, justru
   pos inilah nilai utamanya.

2. **Perlu lingkungan staging?** Server kedua untuk uji coba sebelum masuk
   produksi, menambah sekitar Rp200 rb/bulan dengan spesifikasi lebih kecil.
   Untuk sistem yang memegang angka keuangan, biasanya sepadan.

3. **Berapa lama data harus disimpan?** Retensi backup 30 hari sudah masuk
   perhitungan. Kalau audit menuntut penyimpanan bertahun-tahun, biaya object
   storage naik — tetap kecil, kemungkinan masih di bawah Rp100 rb/bulan.

4. **Berapa pengguna dan entitas yang direncanakan?** Spesifikasi 4 GB nyaman
   untuk puluhan pengguna aktif. Kalau berkembang menjadi ratusan pengguna
   atau puluhan entitas, server perlu dinaikkan dengan biaya kira-kira dua
   kali lipat per kelipatan kapasitas.

## Catatan

Harga VPS dan domain berubah cukup sering, dan kurs Rp16.800/USD hanyalah
asumsi. Verifikasi ulang saat pembelian.

Rentang biaya jasa sengaja dibuat lebar karena sangat bergantung pada siapa
yang mengerjakan dan seberapa dalam cakupannya. Untuk anggaran yang lebih
presisi, mintalah penawaran tertulis dari satu atau dua penyedia.

Satu pos tidak tercantum karena tidak bisa dianggarkan: waktu sendiri.
Self-hosting Supabase berarti akan ada malam-malam ketika sesuatu rusak dan
hanya Anda yang bisa memperbaikinya.
