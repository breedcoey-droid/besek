/**
 * Tampilan web panel Fanpage Automator — Netlify.
 * Port renderPage + loginPage dari worker.js versi Cloudflare,
 * dengan penyesuaian teks: Cloudflare Worker -> Netlify, KV/R2 -> Blobs,
 * workers.dev -> netlify.app, wrangler secret put -> netlify env:set.
 */

import {
  esc, maskedToken, wibParts, DEFAULT_TEMPLATE,
  loadLog, listGallery, r2Key, bridgeUrl, pickNextLink, activeAccount,
} from "./logic.mjs";

export const CSS = `
body{background:#f1f5f9;color:#0f172a;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0}
.wrap{display:flex;min-height:100vh}
.side{width:210px;background:#0b1220;color:#e2e8f0;padding:16px 12px;flex-shrink:0}
.side h1{font-size:17px;margin:4px 0 2px}
.side .sub{font-size:12px;color:#94a3b8;margin-bottom:18px}
.side a{display:block;color:#cbd5e1;text-decoration:none;padding:9px 12px;border-radius:9px;margin:3px 0;font-size:14px}
.side a.on{background:#2563eb;color:#fff;font-weight:700}
.side a:hover{background:#1e293b}
.main{flex:1;padding:16px 20px;max-width:980px}
.topbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;margin-bottom:12px}
.topbar .cron{font-size:13px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:6px 10px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
h2{margin:2px 0 8px;font-size:19px} h3{margin:14px 0 6px;font-size:15px}
.muted{color:#64748b;font-size:13px} .small{font-size:12px;color:#64748b}
input,select,textarea{width:100%;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;box-sizing:border-box;margin:4px 0;font-size:14px}
input[type=checkbox],input[type=radio]{width:auto}
button{background:#2563eb;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:700;cursor:pointer;margin:4px 4px 4px 0;font-size:14px}
button.green{background:#16a34a} button.orange{background:#ea580c} button.ghost{background:#e2e8f0;color:#0f172a} button.danger{background:#dc2626}
button:disabled{opacity:.5;cursor:default}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.slot{border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;background:#f8fafc}
.slot .num{display:inline-block;background:#2563eb;color:#fff;border-radius:50%;width:26px;height:26px;line-height:26px;text-align:center;font-weight:800;margin-right:6px}
.slot .nm{font-weight:700}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
.thumbs figure{margin:0;position:relative}
.thumbs img{width:110px;height:110px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;display:block}
.thumbs figcaption{font-size:11px;color:#475569;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thumbs .del{position:absolute;top:2px;right:2px;background:#dc2626;color:#fff;border:0;border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer}
.banner{border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:14px}
.banner.info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
.banner.error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.toast{background:#dcfce7;border:1px solid #86efac;color:#166534;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px}
.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:7px 6px;text-align:left;vertical-align:top}
code{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:1px 6px;font-size:12px}
pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:12px;font-size:13px}
.preview{display:flex;gap:14px;align-items:flex-start}
.preview img{width:200px;height:200px;object-fit:cover;border-radius:10px;border:1px solid #cbd5e1}
.kv{font-size:13px}
`;

function nextScheduleText(settings, nowMs) {
  const { dateStr, hm } = wibParts(nowMs);
  const cands = (settings.schedule || []).filter((h) => /^\d{2}:\d{2}$/.test(h)).sort();
  if (!cands.length) return "-";
  const future = cands.filter((h) => h >= hm);
  if (future.length) return future[0] + " (WIB)";
  return cands[0] + " (WIB, besok)";
}

export function loginPage(msg) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk — Fanpage Automator</title><style>${CSS}</style></head><body>
<div class="main" style="max-width:420px;margin:60px auto">
<div class="card"><h2>Fanpage Automator</h2>
<p class="muted">Panel ini dikunci. Masukkan kata sandi admin (env var <code>ADMIN_PASSWORD</code>).</p>
${msg ? `<div class="banner error">${esc(msg)}</div>` : ""}
<form method="post" action="/login">
<label>Kata sandi admin<input type="password" name="password" autocomplete="current-password"></label>
<button>Masuk</button></form></div></div></body></html>`;
}

export async function renderPage(env, settings, linksObj, tab, msg, host) {
  const nowMs = Date.now();
  const log = await loadLog(env);
  const nxtSlot = pickNextLink(settings, linksObj);
  const nxtTxt = nxtSlot ? `link ${nxtSlot.n} — ${esc(nxtSlot.nama)}` : "belum ada link aktif";
  const banner = settings.banner || "";
  const bannerKind = settings.banner_kind || "info";
  const preview = settings.preview;
  const bulk = settings.bulk_result;
  const account = activeAccount(settings);
  const locked = !!env.ADMIN_PASSWORD;
  const aiReady = !!env.GEMINI_API_KEY;
  const fbReady = !!(env.FB_APP_ID && env.FB_APP_SECRET);

  const tabs = [["akun", "Akun"], ["konten", "Konten"], ["posting", "Posting"], ["log", "Log"]];
  const side = tabs.map(([t, label]) =>
    `<a href="/?tab=${t}" class="${t === tab ? "on" : ""}">${label}</a>`).join("");

  let body = "";
  if (!locked) {
    body += `<div class="warn"><b>Panel belum dikunci.</b> Siapa pun yang menemukan alamat situs ini bisa membuka panel dan melihat token Page kamu. Sangat dianjurkan: set env var <code>ADMIN_PASSWORD</code> di dashboard Netlify (Site settings → Environment variables) lalu deploy ulang.</div>`;
  }
  if (banner) {
    body += `<div class="banner ${bannerKind}">${esc(banner)} <form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="tutup_banner"><input type="hidden" name="tab" value="${esc(tab)}"><button class="ghost" style="padding:4px 10px">Tutup</button></form></div>`;
  }
  if (msg) body += `<div class="toast">${esc(msg)}</div>`;

  /* ----- TAB AKUN ----- */
  if (tab === "akun") {
    const rows = (settings.accounts || []).map((a) => `
<tr><td><b>${esc(a.name)}</b><br><span class="small">Page ID: <code>${esc(a.page_id)}</code></span></td>
<td>${a.id === settings.active_account ? "<b>Aktif</b>" : ""}</td>
<td><span class="small">${esc(maskedToken(a.token))}</span></td>
<td>
<form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="pilih_akun"><input type="hidden" name="id" value="${esc(a.id)}"><button class="ghost" style="padding:4px 10px">Jadikan aktif</button></form>
<form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="hapus_akun"><input type="hidden" name="id" value="${esc(a.id)}"><button class="danger" style="padding:4px 10px">Hapus</button></form>
</td></tr>`).join("") || `<tr><td colspan="4">Belum ada akun. Hubungkan Page Facebook di bawah, atau isi token manual.</td></tr>`;

    body += `
<div class="card"><h2>Akun — Facebook Page (multi-akun)</h2>
<p class="muted">Satu akun aktif dipakai untuk posting. Token tersimpan di Blobs milikmu
sendiri dan tidak pernah dicatat ke log. Akun aktif saat ini:
<b>${account ? esc(account.name) + " (" + esc(account.page_id) + ")" : "belum ada"}</b>.</p>
<table><tr><th>Page</th><th>Status</th><th>Token</th><th></th></tr>${rows}</table>
${fbReady
  ? `<a href="/auth/login"><button class="green" type="button">Hubungkan Page Facebook</button></a>
     <span class="small">Login sekali via Facebook, Page + token tersimpan otomatis (token berlaku ~60 hari, hubungkan ulang bila kedaluwarsa).</span>`
  : `<div class="warn"><b>Facebook Login belum disiapkan.</b> Env var <code>FB_APP_ID</code> / <code>FB_APP_SECRET</code> belum diset.
     Isi token manual di bawah, atau ikuti README bagian "Hubungkan Page Facebook" untuk membuat Facebook App.</div>`}
</div>
<div class="card"><h3>Tambah akun (token manual)</h3>
<form method="post" action="/action">
<input type="hidden" name="aksi" value="tambah_akun">
<label>Nama tampilan<input name="nama" placeholder="mis. Toko Gamis Murah"></label>
<label>Page ID<input name="page_id" placeholder="mis. 100083715903899"></label>
<label>Page Access Token<input type="password" name="token" placeholder="EAAB..." autocomplete="off"></label>
<p class="small"><b>Jangan bagikan token ini ke siapa pun.</b> Token didapat dari aplikasi
Facebook yang kamu buat sendiri di developers.facebook.com (izin <code>pages_manage_posts</code>),
atau lewat Graph API Explorer. Token Page berlaku ~60 hari.</p>
<button>Simpan Akun</button></form></div>
<div class="card"><h3>Pengaturan posting</h3>
<form method="post" action="/action">
<input type="hidden" name="aksi" value="simpan_pengaturan">
<label>Domain publik situs ini (tanpa https://) — dipakai untuk link jembatan &amp; gambar di postingan
<input name="domain" value="${esc(settings.domain || "")}" placeholder="mis. fanpage.domainmu.com"></label>
<p class="small">Opsional — kosongkan bila memakai alamat netlify.app gratis: panel otomatis
memakai alamat itu untuk link jembatan &amp; gambar. Isi hanya bila kamu memasang
domain sendiri (lihat README).</p>
<label>Mode Posting</label><br>
<label><input type="radio" name="mode" value="manual" ${settings.mode === "manual" ? "checked" : ""}> Manual (siapkan saja) — bawaan, aman</label><br>
<label><input type="radio" name="mode" value="api" ${settings.mode === "api" ? "checked" : ""}> API Graph (otomatis, butuh token akun aktif)</label>
<label style="margin-top:10px">Mode Gambar</label><br>
<label><input type="radio" name="image_mode" value="single" ${settings.image_mode !== "album" ? "checked" : ""}> 1 gambar (gambar pertama galeri)</label><br>
<label><input type="radio" name="image_mode" value="album" ${settings.image_mode === "album" ? "checked" : ""}> Album (semua gambar galeri, satu postingan multi-foto)</label>
<p class="small">Mode Manual tidak pernah mengirim apa pun ke Facebook. Mode API Graph baru
mengirim request saat jadwal jatuh tempo / Bulk Post dan token terisi (maks 1x per jadwal, tanpa retry).</p>
<button>Simpan Pengaturan</button></form></div>`;
  }

  /* ----- TAB KONTEN ----- */
  else if (tab === "konten") {
    const slots = [];
    for (const s of linksObj.links) {
      const n = s.n;
      const imgs = await listGallery(env, n);
      const gal = s.galeri || "umum";
      slots.push(`
<div class="slot"><span class="num">${n}</span><span class="nm">Link ${n}</span>
<div class="grid2">
<label>Nama (judul kartu)<input name="nama_${n}" value="${esc(s.nama)}" placeholder="mis. Jas Hujan Gamis Wanita"></label>
<label>URL tujuan<input name="url_${n}" value="${esc(s.url)}" placeholder="https://shopee.co.id/... atau https://s.shopee.co.id/..."></label>
</div>
<label>Galeri
<select name="galeri_${n}">
<option value="umum" ${gal === "umum" ? "selected" : ""}>Ikut galeri umum</option>
<option value="sendiri" ${gal === "sendiri" ? "selected" : ""}>Galeri sendiri</option>
</select></label>
<p class="small">Galeri sendiri: ${imgs.length} gambar &nbsp;|&nbsp; Link jembatan: <code>${esc(bridgeUrl(settings, host, n))}</code></p>
</div>`);
    }
    body += `
<div class="card"><h2>Konten — Link tujuan (maks 10, digilir)</h2>
<p class="muted">Link diberi nomor dan dipakai bergiliran (1, 2, 3, lalu ulang).
Nama dipakai sebagai judul kartu. Tiap link bisa punya galeri gambar sendiri,
atau ikut galeri umum. Giliran berikutnya saat ini: <b>${nxtTxt}</b>.</p>
<div class="warn"><b>Data contoh:</b> link 1 dan 2 di bawah ini berisi placeholder
<code>https://shopee.co.id/CONTOH-PRODUK-1</code> — <b>ganti dengan link affiliate
kamu</b> dari dashboard Shopee Affiliate sebelum dipakai posting.</div>
<form method="post" action="/action">
<input type="hidden" name="aksi" value="simpan_konten">${slots.join("")}
<button>Simpan Konten</button></form></div>`;

    body += `<div class="card"><h3>Upload gambar per link</h3>
<p class="muted">Pilih banyak gambar sekaligus (JPG/PNG/GIF/WebP, maks 10 MB per file).
Gambar tersimpan di Blobs (<code>images/link/&lt;nomor&gt;/</code>) dan bisa dibuka publik lewat <code>/img/...</code>.</p>`;
    for (const s of linksObj.links) {
      const n = s.n;
      const imgs = await listGallery(env, n);
      const thumbs = imgs.map((im) => {
        const key = r2Key(n, im);
        return `<figure><img src="/img/${esc(key)}" alt=""><figcaption>${esc(im)}</figcaption>
<form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="hapus_gambar"><input type="hidden" name="slot" value="${n}"><input type="hidden" name="file" value="${esc(im)}"><button class="del" title="Hapus gambar ini">&times;</button></form></figure>`;
      }).join("");
      body += `
<div class="slot"><span class="num">${n}</span><span class="nm">${esc(s.nama || `Link ${n}`)}</span>
<span class="small"> — ${imgs.length} gambar</span>
<div class="thumbs">${thumbs || '<span class="small">Belum ada gambar.</span>'}</div>
<form method="post" action="/action" enctype="multipart/form-data">
<input type="hidden" name="aksi" value="upload"><input type="hidden" name="slot" value="${n}">
<input type="file" name="files" multiple accept="image/*">
<button class="green">Upload ke Link ${n}</button></form></div>`;
    }
    body += `</div>`;

    const uimgs = await listGallery(env, "umum");
    const uthumbs = uimgs.map((im) => {
      const key = r2Key("umum", im);
      return `<figure><img src="/img/${esc(key)}" alt=""><figcaption>${esc(im)}</figcaption>
<form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="hapus_gambar"><input type="hidden" name="slot" value="umum"><input type="hidden" name="file" value="${esc(im)}"><button class="del" title="Hapus gambar ini">&times;</button></form></figure>`;
    }).join("");
    body += `
<div class="card"><h3>Galeri umum (gambar bersama)</h3>
<p class="muted">Dipakai oleh semua link yang galerinya diset "Ikut galeri umum".
Tersimpan di Blobs (<code>images/umum/</code>). Jumlah: <b>${uimgs.length} gambar</b>.</p>
<div class="thumbs">${uthumbs || '<span class="small">Belum ada gambar.</span>'}</div>
<form method="post" action="/action" enctype="multipart/form-data">
<input type="hidden" name="aksi" value="upload"><input type="hidden" name="slot" value="umum">
<input type="file" name="files" multiple accept="image/*">
<button class="green">Upload ke Galeri Umum</button></form></div>`;
  }

  /* ----- TAB POSTING ----- */
  else if (tab === "posting") {
    const sched = settings.schedule || [];
    const schedRows = sched.map((h) => `<tr><td><b>${esc(h)}</b> WIB</td><td>
<form method="post" action="/action" style="display:inline"><input type="hidden" name="aksi" value="hapus_jam"><input type="hidden" name="jam" value="${esc(h)}"><button class="danger" style="padding:4px 10px">Hapus</button></form></td></tr>`).join("")
      || '<tr><td colspan="2">Belum ada jam jadwal.</td></tr>';
    const auto = !!settings.auto;
    body += `
<div class="card"><h2>Posting — Jadwal</h2>
<p class="muted">Scheduled Function Netlify memeriksa tiap 5 menit. Bila AUTO aktif dan ada jadwal yang
jatuh tempo, postingan disiapkan (giliran maju) dan — bila mode API Graph — diterbitkan
sekali. Mode Manual tidak pernah memposting otomatis.</p>
<form method="post" action="/action" style="display:inline">
<input type="hidden" name="aksi" value="set_auto"><input type="hidden" name="auto" value="${auto ? "0" : "1"}">
<button class="${auto ? "orange" : "green"}">${auto ? "Matikan AUTO (jadi Mode manual)" : "Aktifkan AUTO"}</button></form>
<span class="small">Status saat ini: <b>${auto ? "AUTO aktif" : "Mode manual"}</b> &nbsp;|&nbsp;
Mode posting: <b>${esc(settings.mode)}</b> &nbsp;|&nbsp; Gambar: <b>${settings.image_mode === "album" ? "Album" : "1 gambar"}</b> &nbsp;|&nbsp;
Akun aktif: <b>${account ? esc(account.name) : "belum ada"}</b></span>
<table><tr><th>Jam posting (WIB)</th><th></th></tr>${schedRows}</table>
<form method="post" action="/action" style="margin-top:8px">
<input type="hidden" name="aksi" value="tambah_jam">
<label>Tambah jam (HH:MM)<input name="jam" placeholder="19:00" style="width:130px"></label>
<button>Tambah Jam</button></form>
<p class="small">Cron berjalan di Netlify 24/7 selama situs ter-deploy di production — tidak perlu
komputer menyala. Satu jadwal hanya dieksekusi 1x. (Cron tidak jalan di Deploy Preview.)</p></div>

<div class="card"><h3>Template caption</h3>
<p class="muted">Placeholder: <code>{nama}</code> = nama link, <code>{link}</code> = link jembatan.
Satu link per postingan. Label <code>#affiliate</code> sudah termasuk di template bawaan.</p>
<form method="post" action="/action">
<input type="hidden" name="aksi" value="simpan_template">
<textarea name="template" rows="4">${esc(settings.caption_template || DEFAULT_TEMPLATE)}</textarea>
<button>Simpan Template</button></form></div>

<div class="card"><h3>Siapkan Postingan Berikutnya</h3>
<p class="muted">Giliran berikutnya saat ini: <b>${nxtTxt}</b>. Menyiapkan postingan akan
memajukan giliran ke link aktif selanjutnya.</p>
<form method="post" action="/action" style="display:inline">
<input type="hidden" name="aksi" value="siapkan">
<button class="green">Siapkan Postingan Berikutnya</button></form>
<a href="https://www.facebook.com/" target="_blank" rel="noopener"><button class="ghost" type="button">Buka Facebook</button></a>
<form method="post" action="/action" style="display:inline;margin-left:8px">
<input type="hidden" name="aksi" value="bulk">
<label style="display:inline">Bulk Post (jumlah <input name="jumlah" value="3" style="width:60px;display:inline"> postingan, 1–10)</label>
<button class="orange">Jalankan Bulk Post</button></form>
<p class="small">Bulk Post menyiapkan N postingan berikutnya dari antrian giliran sekaligus.
Bila mode API Graph, tiap postingan langsung diterbitkan (gagal di satu postingan tidak
menghentikan sisanya). Bila mode Manual, semuanya hanya disiapkan dan hasilnya tampil di bawah.
Satu pemanggilan function dibatasi 30 detik: bila waktu habis, hasilnya dilaporkan parsial
dan sisanya bisa dilanjutkan dengan menjalankan Bulk Post lagi.</p>
</div>`;
    if (bulk) {
      const bRows = (bulk.results || []).map((r) => `<tr><td>${r.link_n ? `Link ${r.link_n}` : "-"}</td><td>${esc(r.nama || "")}</td><td>${r.ok ? "<b>Berhasil</b>" + (r.postId ? ` (post id: ${esc(r.postId)})` : "") : `<b>Gagal</b>: ${esc(r.error || "")}`}</td></tr>`).join("");
      body += `<div class="card"><h3>Hasil Bulk Post Terakhir (${esc(bulk.waktu || "")})</h3>
<p class="muted">${bulk.sukses} berhasil, ${bulk.gagal} gagal, dari ${bulk.total} postingan${bulk.parsial ? ` — <b>parsial, ${bulk.sisa} belum dicoba</b> (batas waktu 25 detik). Jalankan Bulk Post lagi untuk melanjutkan.` : "."}</p>
<table><tr><th>Link</th><th>Nama</th><th>Hasil</th></tr>${bRows}</table></div>`;
    }
    if (preview) {
      const pimgs = preview.images || [];
      const firstKey = pimgs.length
        ? (preview.galeri.startsWith("sendiri") ? r2Key(preview.link_n, pimgs[0]) : r2Key("umum", pimgs[0]))
        : "";
      const first = firstKey
        ? `<img src="/img/${esc(firstKey)}" alt="">`
        : '<div class="small" style="width:200px;height:200px;border:1px dashed #cbd5e1;border-radius:10px;display:flex;align-items:center;justify-content:center">Tidak ada gambar</div>';
      body += `
<div class="card"><h3>Pratinjau Postingan</h3>
<div class="preview">${first}
<div style="flex:1">
<p class="kv"><b>Link ${preview.link_n}</b> — ${esc(preview.nama)}<br>
Galeri: ${esc(preview.galeri)} (${pimgs.length} gambar)<br>
Link jembatan: <code>${esc(preview.bridge)}</code><br>
Tujuan: <code>${esc(preview.url)}</code><br>
Disiapkan: ${esc(preview.waktu || "")}</p>
<label>Caption</label>
<textarea id="capTxt" rows="4">${esc(preview.caption)}</textarea>
<button onclick="salin('capTxt')">Salin Caption</button>
<button onclick="tulisAI()">Tulis Ulang Caption dengan AI ${aiReady ? "" : "(belum aktif)"}</button>
<button onclick="salin('bridgeTxt')">Salin Link Jembatan</button>
<input id="bridgeTxt" value="${esc(preview.bridge)}" readonly style="position:absolute;left:-9999px">
<a href="/export-redirect/${preview.link_n}"><button type="button">Ekspor HTML Redirect (Link ${preview.link_n})</button></a>
<p class="small" id="aiNote">${aiReady ? "AI memakai Gemini (env var GEMINI_API_KEY sudah diset)." : "AI belum aktif: env var GEMINI_API_KEY belum diset — tombol AI akan memakai template biasa."}</p>
</div></div></div>`;
    } else {
      body += `<div class="card"><h3>Pratinjau Postingan</h3>
<p class="muted">Belum ada postingan yang disiapkan. Klik "Siapkan Postingan Berikutnya".</p></div>`;
    }
    body += `
<div class="card"><h3>Halaman jembatan — sudah publik lewat alamat situs ini</h3>
<p class="muted">Setiap link punya alamat jembatan <code>https://&lt;alamat-situs&gt;/go/&lt;nomor&gt;</code>
yang mengalihkan (HTTP 302) ke URL tujuan dan mencatat klik ke log. Karena situs ini
jalan di alamat netlify.app kamu (atau domain sendiri bila dipasang), link jembatan sudah
bisa diklik siapa pun — tidak seperti versi lokal (localhost). Tombol "Ekspor HTML Redirect"
tetap tersedia bila kamu mau memakai halaman jembatan di hosting lain.</p></div>`;
  }

  /* ----- TAB LOG ----- */
  else {
    const rows = (log.entries || []).slice().reverse().map((e) =>
      `<tr><td>${esc(e.waktu || "")}</td><td><b>${esc(e.jenis || "")}</b></td><td>${esc(e.pesan || "")}</td></tr>`).join("")
      || '<tr><td colspan="3">Log masih kosong.</td></tr>';
    body += `
<div class="card"><h2>Log</h2>
<p class="muted">Dicatat: simpan konten, siapkan postingan, klik jembatan,
jadwal jatuh tempo, hasil auto-posting/bulk, dan error upload. Token tidak pernah dicatat.
Maks 200 entri terakhir.</p>
<form method="post" action="/action" style="display:inline">
<input type="hidden" name="aksi" value="bersihkan_log">
<button class="danger">Bersihkan Log</button></form>
<table><tr><th>Waktu (WIB)</th><th>Jenis</th><th>Pesan</th></tr>${rows}</table></div>`;
  }

  const cronNote = settings.auto
    ? `Cron aktif (jadwal: ${(settings.schedule || []).join(", ") || "-"}). Posting berikutnya: ${nextScheduleText(settings, nowMs)}. [AUTO aktif]`
    : `Cron aktif. Posting berikutnya: ${nextScheduleText(settings, nowMs)}. [Mode manual]`;

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fanpage Automator — Netlify</title><style>${CSS}</style></head><body>
<div class="wrap">
<div class="side"><h1>Fanpage Automator</h1><div class="sub">Netlify Functions &middot; 24/7</div>${side}
<p class="small" style="color:#64748b;margin-top:24px">Data tersimpan di Blobs milikmu di Netlify. Tidak ada data yang dikirim ke server luar selain graph.facebook.com dan generativelanguage.googleapis.com.</p>
<p class="small" style="color:#64748b"><a href="/logout" style="color:#94a3b8">Keluar</a></p></div>
<div class="main">
<div class="topbar"><b>Fanpage Automator</b>
<span class="cron">${esc(cronNote)}</span></div>
${body}
</div></div>
<div id="toast" style="display:none;position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#166534;color:#fff;padding:10px 18px;border-radius:10px;font-weight:700;z-index:99"></div>
<script>
function toast(m){var el=document.getElementById('toast');el.textContent=m;el.style.display='block';setTimeout(function(){el.style.display='none'},3000)}
function salin(id){var t=document.getElementById(id);if(!t)return;var v=t.value||t.textContent;
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(function(){toast('Disalin!')},function(){fb()})}else{fb()}
function fb(){try{t.select();document.execCommand('copy');toast('Disalin!')}catch(e){toast('Gagal menyalin, salin manual.')}}}
async function tulisAI(){
var t=document.getElementById('capTxt');var n=document.getElementById('aiNote');
if(n)n.textContent='Menulis caption dengan AI...';
try{
var r=await fetch('/api/caption-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
var j=await r.json();
if(j&&j.caption){t.value=j.caption}
if(n)n.textContent=j.note||'';
toast(j&&j.ai?'Caption ditulis ulang oleh AI.':'AI tidak tersedia, memakai template.');
}catch(e){if(n)n.textContent='AI gagal: '+e.message}}
</script>
</body></html>`;
}
