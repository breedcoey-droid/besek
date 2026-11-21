/**
 * Logika inti Fanpage Automator — Netlify.
 * =======================================
 * Port dari worker.js versi Cloudflare (logika dipertahankan, hanya lapisan
 * penyimpanan yang diganti KV/R2 -> Netlify Blobs lewat env dari
 * lib/store.mjs). Fungsi-fungsi di sini tidak tahu soal HTTP routing;
 * routing ada di lib/router.mjs, tampilan ada di lib/panel.mjs.
 */

import { randomUUID } from "./store.mjs";

export const MAX_LINKS = 10;
export const MAX_LOG = 200;
export const MAX_FILE = 10 * 1024 * 1024; // 10 MB per gambar
export const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
export const GRAPH_VERSION = "v21.0";
export const WIB_OFFSET_MS = 7 * 3600 * 1000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // state OAuth 10 menit
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // sesi panel 7 hari

export const DEFAULT_TEMPLATE =
  "{nama}, desainnya keren!\n" +
  "Jangan sampai terlewat! Klik gambar untuk melihat detailnya ✨\n" +
  "#affiliate";

export const DEFAULT_LINKS = {
  links: [
    { n: 1, nama: "CONTOH — Jas Hujan Gamis Wanita",
      url: "https://shopee.co.id/CONTOH-PRODUK-1", galeri: "sendiri" },
    { n: 2, nama: "CONTOH — Jas Hujan Anak Pria dan Wanita",
      url: "https://shopee.co.id/CONTOH-PRODUK-2", galeri: "umum" },
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ n, nama: "", url: "", galeri: "umum" })),
  ],
};

export const DEFAULT_SETTINGS = {
  accounts: [],            // [{ id, name, page_id, token }]
  active_account: "",      // id akun aktif
  domain: "",              // domain publik, mis. "fanpage.domainmu.com" (tanpa https://) — opsional
  auto_host: "",           // host situs yang terdeteksi otomatis saat panel dibuka (mis. xxx.netlify.app) — alamat gratis bila domain kosong
  mode: "manual",          // "manual" | "api"
  image_mode: "single",    // "single" (1 gambar) | "album" (semua gambar galeri)
  auto: false,
  schedule: ["19:00"],     // daftar jam HH:MM (WIB)
  caption_template: DEFAULT_TEMPLATE,
  next_link: 1,
  last_fired: "",          // "YYYY-MM-DD HH:MM" jadwal terakhir yang dieksekusi
  last_tick: "",
  preview: null,           // postingan terakhir yang disiapkan
  bulk_result: null,       // hasil Bulk Post terakhir
  banner: "",
  banner_kind: "info",     // "info" | "error"
};

/* ---------------- util umum ---------------- */

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function safeFilename(name) {
  const base = String(name || "gambar").split(/[\\/]/).pop();
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return clean || "gambar";
}

export function extOf(name) {
  const i = String(name).lastIndexOf(".");
  return i >= 0 ? String(name).slice(i).toLowerCase() : "";
}

export function maskedToken(tok) {
  tok = (tok || "").trim();
  if (!tok) return "(belum diisi)";
  if (tok.length <= 8) return "••••••••";
  return tok.slice(0, 4) + "••••" + tok.slice(-4) + " (tersimpan, isi ulang untuk mengganti)";
}

/** Waktu WIB dari epoch-ms. Kembalikan { dateStr: "YYYY-MM-DD", hm: "HH:MM", full: "YYYY-MM-DD HH:MM:SS" }. */
export function wibParts(nowMs) {
  const d = new Date(nowMs + WIB_OFFSET_MS);
  const iso = d.toISOString(); // UTC dari tanggal yang sudah digeser = WIB
  return { dateStr: iso.slice(0, 10), hm: iso.slice(11, 16), full: iso.slice(0, 19).replace("T", " ") };
}

/** Epoch-ms dari tanggal+jam WIB ("YYYY-MM-DD", "HH:MM"). */
export function wibToMs(dateStr, hm) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - WIB_OFFSET_MS;
}

export function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------- penyimpanan (Blobs via env) ---------------- */

async function kvGetJson(env, key, fallback) {
  try {
    const v = await env.LINKS_KV.get(key, "json");
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

async function kvPutJson(env, key, obj) {
  await env.LINKS_KV.put(key, JSON.stringify(obj));
}

export async function loadLinks(env) {
  const d = await kvGetJson(env, "links", null);
  if (!d || !Array.isArray(d.links)) {
    const fresh = clone(DEFAULT_LINKS);
    await kvPutJson(env, "links", fresh);
    return fresh;
  }
  const slots = {};
  for (const s of d.links) if (s && s.n) slots[Number(s.n)] = s;
  const out = [];
  for (let i = 1; i <= MAX_LINKS; i++) {
    const s = slots[i] || {};
    out.push({
      n: i,
      nama: String(s.nama || ""),
      url: String(s.url || ""),
      galeri: s.galeri === "sendiri" ? "sendiri" : "umum",
    });
  }
  return { links: out };
}

export async function loadSettings(env) {
  const d = await kvGetJson(env, "settings", null);
  const merged = { ...clone(DEFAULT_SETTINGS), ...(d && typeof d === "object" ? d : {}) };
  if (!Array.isArray(merged.accounts)) merged.accounts = [];
  if (!Array.isArray(merged.schedule)) merged.schedule = ["19:00"];
  return merged;
}

export async function saveSettings(env, s) { await kvPutJson(env, "settings", s); }

export async function loadLog(env) {
  const d = await kvGetJson(env, "log", null);
  if (!d || !Array.isArray(d.entries)) return { entries: [] };
  return d;
}

export async function addLog(env, jenis, pesan) {
  try {
    const d = await loadLog(env);
    d.entries.push({ waktu: wibParts(Date.now()).full, jenis, pesan: String(pesan).slice(0, 500) });
    d.entries = d.entries.slice(-MAX_LOG);
    await kvPutJson(env, "log", d);
  } catch (e) {
    console.log("[log gagal]", e);
  }
  console.log(`[${jenis}] ${pesan}`);
}

export function activeLinks(linksObj) {
  return linksObj.links.filter((s) => s.nama.trim() && s.url.trim());
}

export function galleryKey(n) { return n === "umum" ? "gallery:umum" : `gallery:${Number(n)}`; }

export async function listGallery(env, n) {
  const arr = await kvGetJson(env, galleryKey(n), null);
  return Array.isArray(arr) ? arr : [];
}

export async function saveGallery(env, n, arr) {
  await kvPutJson(env, galleryKey(n), arr);
}

/** Kunci gambar: "link/<n>/<file>" atau "umum/<file>" (di Blobs jadi "images/<kunci>"). */
export function r2Key(n, filename) {
  return n === "umum" ? `umum/${filename}` : `link/${Number(n)}/${filename}`;
}

/* ---------------- caption & rotasi ---------------- */

export function renderCaption(template, nama, link) {
  return (template || DEFAULT_TEMPLATE).replaceAll("{nama}", nama).replaceAll("{link}", link);
}

export function pickNextLink(settings, linksObj) {
  const act = activeLinks(linksObj);
  if (!act.length) return null;
  const nxt = Number(settings.next_link || 1);
  const after = act.filter((s) => s.n >= nxt);
  return after[0] || act[0];
}

export function advanceRotation(settings, linksObj, usedN) {
  const act = activeLinks(linksObj);
  if (!act.length) return;
  const after = act.filter((s) => s.n > usedN);
  settings.next_link = after.length ? after[0].n : act[0].n;
}

/** Galeri yang dipakai slot ini + daftar nama file (fallback ke umum bila kosong). */
export async function galleryFor(env, slot) {
  if (slot.galeri === "sendiri") {
    const own = await listGallery(env, slot.n);
    if (own.length) return { galeri: "sendiri", images: own };
    return { galeri: "umum (galeri sendiri kosong, fallback)", images: await listGallery(env, "umum") };
  }
  return { galeri: "umum", images: await listGallery(env, "umum") };
}

/** URL publik halaman jembatan & gambar (pakai domain yang diset, atau host request).
 *  Bila keduanya kosong (mis. dari cron tanpa domain), pakai placeholder yang
 *  terlihat jelas salah supaya tidak ada link rusak yang terkirim diam-diam. */
export function bridgeUrl(settings, host, n) {
  const h = (settings.domain || "").trim() || host || "ISI-DOMAIN-DI-PANEL";
  return `https://${h}/go/${n}`;
}
export function imageUrl(settings, host, key) {
  const h = (settings.domain || "").trim() || host || "ISI-DOMAIN-DI-PANEL";
  return `https://${h}/img/${key}`;
}

/**
 * Siapkan postingan berikutnya: pilih link giliran, hitung galeri + caption
 * + link jembatan. Memajukan penanda giliran dan menyimpan pratinjau.
 * Kembalikan { preview } atau { error }.
 */
export async function preparePost(env, settings, linksObj, host) {
  const slot = pickNextLink(settings, linksObj);
  if (!slot) return { error: "Tidak ada link aktif. Isi dulu minimal 1 slot di tab Konten (Nama + URL tujuan)." };
  const { galeri, images } = await galleryFor(env, slot);
  const bridge = bridgeUrl(settings, host, slot.n);
  const caption = renderCaption(settings.caption_template, slot.nama, bridge);
  const preview = {
    link_n: slot.n, nama: slot.nama, url: slot.url,
    galeri, images, bridge, caption,
    waktu: wibParts(Date.now()).full,
  };
  advanceRotation(settings, linksObj, slot.n);
  settings.preview = preview;
  await saveSettings(env, settings);
  await addLog(env, "siapkan",
    `Postingan disiapkan: link ${slot.n} "${slot.nama}" (galeri: ${galeri}, ${images.length} gambar). Giliran berikutnya: link ${settings.next_link}.`);
  return { preview };
}

/* ---------------- halaman jembatan (HTML ekspor) ---------------- */

export function bridgeHtml(nama, target) {
  const t = esc(target);
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${t}">
<title>Mengalihkan…</title></head>
<body><p>Mengalihkan ke ${esc(nama)}…
<a href="${t}">Klik di sini bila tidak otomatis dialihkan</a>.</p>
<script>location.replace("${t}");</script></body></html>
`;
}

/* ---------------- auto-posting Graph API ---------------- */

export function activeAccount(settings) {
  const acc = (settings.accounts || []).find((a) => a.id === settings.active_account)
    || (settings.accounts || [])[0] || null;
  return acc;
}

async function graphPostForm(url, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, String(v));
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  let j = {};
  try { j = await r.json(); } catch { /* abaikan */ }
  if (!r.ok || j.error) {
    const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, data: j };
}

/** Mode "1 gambar": link post (caption + link jembatan + picture gambar pertama). */
async function publishSingle(env, settings, account, preview, host) {
  const params = {
    message: preview.caption,
    link: preview.bridge,
    access_token: account.token,
  };
  if (preview.images && preview.images.length) {
    const key = preview.galeri.startsWith("sendiri")
      ? r2Key(preview.link_n, preview.images[0])
      : r2Key("umum", preview.images[0]);
    params.picture = imageUrl(settings, host, key);
  }
  const res = await graphPostForm(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(account.page_id)}/feed`, params);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, postId: res.data.id || "" };
}

/** Mode "Album": upload tiap gambar (published=false) lalu feed + attached_media. */
async function publishAlbum(env, settings, account, preview, host) {
  const keys = (preview.images || []).map((f) =>
    preview.galeri.startsWith("sendiri") ? r2Key(preview.link_n, f) : r2Key("umum", f));
  if (!keys.length) return { ok: false, error: "Tidak ada gambar di galeri untuk mode Album." };
  const ids = [];
  for (const key of keys) {
    const obj = await env.IMAGES.get(key);
    if (!obj) continue;
    const form = new FormData();
    form.append("published", "false");
    form.append("access_token", account.token);
    form.append("source",
      new Blob([await obj.arrayBuffer()], { type: obj.httpMetadata?.contentType || "image/jpeg" }),
      key.split("/").pop());
    let r, j = {};
    try {
      r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(account.page_id)}/photos`,
        { method: "POST", body: form });
      j = await r.json();
    } catch (e) {
      return { ok: false, error: `Gagal upload foto ${key}: ${e.message}` };
    }
    if (!r.ok || !j.id) {
      return { ok: false, error: (j.error && j.error.message) || `Upload foto gagal (HTTP ${r.status})` };
    }
    ids.push(j.id);
  }
  if (!ids.length) return { ok: false, error: "Semua upload foto gagal / tidak ada gambar di Blobs." };
  const res = await graphPostForm(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(account.page_id)}/feed`,
    {
      message: preview.caption,
      link: preview.bridge,
      attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
      access_token: account.token,
    });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, postId: res.data.id || "", photos: ids.length };
}

/** Terbitkan satu preview sesuai image_mode. Kembalikan { ok, postId?, error? }. */
export async function publishPost(env, settings, account, preview, host) {
  if (!account || !account.page_id || !account.token) {
    return { ok: false, error: "Akun aktif / Page Access Token belum diisi di tab Akun." };
  }
  if (settings.image_mode === "album") return publishAlbum(env, settings, account, preview, host);
  return publishSingle(env, settings, account, preview, host);
}

/* ---------------- caption AI (Gemini) ---------------- */

export async function captionAI(env, { nama, url, gaya }) {
  const template = renderCaption(null, nama, url);
  if (!env.GEMINI_API_KEY) {
    return { caption: template, ai: false, note: "AI tidak tersedia (env var GEMINI_API_KEY belum diset) — memakai template." };
  }
  const prompt =
    `Tulis caption jualan singkat dalam Bahasa Indonesia untuk produk bernama "${nama}".\n` +
    `Syarat: tepat 2 kalimat. Kalimat pertama memuji produknya. Kalimat kedua ajakan bertindak ` +
    `"klik gambar untuk melihat detailnya". Baris terakhir tulis "#affiliate". ` +
    `Nada: ${gaya || "ramah dan santai"}. Jangan pakai emoji berlebihan (maksimal 1). ` +
    `Jangan menulis harga, jangan mengarang klaim (mis. "terlaris", "terbaik") yang tidak terbukti. ` +
    `Kembalikan hanya captionnya saja, tanpa penjelasan tambahan.`;
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 250 },
        }),
      });
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    if (!r.ok || !text) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      return { caption: template, ai: false, note: `AI gagal (${msg}) — memakai template.` };
    }
    const caption = text.includes("#affiliate") ? text : `${text}\n#affiliate`;
    return { caption, ai: true, note: "Caption ditulis ulang oleh AI (Gemini)." };
  } catch (e) {
    return { caption: template, ai: false, note: `AI gagal (${e.message}) — memakai template.` };
  }
}

/* ---------------- Facebook Login (OAuth) ---------------- */

const FB_SCOPES = "pages_manage_posts,pages_read_engagement,pages_show_list";

export function fbRedirectUri(settings, host) {
  const h = (settings.domain || "").trim() || host;
  return `https://${h}/auth/callback`;
}

async function fbJson(url) {
  const r = await fetch(url);
  let j = {};
  try { j = await r.json(); } catch { /* abaikan */ }
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
  return j;
}

/** Langkah 1 OAuth: buat state, simpan di Blobs (10 menit), kembalikan URL dialog Facebook. */
export async function oauthLoginUrl(env, settings, host) {
  if (!env.FB_APP_ID || !env.FB_APP_SECRET) {
    return { error: "Facebook Login belum disiapkan: env var FB_APP_ID / FB_APP_SECRET belum diset. Isi token manual di tab Akun, atau ikuti README bagian 'Hubungkan Page Facebook'." };
  }
  const state = randomUUID();
  const redirectUri = fbRedirectUri(settings, host);
  await env.LINKS_KV.put(`oauth:${state}`, JSON.stringify({ redirectUri, t: Date.now() }));
  const q = new URLSearchParams({
    client_id: env.FB_APP_ID, redirect_uri: redirectUri,
    scope: FB_SCOPES, response_type: "code", state,
  });
  return { url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q.toString()}` };
}

/** Langkah 2 OAuth: tukar code -> token panjang -> daftar Page, simpan sebagai akun. */
export async function oauthCallback(env, settings, code, state) {
  const raw = await env.LINKS_KV.get(`oauth:${state}`);
  if (!raw) return { error: "State OAuth tidak ditemukan / sudah kedaluwarsa. Ulangi dari tombol 'Hubungkan Page Facebook'." };
  await env.LINKS_KV.delete(`oauth:${state}`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { error: "State OAuth rusak. Ulangi dari tombol 'Hubungkan Page Facebook'." }; }
  // Blobs tidak punya TTL: periksa umur state manual (10 menit).
  if (!parsed.t || Date.now() - parsed.t > OAUTH_STATE_TTL_MS) {
    return { error: "State OAuth sudah kedaluwarsa (lebih dari 10 menit). Ulangi dari tombol 'Hubungkan Page Facebook'." };
  }
  const { redirectUri } = parsed;
  const enc = encodeURIComponent;
  // code -> token pendek
  const short = await fbJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token` +
    `?client_id=${enc(env.FB_APP_ID)}&redirect_uri=${enc(redirectUri)}` +
    `&client_secret=${enc(env.FB_APP_SECRET)}&code=${enc(code)}`);
  // token pendek -> token panjang (~60 hari)
  const long = await fbJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token` +
    `?grant_type=fb_exchange_token&client_id=${enc(env.FB_APP_ID)}` +
    `&client_secret=${enc(env.FB_APP_SECRET)}&fb_exchange_token=${enc(short.access_token)}`);
  const longToken = long.access_token;
  // daftar Page + Page token
  const pages = await fbJson(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${enc(longToken)}&limit=100`);
  const list = pages.data || [];
  if (!list.length) return { error: "Tidak ada Page yang terhubung ke akun Facebook ini (atau izin pages_show_list belum diberikan)." };
  let added = 0, updated = 0;
  for (const p of list) {
    const existing = (settings.accounts || []).find((a) => a.page_id === p.id);
    if (existing) { existing.name = p.name; existing.token = p.access_token; updated++; }
    else {
      settings.accounts.push({ id: randomUUID(), name: p.name, page_id: p.id, token: p.access_token });
      added++;
    }
  }
  if (!settings.active_account && settings.accounts.length) settings.active_account = settings.accounts[0].id;
  await saveSettings(env, settings);
  await addLog(env, "simpan", `Facebook Login berhasil: ${added} Page ditambahkan, ${updated} diperbarui (${list.map((p) => p.name).join(", ")}). Token Page berlaku ~60 hari.`);
  return { ok: true, added, updated, names: list.map((p) => p.name) };
}

/* ---------------- kunci panel (ADMIN_PASSWORD) ---------------- */

export async function checkSession(env, request) {
  if (!env.ADMIN_PASSWORD) return true; // tidak dikunci bila env var belum diset
  const cookie = request.headers.get("Cookie") || "";
  const m = /fa_session=([^;]+)/.exec(cookie);
  if (!m) return false;
  const raw = await env.LINKS_KV.get(`session:${m[1]}`);
  if (!raw) return false;
  // Blobs tidak punya TTL: periksa umur sesi manual (7 hari).
  try {
    const parsed = JSON.parse(raw);
    return !!parsed.t && (Date.now() - parsed.t) < SESSION_TTL_MS;
  } catch {
    return raw === "1"; // sesi lama (format sebelum stempel waktu) — diterima sekali, dibuat ulang saat login berikutnya
  }
}

export async function createSession(env) {
  const token = randomUUID();
  await env.LINKS_KV.put(`session:${token}`, JSON.stringify({ t: Date.now() }));
  return token;
}

export function passwordsEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- scheduler (cron) ---------------- */

/** Jadwal hari ini (WIB) yang jatuh tempo dalam jendela 10 menit terakhir dan belum dieksekusi. */
export function dueSchedules(settings, nowMs) {
  const { dateStr } = wibParts(nowMs);
  const due = [];
  for (const hm of settings.schedule || []) {
    if (!/^\d{2}:\d{2}$/.test(hm)) continue;
    const schedMs = wibToMs(dateStr, hm);
    const late = nowMs - schedMs;
    if (late >= 0 && late < 10 * 60 * 1000 && settings.last_fired !== `${dateStr} ${hm}`) {
      due.push({ dateStr, hm, key: `${dateStr} ${hm}` });
    }
  }
  return due;
}

/**
 * Eksekusi satu jadwal jatuh tempo (dipakai scheduler + bisa dipicu manual).
 * Menyiapkan postingan, lalu bila mode API Graph -> terbitkan SEKALI.
 * Bila mode Manual -> tandai jatuh tempo + banner "Saatnya posting!".
 */
export async function fireSchedule(env, settings, linksObj, host, key) {
  settings.last_fired = key;
  settings.last_tick = wibParts(Date.now()).full;
  await saveSettings(env, settings);
  // Host efektif untuk link jembatan & gambar: domain sendiri > host situs
  // yang terdeteksi otomatis (alamat netlify.app gratis) > host pemanggil.
  const effHost = (settings.domain || "").trim() || (settings.auto_host || "").trim() || (host || "").trim();
  await addLog(env, "jadwal", `Jadwal jatuh tempo: ${key.split(" ")[1]} WIB. Menyiapkan postingan berikutnya.`);
  const { preview, error } = await preparePost(env, settings, linksObj, effHost);
  if (error) {
    settings.banner = "Jadwal jatuh tempo, tapi tidak ada link aktif untuk disiapkan.";
    settings.banner_kind = "error";
    await saveSettings(env, settings);
    return { ok: false, error };
  }
  const account = activeAccount(settings);
  if (settings.mode === "api" && account && account.token) {
    if (!effHost) {
      // Jangan terbitkan link jembatan yang tidak valid ke Facebook.
      await addLog(env, "auto-posting",
        "GAGAL: Auto-posting dilewati — belum ada alamat publik (buka panel sekali supaya alamat netlify.app tercatat otomatis, atau isi domain sendiri di tab Akun). Postingan sudah disiapkan, terbitkan manual.");
      settings.banner = "Jadwal jatuh tempo, tapi belum ada alamat publik — buka panel sekali (alamat netlify.app tercatat otomatis) atau isi domain sendiri. Postingan sudah disiapkan, terbitkan manual.";
      settings.banner_kind = "error";
      await saveSettings(env, settings);
      return { ok: false, preview, error: "Alamat publik belum tersedia." };
    }
    const res = await publishPost(env, settings, account, preview, effHost);
    await addLog(env, "auto-posting",
      (res.ok ? "BERHASIL: " : "GAGAL: ") +
      (res.ok
        ? `Auto-posting ke Page "${account.name}" (post id: ${res.postId || "-"}).`
        : `Auto-posting gagal: ${res.error}`));
    settings.banner = res.ok
      ? `Auto-posting berhasil (${key.split(" ")[1]} WIB): link ${preview.link_n}.`
      : `Gagal auto-posting: ${res.error} — siapkan manual.`;
    settings.banner_kind = res.ok ? "info" : "error";
    await saveSettings(env, settings);
    return { ok: res.ok, preview, error: res.error };
  }
  settings.banner = `Saatnya posting! (${key.split(" ")[1]} WIB) — postingan link ${preview.link_n} sudah disiapkan di tab Posting.`;
  settings.banner_kind = "info";
  await saveSettings(env, settings);
  return { ok: true, preview, manual: true };
}

/**
 * Bulk Post: siapkan + (bila mode API) terbitkan N postingan sekaligus dari antrian giliran.
 * Anggaran waktu lunak (deadlineMs, bawaan 25 detik — di bawah batas 30 detik Netlify):
 * bila anggaran habis di tengah jalan, berhenti dan laporkan hasil parsial
 * (sisa postingan belum dicoba, jalankan Bulk Post lagi untuk melanjutkan).
 */
export async function bulkPost(env, settings, linksObj, host, count, deadlineMs = Date.now() + 25000) {
  const n = Math.max(1, Math.min(10, Number(count) || 1));
  const account = activeAccount(settings);
  const results = [];
  let kehabisanWaktu = false;
  for (let i = 0; i < n; i++) {
    if (Date.now() > deadlineMs) { kehabisanWaktu = true; break; }
    const { preview, error } = await preparePost(env, settings, linksObj, host);
    if (error) { results.push({ link_n: null, ok: false, error }); break; }
    let pub = null;
    if (settings.mode === "api" && account && account.token) {
      pub = await publishPost(env, settings, account, preview, host);
      await addLog(env, "auto-posting",
        (pub.ok ? "BERHASIL: " : "GAGAL: ") +
        `Bulk ${i + 1}/${n} link ${preview.link_n} "${preview.nama}": ` +
        (pub.ok ? `post id ${pub.postId || "-"}` : pub.error));
    } else {
      await addLog(env, "siapkan", `Bulk ${i + 1}/${n} disiapkan (mode Manual): link ${preview.link_n} "${preview.nama}".`);
    }
    results.push({ link_n: preview.link_n, nama: preview.nama, bridge: preview.bridge, caption: preview.caption, images: preview.images, ok: pub ? pub.ok : true, error: pub && !pub.ok ? pub.error : null, postId: pub && pub.postId ? pub.postId : null });
  }
  const sukses = results.filter((r) => r.ok).length;
  const gagal = results.filter((r) => !r.ok).length;
  const sisa = n - results.length;
  settings.bulk_result = {
    waktu: wibParts(Date.now()).full, total: results.length, sukses, gagal,
    diminta: n, sisa, parsial: sisa > 0, results,
  };
  await saveSettings(env, settings);
  await addLog(env, "bulk",
    kehabisanWaktu
      ? `Bulk Post berhenti karena batas waktu (parsial): ${sukses} berhasil, ${gagal} gagal, ${sisa} belum dicoba dari ${n} yang diminta. Jalankan Bulk Post lagi untuk melanjutkan.`
      : `Bulk Post selesai: ${sukses} berhasil, ${gagal} gagal, dari ${results.length} postingan.`);
  return settings.bulk_result;
}

/** Dipanggil Scheduled Function: periksa jadwal yang jatuh tempo dan eksekusi (1x per jadwal). */
export async function runScheduled(env) {
  const nowMs = Date.now();
  let settings = await loadSettings(env);
  const linksObj = await loadLinks(env);
  settings.last_tick = wibParts(nowMs).full;
  await saveSettings(env, settings);
  if (!settings.auto) return { ok: true, auto: false, fired: 0 };
  const host = (settings.domain || "").trim() || (settings.auto_host || "").trim();
  let fired = 0;
  for (const d of dueSchedules(settings, nowMs)) {
    await fireSchedule(env, settings, linksObj, host, d.key);
    settings = await loadSettings(env);
    fired++;
  }
  return { ok: true, auto: true, fired };
}
