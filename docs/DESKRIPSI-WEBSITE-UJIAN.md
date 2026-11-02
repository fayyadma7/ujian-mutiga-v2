# UJIAN MUTIGA — Exam Intelligence Platform
### Sistem CBT SMK Muhammadiyah 3 Purbalingga

> Platform ujian digital terintegrasi untuk siswa dan guru

---

## 1. Deskripsi Website

**Ujian Mutiga** adalah Sistem **Computer-Based Test (CBT)** untuk SMK Muhammadiyah 3 Purbalingga yang bisa diakses lewat link berikut: 
mutigaexam.vercel.app

---

## 2. Fitur Sisi Siswa

1.  **Login Cepat Tanpa Password** — cukup Nama + Kelas + Mapel. Cocok untuk HP spek rendah dan jaringan sekolah.
2.  **Timer Real-Time + Auto-Submit** — hitung mundur durasi, peringatan waktu habis, otomatis kumpulkan via RPC `koreksi`.
3.  **Navigasi Soal Modern** — grid nomor soal, status sudah/belum/ragu-ragu, lompat soal 1-klik.
4.  **5 Tipe Soal:**
    - Pilihan Ganda (PG)
    - PG Kompleks (jawaban lebih dari satu)
    - Menjodohkan
    - Isian Singkat
    - Essay / Uraian
5.  **Acak Soal & Acak Opsi** — setiap siswa dapat urutan berbeda (anti-contek), dikonfigurasi per jadwal.
6.  **Autosave & Tahan Refresh** — jawaban PG + Essay tersimpan berkala ke `jawaban_ujian`. Refresh / HP mati tidak menghilangkan jawaban. Koreksi N+1 dioptimasi jadi 1 RPC.
7.  **Anti-Cheat Aktif:**
    - Blokir seleksi teks (`user-select: none`), klik kanan, dan print.
    - Deteksi pindah tab / minimize / ganti aplikasi → counter `pelanggaran` + `log_pelanggaran` berstempel waktu.
    - Status akhir `PELANGGARAN` tampil merah di dashboard guru.
8.  **Skor Instan & Transparan** — PG dikoreksi otomatis server (kunci tidak pernah dikirim ke browser — anti-bocor), Essay dinilai manual guru.

---

## 3. Fitur Sisi Admin / Guru

### A. Exam Control Center & Dashboard
- Landing **EXAM CONTROL CENTER PANEL** dengan live telemetry (sedang ujian / selesai / pelanggaran).
- Kartu statistik dan daftar selesai terbaru.

### B. Live Monitoring
- Tabel live campuran semua kelas: nama, status `AKTIF / SELESAI / PELANGGARAN`, sisa waktu, jumlah pelanggaran.
- Aksi 1-klik: **lihat detail pelanggaran, reset sesi, hapus sesi, paksa selesaikan**.

### C. AI Generator
- **Fitur unggulan #1.** Buat soal otomatis dari topik + tempel modul/referensi
- Generate PG + Essay sekaligus sesuai fase & level kesulitan.
- Bisa juga generate **Kisi-kisi soal**.

### D. Analisis Butir Soal (`admin-analisis.js`)
- **Fitur unggulan #2.** Daya serap per siswa, ketuntasan, **tingkat kesukaran nyata**.
- Klik baris soal → lihat distribusi jawaban siswa untuk evaluasi pengecoh.

---

## 4. ⭐ 7 Fitur Unggulan (Kenapa Beda dari CBT Lain)

1.  **🤖 AI Multi-Provider Anti-Gagal** — Guru tempel modul → jadi 20 soal siap pakai dalam <30 detik.
2.  **📡 Live Monitoring**
3.  **🛡️ Anti-Cheat** catat *kapan & jenis* pelanggaran yang bisa diklik guru sebagai bukti.
4. **📝 Import Word/Excel Super Cepat** — migrasi bank soal lama (Word guru) tinggal drag-drop, rumus otomatis rapi.
5.  **⚡ Super Ringan & Hemat Kuota**

---


> Dibangun untuk kebutuhan nyata SMK Muhammadiyah 3 Purbalingga: ujian harian, PTS, PAS, dan event — cepat di HP spek rendah, aman dari contekan, dan memangkas 90% waktu pembuatan soal guru.
