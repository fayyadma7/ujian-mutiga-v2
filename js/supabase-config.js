// ============================================================
// supabase-config.js — SATU-SATUNYA sumber URL/key Supabase.
// Muat file ini SEBELUM js/admin-db.js, admin-core.js, dan
// SEBELUM script inline index.html (lihat <head>).
//
// CARA GANTI DATABASE (link ujian TIDAK berubah):
//   1. Ubah 1 baris ACTIVE_DB di bawah: 'harian' <-> 'event'
//   2. Redeploy folder statis yang sama. Siswa tetap buka link lama.
//
// Profil 'event' diisi saat project Supabase EVENT sudah dibuat
// (anon key + URL baru). Selama masih kosong, JANGAN set
// ACTIVE_DB = 'event'.
// ============================================================
/* global window */
(function () {
    var PROFILES = {
        harian: {
            label: 'HARIAN',
            url: 'https://bkecjfrwqocguyvjymkn.supabase.co',
            key: 'sb_publishable_4sQqxzUTiVhuf2h4SZCqNA_txpH0J8C'
        },
        event: {
            label: 'EVENT',
            url: '', // TODO: isi URL project EVENT (mis. https://xxxx.supabase.co)
            key: ''  // TODO: isi anon key project EVENT
        }
    };

    // === FLAG PERIODE — UBAH DI SINI SAAT GANTI DB ===
    // 'harian' = ulangan harian (default), 'event' = UTS/UAS.
    var ACTIVE_DB = 'harian';

    // Override darurat tanpa redeploy (konsol browser admin):
    //   localStorage.setItem('db_override', 'event'); location.reload();
    // Kosongkan untuk kembali ikut ACTIVE_DB:
    //   localStorage.removeItem('db_override'); location.reload();
    var override = null;
    try { override = window.localStorage ? window.localStorage.getItem('db_override') : null; } catch (e) {}
    var activeName = (override === 'harian' || override === 'event') ? override : ACTIVE_DB;
    var profile = PROFILES[activeName] || PROFILES.harian;

    if (activeName === 'event' && (!profile.url || !profile.key)) {
        try { console.error('[supabase-config] ACTIVE_DB=event tapi profil event kosong — fallback ke harian.'); } catch (e) {}
        activeName = 'harian';
        profile = PROFILES.harian;
    }

    profile.proxyUrl = profile.url + '/functions/v1/admin-proxy';

    try {
        window.SUPABASE_PROFILES = PROFILES;
        window.ACTIVE_DB_NAME = activeName;
        window.SUPABASE_PROFILE = profile;
        window.SUPABASE_URL = profile.url;
        window.SUPABASE_KEY = profile.key;
    } catch (e) {}
})();
