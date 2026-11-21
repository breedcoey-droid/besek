/**
 * Routing HTTP Fanpage Automator — Netlify.
 * Port handleFetch + handleAction dari worker.js versi Cloudflare.
 * Dipanggil oleh netlify/functions/app.mjs (satu function untuk semua rute).
 */

import {
  wibParts, DEFAULT_TEMPLATE, MAX_LINKS, MAX_FILE, ALLOWED_EXT,
  safeFilename, extOf, loadLinks, loadSettings, saveSettings, addLog,
  listGallery, saveGallery, r2Key, activeLinks, preparePost, bulkPost,
  bridgeHtml, captionAI, oauthLoginUrl, oauthCallback,
  checkSession, createSession, passwordsEqual,
} from "./logic.mjs";
import { renderPage, loginPage } from "./panel.mjs";

function redirectTo(request, path, code = 303) {
  return Response.redirect(new URL(path, request.url).toString(), code);
}

function msgUrl(tab, msg) {
  return `/?tab=${tab}&msg=${encodeURIComponent(msg || "")}`;
}

export async function handleAction(env, request, url) {
  const form = await request.formData().catch(() => null);
  const get = (k) => { const v = form ? form.get(k) : null; return typeof v === "string" ? v : ""; };
  const aksi = get("aksi");
  let tab = "akun";
  let msg = "";
  const settings = await loadSettings(env);
  const linksObj = await loadLinks(env);
  const host = url.host;

  try {
    if (aksi === "tambah_akun") {
      tab = "akun";
      const nama = get("nama").trim(), pageId = get("page_id").trim(), token = get("token").trim();
      if (!pageId || !token) { msg = "Page ID dan Page Access Token wajib diisi."; }
      else {
        const existing = settings.accounts.find((a) => a.page_id === pageId);
        if (existing) { existing.name = nama || existing.name; existing.token = token; msg = `Akun "${existing.name}" diperbarui.`; }
        else {
          const acc = { id: crypto.randomUUID(), name: nama || `Page ${pageId}`, page_id: pageId, token };
          settings.accounts.push(acc);
          if (!settings.active_account) settings.active_account = acc.id;
          msg = `Akun "${acc.name}" ditambahkan.`;
        }
        await saveSettings(env, settings);
        await addLog(env, "simpan", `${msg} Token tidak dicatat ke log.`);
      }
    } else if (aksi === "pilih_akun") {
      tab = "akun";
      const acc = settings.accounts.find((a) => a.id === get("id"));
      if (acc) { settings.active_account = acc.id; await saveSettings(env, settings); msg = `Akun aktif: ${acc.name}.`; }
    } else if (aksi === "hapus_akun") {
      tab = "akun";
      const id = get("id");
      const acc = settings.accounts.find((a) => a.id === id);
      settings.accounts = settings.accounts.filter((a) => a.id !== id);
      if (settings.active_account === id) settings.active_account = settings.accounts[0]?.id || "";
      await saveSettings(env, settings);
      await addLog(env, "simpan", `Akun dihapus: ${acc ? acc.name : id}.`);
      msg = "Akun dihapus.";
    } else if (aksi === "simpan_pengaturan") {
      tab = "akun";
      settings.domain = get("domain").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
      const mode = get("mode");
      if (mode === "manual" || mode === "api") settings.mode = mode;
      const im = get("image_mode");
      if (im === "single" || im === "album") settings.image_mode = im;
      await saveSettings(env, settings);
      await addLog(env, "simpan", `Pengaturan disimpan (mode: ${settings.mode}, gambar: ${settings.image_mode}, domain: ${settings.domain || "-"}).`);
      msg = "Pengaturan tersimpan.";
    } else if (aksi === "simpan_konten") {
      tab = "konten";
      for (let i = 1; i <= MAX_LINKS; i++) {
        const s = linksObj.links.find((x) => x.n === i);
        s.nama = get(`nama_${i}`).trim();
        s.url = get(`url_${i}`).trim();
        const g = get(`galeri_${i}`);
        s.galeri = g === "sendiri" ? "sendiri" : "umum";
      }
      await env.LINKS_KV.put("links", JSON.stringify(linksObj));
      await addLog(env, "simpan", `Konten disimpan: ${activeLinks(linksObj).length} link aktif.`);
      msg = `Konten tersimpan (${activeLinks(linksObj).length} link aktif).`;
    } else if (aksi === "upload") {
      tab = "konten";
      const slotRaw = get("slot");
      const slot = slotRaw === "umum" ? "umum" : Number(slotRaw);
      if (slot !== "umum" && !(slot >= 1 && slot <= MAX_LINKS)) throw new Error("Slot tidak dikenal.");
      const files = form ? form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0) : [];
      const gallery = await listGallery(env, slot);
      let ok = 0; const bad = [];
      for (const f of files) {
        const ext = extOf(f.name);
        if (!ALLOWED_EXT.has(ext)) { bad.push(`${f.name} (bukan gambar)`); continue; }
        if (f.size > MAX_FILE) { bad.push(`${f.name} (lebih dari 10 MB)`); continue; }
        let name = safeFilename(f.name);
        let k = 1;
        while (gallery.includes(name)) { name = `${name.replace(/(\.[^.]+)?$/, "")}_${k}${ext}`; k++; }
        const key = r2Key(slot, name);
        await env.IMAGES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || "image/jpeg" } });
        gallery.push(name);
        ok++;
      }
      await saveGallery(env, slot, gallery);
      if (bad.length) {
        await addLog(env, "error", `Upload ke galeri ${slot}: ${ok} berhasil, gagal: ${bad.join("; ")}`);
        msg = `Upload: ${ok} berhasil. Gagal: ${bad.join("; ")}`;
      } else {
        await addLog(env, "simpan", `Upload ${ok} gambar ke galeri ${slot}.`);
        msg = ok ? `${ok} gambar di-upload ke galeri ${slot}.` : "Tidak ada file gambar yang dipilih.";
      }
    } else if (aksi === "hapus_gambar") {
      tab = "konten";
      const slotRaw = get("slot");
      const slot = slotRaw === "umum" ? "umum" : Number(slotRaw);
      const fname = safeFilename(get("file"));
      const gallery = await listGallery(env, slot);
      const idx = gallery.indexOf(fname);
      if (idx >= 0) {
        gallery.splice(idx, 1);
        await saveGallery(env, slot, gallery);
        await env.IMAGES.delete(r2Key(slot, fname));
        await addLog(env, "simpan", `Gambar dihapus dari galeri ${slot}: ${fname}`);
        msg = `Gambar ${fname} dihapus.`;
      } else { msg = "File tidak ditemukan."; }
    } else if (aksi === "tambah_jam") {
      tab = "posting";
      const jam = get("jam").trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)) msg = "Format jam salah. Pakai HH:MM, contoh 19:00.";
      else if ((settings.schedule || []).includes(jam)) msg = `Jam ${jam} sudah ada di jadwal.`;
      else {
        settings.schedule = [...(settings.schedule || []), jam].sort();
        await saveSettings(env, settings);
        await addLog(env, "simpan", `Jam jadwal ditambah: ${jam} WIB.`);
        msg = `Jam ${jam} ditambahkan ke jadwal.`;
      }
    } else if (aksi === "hapus_jam") {
      tab = "posting";
      const jam = get("jam");
      settings.schedule = (settings.schedule || []).filter((h) => h !== jam);
      await saveSettings(env, settings);
      await addLog(env, "simpan", `Jam jadwal dihapus: ${jam} WIB.`);
      msg = `Jam ${jam} dihapus dari jadwal.`;
    } else if (aksi === "set_auto") {
      tab = "posting";
      settings.auto = get("auto") === "1";
      await saveSettings(env, settings);
      await addLog(env, "simpan", "Mode AUTO " + (settings.auto ? "diaktifkan." : "dimatikan (mode manual)."));
      msg = settings.auto ? "AUTO diaktifkan." : "AUTO dimatikan (mode manual).";
    } else if (aksi === "simpan_template") {
      tab = "posting";
      const t = get("template").trim();
      if (t) {
        settings.caption_template = t;
        await saveSettings(env, settings);
        await addLog(env, "simpan", "Template caption disimpan.");
        msg = "Template caption tersimpan.";
      } else msg = "Template tidak boleh kosong.";
    } else if (aksi === "siapkan") {
      tab = "posting";
      const { preview, error } = await preparePost(env, settings, linksObj, host);
      msg = error || `Postingan disiapkan: link ${preview.link_n} — ${preview.nama}.`;
    } else if (aksi === "bulk") {
      tab = "posting";
      const jumlah = Math.max(1, Math.min(10, Number(get("jumlah")) || 3));
      // Anggaran waktu lunak 25 detik (di bawah batas 30 detik Netlify):
      // bila habis, bulkPost berhenti dan melaporkan hasil parsial.
      const res = await bulkPost(env, settings, linksObj, host, jumlah, Date.now() + 25000);
      msg = res.parsial
        ? `Bulk Post parsial (batas waktu): ${res.sukses} berhasil, ${res.gagal} gagal, ${res.sisa} belum dicoba dari ${res.diminta} yang diminta. Jalankan Bulk Post lagi untuk melanjutkan.`
        : `Bulk Post selesai: ${res.sukses} berhasil, ${res.gagal} gagal, dari ${res.total} postingan. Lihat hasilnya di bawah dan di tab Log.`;
    } else if (aksi === "tutup_banner") {
      tab = get("tab") || "posting";
      settings.banner = "";
      await saveSettings(env, settings);
      msg = "";
    } else if (aksi === "bersihkan_log") {
      tab = "log";
      await env.LINKS_KV.put("log", JSON.stringify({ entries: [] }));
      await addLog(env, "simpan", "Log dibersihkan.");
      msg = "Log dibersihkan.";
    } else {
      msg = "Aksi tidak dikenal.";
    }
  } catch (e) {
    msg = `Gagal: ${e.message}`;
    await addLog(env, "error", `Aksi gagal: ${e.message}`);
  }
  return redirectTo(request, msgUrl(tab, msg));
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- endpoint publik (tanpa kunci panel) ---
  if (path === "/health") {
    return new Response(JSON.stringify({ ok: true, time: wibParts(Date.now()).full }), { headers: { "Content-Type": "application/json" } });
  }

  // Halaman jembatan: /go/<n> -> 302
  const goMatch = path.match(/^\/go\/(\d+)$/);
  if (goMatch) {
    const n = Number(goMatch[1]);
    const linksObj = await loadLinks(env);
    const slot = linksObj.links.find((s) => s.n === n);
    const ua = (request.headers.get("User-Agent") || "").slice(0, 60);
    if (!slot || !slot.url.trim()) {
      await addLog(env, "jembatan", `Klik /go/${n} gagal: link ${n} belum diisi.`);
      return new Response(`<h1>Link belum diisi</h1><p>Isi dulu slot link ${n} di tab Konten.</p>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    await addLog(env, "jembatan", `Klik jembatan: link ${n} "${slot.nama}" -> ${slot.url} (UA: ${ua})`);
    return new Response(null, { status: 302, headers: { Location: slot.url } });
  }

  // Gambar publik dari Blobs: /img/<key>
  if (path.startsWith("/img/")) {
    const key = decodeURIComponent(path.slice(5));
    if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
    const obj = await env.IMAGES.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // OAuth callback (publik, dilindungi state di Blobs)
  if (path === "/auth/callback") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const err = url.searchParams.get("error") || "";
    const settings = await loadSettings(env);
    if (err) return redirectTo(request, msgUrl("akun", `Facebook Login dibatalkan / ditolak: ${err}.`));
    if (!code || !state) return redirectTo(request, msgUrl("akun", "Callback OAuth tidak lengkap (code/state hilang)."));
    try {
      const res = await oauthCallback(env, settings, code, state);
      if (res.error) return redirectTo(request, msgUrl("akun", `Facebook Login gagal: ${res.error}`));
      return redirectTo(request, msgUrl("akun", `Facebook Login berhasil: ${res.added} Page ditambahkan, ${res.updated} diperbarui (${res.names.join(", ")}).`));
    } catch (e) {
      await addLog(env, "error", `Facebook Login gagal: ${e.message}`);
      return redirectTo(request, msgUrl("akun", `Facebook Login gagal: ${e.message}`));
    }
  }

  // Login panel (bila ADMIN_PASSWORD diset)
  if (path === "/login") {
    if (!env.ADMIN_PASSWORD) return redirectTo(request, "/");
    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const pw = form ? String(form.get("password") || "") : "";
      if (passwordsEqual(pw, env.ADMIN_PASSWORD)) {
        const token = await createSession(env);
        const res = redirectTo(request, "/");
        res.headers.set("Set-Cookie", `fa_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
        return res;
      }
      return new Response(loginPage("Kata sandi salah."), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response(loginPage(""), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path === "/logout") {
    const cookie = request.headers.get("Cookie") || "";
    const m = /fa_session=([^;]+)/.exec(cookie);
    if (m) await env.LINKS_KV.delete(`session:${m[1]}`);
    const res = redirectTo(request, "/login");
    res.headers.set("Set-Cookie", "fa_session=; Path=/; HttpOnly; Max-Age=0");
    return res;
  }

  // --- kunci panel (bila ADMIN_PASSWORD diset) ---
  if (!(await checkSession(env, request))) {
    return redirectTo(request, "/login");
  }

  // OAuth login: redirect ke dialog Facebook
  if (path === "/auth/login") {
    const settings = await loadSettings(env);
    const res = await oauthLoginUrl(env, settings, url.host);
    if (res.error) return redirectTo(request, msgUrl("akun", res.error));
    return Response.redirect(res.url, 302);
  }

  // Ekspor HTML redirect per link
  const expMatch = path.match(/^\/export-redirect\/(\d+)$/);
  if (expMatch) {
    const n = Number(expMatch[1]);
    const linksObj = await loadLinks(env);
    const slot = linksObj.links.find((s) => s.n === n);
    if (!slot || !slot.url.trim()) return new Response("<h1>Link belum diisi</h1>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    await addLog(env, "siapkan", `HTML redirect diekspor untuk link ${n} "${slot.nama}".`);
    return new Response(bridgeHtml(slot.nama, slot.url), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="jembatan-link-${n}.html"`,
      },
    });
  }

  // Caption AI (JSON)
  if (path === "/api/caption-ai" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { /* pakai preview */ }
    const settings = await loadSettings(env);
    const preview = settings.preview;
    const nama = (body.nama || preview?.nama || "").trim();
    const link = (body.url || preview?.bridge || "").trim();
    const gaya = (body.gaya || "ramah dan santai").trim();
    if (!nama) {
      return new Response(JSON.stringify({ caption: "", ai: false, note: "Belum ada postingan yang disiapkan — siapkan dulu di tab Posting." }),
        { headers: { "Content-Type": "application/json" } });
    }
    const res = await captionAI(env, { nama, url: link, gaya });
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json" } });
  }

  // Aksi form panel
  if (path === "/action" && request.method === "POST") {
    return handleAction(env, request, url);
  }

  // Halaman utama (panel)
  if (path === "/" || path === "") {
    const tab = ["akun", "konten", "posting", "log"].includes(url.searchParams.get("tab") || "")
      ? url.searchParams.get("tab") : "akun";
    const settings = await loadSettings(env);
    // Catat host situs yang dipakai membuka panel (mis. xxx.netlify.app)
    // supaya cron tetap punya alamat publik gratis bila domain kosong.
    if (url.host && settings.auto_host !== url.host) {
      settings.auto_host = url.host;
      await saveSettings(env, settings);
    }
    const linksObj = await loadLinks(env);
    const html = await renderPage(env, settings, linksObj, tab, url.searchParams.get("msg") || "", url.host);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return new Response("Not found", { status: 404 });
}
