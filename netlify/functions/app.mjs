/**
 * Function utama Fanpage Automator — Netlify.
 * Menangani SEMUA rute panel (GET / + tab, POST /action, /api/caption-ai,
 * /auth/login + /auth/callback, /export-redirect/<n>, /go/<n>, /img/<key>,
 * /health, /login, /logout) lewat lib/router.mjs.
 *
 * netlify.toml me-rewrite SEMUA path (/*) ke function ini dengan status 200,
 * dan Netlify mempertahankan URL aslinya — jadi routing memakai
 * new URL(request.url).pathname seperti biasa.
 *
 * Bila function dipanggil langsung lewat alamat internal
 * /.netlify/functions/app[/...], awalan itu dibuang dulu supaya routing
 * tetap cocok.
 */

import { makeEnv } from "./lib/store.mjs";
import { handleRequest } from "./lib/router.mjs";

const INTERNAL_PREFIX = "/.netlify/functions/app";

export default async (req) => {
  const env = await makeEnv(null, process.env);
  let request = req;
  try {
    const url = new URL(req.url);
    if (url.pathname === INTERNAL_PREFIX || url.pathname.startsWith(INTERNAL_PREFIX + "/")) {
      url.pathname = url.pathname.slice(INTERNAL_PREFIX.length) || "/";
      request = new Request(url.toString(), req);
    }
  } catch {
    // Bila URL tidak bisa diurai, teruskan request apa adanya ke router.
  }
  return handleRequest(request, env);
};
