# Panduan Deployment DocuCraft PDF Editor

DocuCraft adalah aplikasi web modern untuk mengedit PDF, mengatur halaman, membubuhkan anotasi/tanda tangan, dan scan OCR. Panduan ini menjelaskan cara menjalankan dan mendeploy DocuCraft ke berbagai lingkungan produksi.

---

## 🚀 Pilihan Deployment

| Metode | Rekomendasi Untuk | Kemudahan |
|---|---|---|
| **Metode 1: Docker Compose** | Server VPS / VM (Docker) | ⭐⭐⭐⭐⭐ (1 Perintah) |
| **Metode 2: Single Container** | Railway, Render, Fly.io, Google Cloud Run | ⭐⭐⭐⭐⭐ (PaaS) |
| **Metode 3: VPS Langsung** | Ubuntu 22.04 / 24.04 (Systemd + Nginx) | ⭐⭐⭐⭐ (Native) |
| **Metode 4: Local Development** | Pengembangan Lokal (Mac / Linux / Windows) | ⭐⭐⭐⭐⭐ (Dev) |

---

## 🐳 Metode 1: Docker Compose (Rekomendasi)

Menjalankan backend FastAPI (dengan Tesseract OCR + PyMuPDF) dan frontend Next.js 14 secara terisolasi dan otomatis.

### Langkah-langkah:
1. Pastikan Docker dan Docker Compose telah terpasang.
2. Clone atau masuk ke direktori proyek:
   ```bash
   cd AcroLite
   ```
3. Jalankan container:
   ```bash
   docker compose up --build -d
   ```
4. Buka browser:
   - **Frontend Web App**: `http://localhost:3000`
   - **Backend API Docs**: `http://localhost:8000/docs`

Untuk menghentikan:
```bash
docker compose down
```

---

## ☁️ Metode 2: Single-Container Deployment (Railway, Render, Fly.io, Cloud Run)

Jika platform hosting Anda hanya mengizinkan 1 container/port (misalnya Railway, Render Web Service, atau Fly.io), gunakan `Dockerfile.all-in-one`.

### Di Railway / Render:
1. Buat **New Web Service** dari repositori Git Anda.
2. Atur **Dockerfile Path** ke:
   ```
   Dockerfile.all-in-one
   ```
3. Port akan otomatis dideteksi dari variabel `$PORT` (default 3000).
4. Klik **Deploy**!

### Deploy dengan Fly.io:
```bash
fly launch --dockerfile Dockerfile.all-in-one
fly deploy
```

---

## 🖥️ Metode 3: VPS Ubuntu Server (Native + Nginx)

### 1. Install System Dependencies:
```bash
sudo apt update && sudo apt install -y python3-pip python3-venv tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind poppler-utils nginx curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Setup Backend:
```bash
cd /var/www/docucraft/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Buat Systemd Service Backend (`/etc/systemd/system/docucraft-backend.service`):
```ini
[Unit]
Description=DocuCraft Backend FastAPI
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/docucraft/backend
ExecStart=/var/www/docucraft/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```
Aktifkan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now docucraft-backend
```

### 3. Setup Frontend:
```bash
cd /var/www/docucraft
npm ci
npm run build
```

Buat Systemd Service Frontend (`/etc/systemd/system/docucraft-frontend.service`):
```ini
[Unit]
Description=DocuCraft Frontend Next.js
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/docucraft
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=BACKEND_INTERNAL_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node /var/www/docucraft/.next/standalone/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```
Aktifkan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now docucraft-frontend
```

### 4. Konfigurasi Nginx (`/etc/nginx/sites-available/docucraft`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Aktifkan dan restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/docucraft /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 💻 Metode 4: Local Development

### 1. Jalankan Backend:
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

### 2. Jalankan Frontend:
```bash
npm run dev
```

Buka `http://localhost:3000`.

---

## ⚙️ Variabel Lingkungan (.env)

| Variabel | Default | Keterangan |
|---|---|---|
| `BACKEND_INTERNAL_URL` | `http://127.0.0.1:8000` | URL internal backend untuk proxy Next.js |
| `NEXT_PUBLIC_API_URL` | *(kosong)* | Kosongkan untuk menggunakan proxy otomatis Next.js |
| `CORS_ORIGINS` | `*` | Daftar origin yang diizinkan untuk akses backend |
| `PORT` | `3000` | Port frontend Next.js |

---

## 🔍 Health Check API

- **Backend Health**: `GET /health` atau `GET /api/pdf/health`
- **Frontend Health**: `GET /api/health`
