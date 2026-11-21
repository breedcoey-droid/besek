/**
 * Lapisan penyimpanan Fanpage Automator — Netlify Blobs.
 * =====================================================
 * Semua data panel tersimpan di SATU Blobs store site-scoped bernama
 * "fanpage-automator" (bertahan antar-deploy):
 *   settings, links, log, gallery:<n>, sessions/<token>, oauth:<state>
 *   images/<key>  -> file gambar (link/<n>/<file> atau umum/<file>)
 *
 * Modul ini menyajikan antarmuka yang sama seperti env Worker Cloudflare
 * (LINKS_KV + IMAGES) supaya logika di lib/logic.mjs bisa dipakai ulang
 * hampir tanpa perubahan. Perbedaan yang ditangani di sini:
 *  - Blobs tidak punya TTL seperti KV: kedaluwarsa state OAuth (10 mnt)
 *    dan sesi panel (7 hari) diperiksa manual di lib/logic.mjs lewat
 *    stempel waktu yang ikut disimpan.
 *  - getStore() di-import LAZILY (dynamic import) supaya test-harness
 *    bisa berjalan dengan mock store tanpa perlu package terinstal.
 */

import { randomUUID } from "node:crypto";

const STORE_NAME = "fanpage-automator";

let blobsModule = null;

async function getBlobsStore() {
  if (!blobsModule) blobsModule = await import("@netlify/blobs");
  return blobsModule.getStore(STORE_NAME);
}

/**
 * Bentuk env yang dipakai seluruh logika.
 * @param {object|null} injectedStore - store Blobs (asli dari getStore, atau
 *   mock di test-harness). Bila null, diambil dari @netlify/blobs.
 * @param {object} envVars - process.env (atau tiruan di test-harness).
 */
export async function makeEnv(injectedStore, envVars = process.env) {
  const store = injectedStore ?? (await getBlobsStore());
  const ev = envVars || {};

  const LINKS_KV = {
    async get(key, type) {
      if (type === "json") {
        const v = await store.get(key, { type: "json" });
        return v === undefined ? null : v;
      }
      const v = await store.get(key, { type: "text" });
      return v === undefined || v === null ? null : v;
    },
    async put(key, value) {
      const s = typeof value === "string" ? value : JSON.stringify(value);
      await store.set(key, s);
    },
    async delete(key) {
      await store.delete(key);
    },
  };

  const IMAGES = {
    async get(key) {
      const res = await store.getWithMetadata(`images/${key}`, { type: "arrayBuffer" });
      if (!res || res.data === null || res.data === undefined) return null;
      const buf = res.data;
      return {
        body: buf,
        arrayBuffer: async () => buf,
        httpMetadata: { contentType: res.metadata?.contentType || "image/jpeg" },
      };
    },
    async put(key, value, opts) {
      const contentType = opts?.httpMetadata?.contentType || "image/jpeg";
      await store.set(`images/${key}`, value, { metadata: { contentType } });
    },
    async delete(key) {
      await store.delete(`images/${key}`);
    },
  };

  return {
    FB_APP_ID: (ev.FB_APP_ID || "").trim(),
    FB_APP_SECRET: (ev.FB_APP_SECRET || "").trim(),
    GEMINI_API_KEY: (ev.GEMINI_API_KEY || "").trim(),
    ADMIN_PASSWORD: (ev.ADMIN_PASSWORD || "").trim(),
    LINKS_KV,
    IMAGES,
  };
}

export { randomUUID };
