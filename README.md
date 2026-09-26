# DocuCraft - Production PDF Editor

DocuCraft adalah aplikasi web modern dan lengkap untuk manipulasi dan pengeditan PDF yang terinspirasi dari Adobe Acrobat Pro.

Dibuat dengan arsitektur **Next.js 14 App Router (Frontend)** dan **FastAPI + PyMuPDF (Backend)**, aplikasi ini siap digunakan (*ready-to-use*) dan siap dideploy (*production-ready*) dengan Docker atau layanan cloud.

---

## 🌟 Fitur Utama

### 1. In-Place Text Editing (Edit Teks Langsung)
- Klik pada teks asli mana saja di dokumen PDF untuk mengeditnya secara instan.
- Atur ukuran font (*font size*) dan warna teks (*preset colors*).
- Tambahkan teks baru (*Add Text Mode*) langsung pada koordinat yang diklik.
- Teks diperbarui secara *real-time* di canvas tanpa perlu refresh browser.

### 2. Page Organizer (Manajemen Halaman)
- Tampilan thumbnail visual seluruh halaman PDF.
- **Drag-and-Drop Reordering**: Geser urutan halaman dengan mudah.
- **Rotasi Halaman**: Putar 90°, 180°, atau 270° per halaman atau secara massal.
- **Hapus Halaman**: Pilih satu atau banyak halaman untuk dihapus.
- **Tambah Halaman Kosong**: Tambahkan halaman baru (*blank page*) di posisi mana saja.

### 3. Anotasi & Tanda Tangan Digital
- **Draw / Pen Tool**: Gambar bebas menggunakan mouse atau touchscreen.
- **Digital Signature**: Modal khusus tanda tangan dengan kanvas responsif, undo, dan pembersihan.
- **Text Box Anotasi**: Letakkan kotak teks mengambang, dapat diedit dan dipindahkan.
- **Highlight**: Sorot teks atau area dokumen dengan transparansi warna.
- **Sticky Note**: Sisipkan catatan/komentar interaktif.
- **Stempel (Stamp)**: Stempel siap pakai (APPROVED, DRAFT, CONFIDENTIAL, REVIEWED, VOID).
- **Ekspor Beranotasi**: Burn seluruh anotasi secara permanen ke dalam format PDF vector standar.

### 4. OCR Scanner (Tesseract)
- Deteksi otomatis halaman pindaian/gambar yang tidak memiliki teks searchable.
- Ekstraksi teks berbasis Tesseract OCR per halaman atau seluruh dokumen.
- Fitur salin teks ke clipboard (*Copy to Clipboard*) dan jumlah kata terdeteksi.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 14 (App Router, Standalone build), React 18, Tailwind CSS, PDF.js, Lucide Icons
- **Backend**: Python 3.11+, FastAPI, PyMuPDF (Fitz), Pytesseract, Pillow, Uvicorn
- **DevOps**: Docker, Docker Compose, Standalone Multi-stage Builds

---

## 🚀 Cara Menjalankan

### Cara 1: Menggunakan Docker Compose (Paling Mudah)
```bash
docker compose up --build -d
```
Akses aplikasi:
- **Web App**: [http://localhost:3000](http://localhost:3000)
- **API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

### Cara 2: Menjalankan Secara Manual (Lokal)

#### 1. Backend (FastAPI):
```bash
cd backend

# Aktifkan virtual environment
python -m venv venv
source venv/bin/activate  # di Windows: venv\Scripts\activate

# Install dependensi
pip install -r requirements.txt

# Jalankan server
uvicorn main:app --reload --port 8000
```

#### 2. Frontend (Next.js):
```bash
# Di root folder AcroLite
npm install
npm run dev
```
Buka browser di [http://localhost:3000](http://localhost:3000).

---

## 🧪 Menjalankan Tes Integrasi Backend

Telah disediakan suite tes otomatis komprehensif:
```bash
cd backend
source venv/bin/activate
python test_api.py
```
Hasil: **12/12 Integration Tests Passed (100%)**.

---

## 📦 Panduan Deployment Lengkap

Lihat panduan [DEPLOYMENT.md](file:///Volumes/work/_Projects/AcroLite/DEPLOYMENT.md) untuk detail deployment ke:
- Docker Compose (VPS / Dedicated Server)
- Single-Container PaaS (Railway, Render, Fly.io, Google Cloud Run) menggunakan `Dockerfile.all-in-one`
- Server Ubuntu Native dengan Nginx dan Systemd
