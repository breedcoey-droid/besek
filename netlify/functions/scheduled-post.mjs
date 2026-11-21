/**
 * Scheduled Function Fanpage Automator — Netlify.
 * Memeriksa jadwal posting (WIB) tiap 5 menit dan mengeksekusi jadwal yang
 * jatuh tempo, 1x per jadwal. Logika yang sama dengan lib/logic.mjs
 * (runScheduled) — tidak ada duplikasi logika di sini.
 *
 * Catatan Netlify:
 *  - Jadwal ditulis inline di bawah (butuh package @netlify/functions).
 *  - Cron hanya jalan di PRODUCTION deploy (bukan Deploy Preview).
 *  - Tiap invokasi dibatasi 30 detik; satu jadwal hanya menerbitkan SATU
 *    postingan sehingga aman dari batas itu.
 */

import { makeEnv } from "./lib/store.mjs";
import { runScheduled } from "./lib/logic.mjs";

export const config = { schedule: "*/5 * * * *" };

export default async () => {
  const env = await makeEnv(null, process.env);
  const result = await runScheduled(env);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { "Content-Type": "application/json" },
  });
};
