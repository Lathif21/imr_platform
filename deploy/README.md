# Deploy ke VPS

Seluruh portal — aplikasi, database, dan lampiran — berjalan di satu VPS
dengan Docker Compose.

```
internet ──► caddy :443 ──► app (SvelteKit/Node) ──► rest (PostgREST) ──► db (Postgres 18)
             HTTPS otomatis      │                                          ▲
                                 └──────── auth: sesi & akun (imr_auth) ────┘
                                 └──► volume berkas (lampiran)
```

- Hanya **Caddy** yang membuka port ke internet (80/443). PostgREST dan
  Postgres hanya ada di jaringan internal Docker; Postgres juga di
  `127.0.0.1:5432` VPS, untuk DBeaver lewat tunnel SSH.
- Setiap query data berjalan sebagai pengguna yang login (JWT → PostgREST →
  RLS). Aplikasi tidak memegang kunci yang bisa melewati RLS.
- Lampiran disimpan di volume `berkas` di disk VPS.

| File | Isi |
|---|---|
| `docker-compose.yml` | Semua layanan |
| `.env.example` | Rahasia yang harus diisi → salin ke `.env` |
| `Caddyfile` | HTTPS, kompresi, HSTS |
| `sql/platform.sql` | Role PostgREST + skema `auth` (pengganti Neon Auth) |
| `backup.sh` | Backup harian database + lampiran |
| `../scripts/migrate.ts` | Migrasi skema (setiap rilis) |
| `../scripts/pindah-dari-neon.ts` | Pindah data dari Neon (sekali, saat cutover) |
| `../scripts/buat-direksi.ts` | Akun direksi pertama (hanya instalasi baru) |

---

## 1. VPS

- **Ubuntu 24.04 LTS**, virtualisasi **KVM** (Docker tidak jalan di OpenVZ),
  dengan IPv4 publik.
- Setelan bawaan di sini untuk **1 core, 2 GB RAM, 40 GB SSD** (mis. VPS
  Rumahweb M) — cukup untuk ±10–20 pengguna. Saat berjalan, semua layanan
  memakai ±1 GB. Yang berat hanya **build** image (±1,5 GB), karena itu
  langkah 2 memasang swap.
- Lokasi **Jakarta atau Singapura**: setiap klik pengguna menempuh jarak
  browser ↔ VPS; di dalam VPS semuanya < 1 ms.
- Domain dengan **A record** ke IP VPS (mis. `portal.pt-anda.co.id`) sebelum
  langkah 3 — Caddy butuh itu untuk sertifikat.

## 2. Siapkan server (sekali)

Sebagai root, lewat SSH:

```sh
# Pengguna non-root untuk sehari-hari
adduser imr && usermod -aG sudo imr
rsync --archive --chown=imr:imr ~/.ssh /home/imr

# Login SSH hanya dengan kunci, root tidak boleh login
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: hanya SSH dan web
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Patch keamanan otomatis
apt update && apt install -y unattended-upgrades fail2ban git
dpkg-reconfigure -plow unattended-upgrades

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker imr

# Swap 2 GB — tanpa ini build image (npm ci + vite) bisa dibunuh OOM di RAM 2 GB
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system >/dev/null
```

`vm.swappiness=10`: swap hanya dipakai saat RAM benar-benar habis (build),
bukan saat melayani pengguna. Cek dengan `free -h`.

> Docker menulis aturan iptables sendiri dan **melewati ufw** untuk port yang
> dipublikasikan. Karena itu compose ini hanya mempublikasikan 80/443 (Caddy)
> dan `127.0.0.1:5432` — jangan ubah port Postgres menjadi `5432:5432`.

Keluar, lalu SSH lagi sebagai `imr`.

## 3. Pasang

```sh
sudo mkdir -p /opt/imr && sudo chown imr:imr /opt/imr
git clone <url-repo> /opt/imr && cd /opt/imr/deploy
chmod +x backup.sh

cp .env.example .env && chmod 600 .env
nano .env        # isi DOMAIN, ACME_EMAIL, dan setiap rahasia dengan: openssl rand -hex 32
```

```sh
docker compose up -d db rest             # database dulu
docker compose build migrate             # image alat (migrasi, skrip) — ±5–10 menit di 1 core
docker compose run --rm migrate          # skema
```

Lanjut ke **4a** (instalasi baru) atau **4b** (pindah dari Neon), lalu:

```sh
docker compose up -d --build             # app + caddy
docker compose ps                        # semua "Up", app "healthy"
```

Buka `https://<DOMAIN>`. Sertifikat HTTPS terbit otomatis dalam ±1 menit.

## 4a. Instalasi baru (tanpa data lama)

```sh
docker compose run --rm migrate --bootstrap      # 4 entitas + tautan sistem operasional
docker compose run --rm akun --email direksi@pt-anda.co.id --nama "Nama Direksi"
```

Kata sandi sementara tercetak **sekali**. Login, lalu buat akun lain di
**Admin → Pengguna**.

## 4b. Pindah dari Neon (cutover)

Neon hanya **dibaca**. Sisi VPS berjalan dalam satu transaksi: semua tersalin
dan jumlah baris setiap tabel cocok dengan Neon, atau tidak ada yang tersimpan.

1. **Bekukan penulisan** di portal lama: umumkan jam cutover, minta semua
   berhenti menginput. Data yang ditulis ke Neon setelah langkah 2 tidak ikut.
2. Salin data — memakai connection string **langsung** (bukan `-pooler`) dari
   Neon Console:
   ```sh
   docker compose run --rm -e NEON_DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pindah
   ```
   Hasil yang benar diakhiri `ok  31 tabel cocok jumlahnya dengan Neon`.
   Akun ikut pindah **dengan kata sandi lamanya** (format hash Neon Auth
   dipakai apa adanya). Skrip boleh diulang; setiap kali ia mengosongkan
   database VPS dulu.
3. Salin lampiran dari Neon Object Storage ke volume `berkas` (kunci dari
   Neon Console → Object storage):
   ```sh
   docker run --rm -v imr_berkas:/data \
     -e AWS_ACCESS_KEY_ID=… -e AWS_SECRET_ACCESS_KEY=… -e AWS_DEFAULT_REGION=ap-southeast-1 \
     -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
     amazon/aws-cli s3 sync s3://uploads /data --endpoint-url https://<endpoint>.storage…neon.tech
   docker run --rm -v imr_berkas:/data alpine chown -R 1000:1000 /data
   ```
   Kunci objeknya sama dengan yang tercatat di database, jadi tidak ada yang
   perlu dipetakan ulang.
4. `docker compose up -d --build`, login dengan akun lama, buka satu laporan
   P&L dan satu lampiran.
5. Arahkan DNS domain lama ke VPS (atau beri tahu alamat baru). Biarkan Neon
   hidup ±2 minggu sebagai cadangan, lalu matikan.

## 5. Merilis versi baru

```sh
cd /opt/imr && git pull
cd deploy
docker compose build app migrate
docker compose run --rm migrate          # migrasi baru saja yang diterapkan
docker compose up -d                     # app diganti; db, rest, caddy tetap
docker image prune -f                    # buang image lama — disk 40 GB
```

Build berjalan sementara app lama tetap melayani; yang terasa hanya sedikit
lebih lambat selama beberapa menit. Rilis di luar jam kerja kalau bisa.

Migrasi dulu, baru app: kode baru boleh mengandalkan kolom/fungsi baru.
`migrate` juga memberi tahu PostgREST untuk membaca ulang skemanya.

## 6. Backup

```sh
crontab -e
15 1 * * * /opt/imr/deploy/backup.sh >> /home/imr/backup.log 2>&1
```

Setiap malam: `backups/imr-<tanggal>.dump` (database) dan
`backups/berkas-<tanggal>.tar.gz` (lampiran), disimpan 14 hari.

**Backup di disk yang sama bukan backup.** Salin folder `backups/` ke luar
VPS — misalnya `rclone sync /opt/imr/deploy/backups gdrive:imr-backup` di cron
yang sama, atau aktifkan snapshot harian dari penyedia VPS. Uji pemulihan
sekali, ke VPS lain, sebelum Anda membutuhkannya:

```sh
docker compose exec -T db pg_restore -U postgres -d imr --clean --if-exists < backups/imr-<tanggal>.dump
docker run --rm -v imr_berkas:/data -v "$PWD/backups":/b alpine tar -xzf /b/berkas-<tanggal>.tar.gz -C /data
```

## 7. Melihat database (DBeaver)

Postgres tidak terbuka ke internet. Pakai tab **SSH** di koneksi DBeaver:
host VPS, user `imr`, kunci SSH; lalu di tab **Main**: host `127.0.0.1`,
port `5432`, database `imr`, user `postgres`, password `POSTGRES_PASSWORD`.
Aturan main di `docs/DATABASE.md` tetap berlaku — superuser melewati RLS.

## 8. Sehari-hari

| Perlu | Perintah |
|---|---|
| Log aplikasi | `docker compose logs -f app` |
| Query lambat (> 500 ms) | `docker compose logs db \| grep duration` |
| Restart satu layanan | `docker compose restart app` |
| Status | `docker compose ps` |
| Ruang disk | `df -h` dan `docker system df` — log container sudah dibatasi 30 MB per layanan |
| Memori | `free -h` dan `docker stats --no-stream` |

## 9. Kalau ada masalah

| Gejala | Penyebab biasa |
|---|---|
| Form menolak dengan *Cross-site POST form submissions are forbidden* | Membuka lewat alamat selain `https://<DOMAIN>`. `ORIGIN` dikunci ke domain itu |
| *Fitur ini memerlukan pembaruan database* | `docker compose run --rm migrate` belum dijalankan untuk rilis ini |
| Tautan lampiran *kedaluwarsa* tepat setelah rilis | `JWT_SECRET` diganti; tautan berlaku 2–10 menit, buka ulang dari halamannya. Sesi login tidak terpengaruh |
| Login gagal terus untuk semua orang | `IMR_AUTH_PASSWORD` di `.env` berubah tanpa `migrate` dijalankan ulang |
| Caddy tidak mendapat sertifikat | DNS belum mengarah ke VPS, atau port 80 tertutup |
| *Terlalu banyak percobaan masuk* | 5 gagal per email / 30 per IP dalam 15 menit; tunggu, atau `delete from auth.login_failures where email = '…'` |

## Catatan keamanan

- `.env` berisi semua rahasia: `chmod 600`, jangan pernah di-commit.
- Mengganti `AUTHENTICATOR_PASSWORD` atau `IMR_AUTH_PASSWORD`: ubah `.env`,
  `docker compose run --rm migrate`, lalu `docker compose up -d`.
- Header keamanan (HSTS, anti-framing, nosniff, no-store untuk halaman
  berisi angka) dipasang oleh Caddy dan `src/hooks.server.ts`.
- PostgREST tidak terekspos dan peta skemanya (OpenAPI) dimatikan.
