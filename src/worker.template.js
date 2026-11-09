/**
 * NicuInvertor — server pentru invertorul MPP Solar PIP-MAX (Cloudflare Worker)
 *
 * Ce face: servește aplicația NicuInvertor și citește datele invertorului din cloud-ul
 * DessMonitor (unde le trimite modulul Wi-Fi prin aplicația Energy-Mate).
 * Parola contului rămâne aici, pe server; în browser ajunge doar PIN-ul tău.
 *
 * Variabile de setat în Cloudflare (Settings → Variables and Secrets):
 *   DESS_USER    contul Energy-Mate / dessmonitor.com (e-mail sau utilizator)
 *   DESS_PASS    parola contului                         (tip Secret)
 *   APP_PIN      PIN-ul cu care deschizi aplicația       (tip Secret)
 * Opționale:
 *   DEVICE_SN    seria invertorului, dacă ai mai multe dispozitive în cont
 *   COMPANY_KEY  cheia platformei (implicit cea de pe dessmonitor.com)
 *   DESS_API     adresa API (implicit https://web.dessmonitor.com/public/)
 */

const APP_HTML = __APP_HTML__;

const DEFAULTS = {
  API: "https://web.dessmonitor.com/public/",
  COMPANY_KEY: "bnrl_frRFjEz8Mkn",
  APP_CLIENT: "web",
  APP_ID: "dessmonitor.com",
  APP_VERSION: "3.6.1.6",
  SOURCE: "1",
};

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc766"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#0a0f1e"/><circle cx="256" cy="256" r="150" fill="url(#g)"/><g stroke="#1a1205" stroke-width="22" stroke-linecap="round" fill="none"><circle cx="256" cy="256" r="46"/><path d="M256 150v28M256 334v28M150 256h28M334 256h28M181 181l20 20M311 311l20 20M181 331l20-20M311 201l20-20"/></g></svg>`;

const MANIFEST = {
  name: "NicuInvertor", short_name: "NicuInvertor", start_url: "/", display: "standalone",
  background_color: "#0a0f1e", theme_color: "#0a0f1e", lang: "ro",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
};

/* ------------------------------------------------------------------ */
/* Crypto + DessMonitor client                                         */
/* ------------------------------------------------------------------ */
async function sha1(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const enc = v => encodeURIComponent(String(v));

// Kept per Worker instance; re-authenticates when missing, expired or rejected.
const session = { token: null, secret: null, until: 0, device: null, deviceAt: 0 };

function cfg(env) {
  return {
    api: env.DESS_API || DEFAULTS.API,
    key: env.COMPANY_KEY || DEFAULTS.COMPANY_KEY,
    client: env.APP_CLIENT || DEFAULTS.APP_CLIENT,
    appId: env.APP_ID || DEFAULTS.APP_ID,
    ver: env.APP_VERSION || DEFAULTS.APP_VERSION,
    source: env.DESS_SOURCE || DEFAULTS.SOURCE,
  };
}
const tail = c => `&source=${enc(c.source)}&_app_client_=${enc(c.client)}&_app_id_=${enc(c.appId)}&_app_version_=${enc(c.ver)}`;

async function getJson(url) {
  const r = await fetch(url, { headers: { "accept": "application/json", "user-agent": "NicuInvertor/1.0" } });
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`Răspuns neașteptat de la cloud (HTTP ${r.status})`); }
}

async function login(env) {
  if (!env.DESS_USER || !env.DESS_PASS) throw new Error("Lipsește DESS_USER sau DESS_PASS în setările Cloudflare.");
  const c = cfg(env);
  const salt = String(Date.now());
  const action = `&action=authSource&usr=${enc(env.DESS_USER)}&company-key=${enc(c.key)}` + tail(c);
  const sign = await sha1(salt + (await sha1(env.DESS_PASS)) + action);
  const j = await getJson(`${c.api}?sign=${sign}&salt=${salt}${action}`);
  if (j.err !== 0 || !j.dat?.token) {
    const why = j.desc || j.err;
    throw new Error(`Autentificare respinsă de DessMonitor (${why}). Verifică dacă intri cu același cont pe dessmonitor.com.`);
  }
  session.token = j.dat.token;
  session.secret = j.dat.secret;
  session.until = Date.now() + Math.min((j.dat.expire || 86400) * 1000, 6 * 864e5) - 60e3;
}

async function call(env, actionName, params = {}, retried = false) {
  if (!session.token || Date.now() > session.until) await login(env);
  const c = cfg(env);
  const salt = String(Date.now());
  let action = `&action=${actionName}`;
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) action += `&${k}=${enc(v)}`;
  action += tail(c);
  const sign = await sha1(salt + session.secret + session.token + action);
  const j = await getJson(`${c.api}?sign=${sign}&salt=${salt}&token=${session.token}${action}`);
  // Token rejected or expired → log in again once.
  if (!retried && j.err !== 0 && /TOKEN|AUTH|SIGN|SESSION|EXPIRE|LOGIN/i.test(String(j.desc || ""))) {
    session.token = null;
    return call(env, actionName, params, true);
  }
  if (j.err !== 0) {
    if (j.err === 0x0102 || /NO_RECORD|NOT_FOUND/i.test(j.desc || "")) return { err: j.err, desc: j.desc, dat: null };
    throw new Error(`DessMonitor ${actionName}: ${j.desc || j.err}`);
  }
  return j;
}

async function device(env) {
  if (session.device && Date.now() - session.deviceAt < 6 * 36e5) return session.device;
  const j = await call(env, "webQueryDeviceEs", { page: 0, pagesize: 20 });
  const list = j.dat?.device || [];
  if (!list.length) throw new Error("Nu am găsit niciun invertor în cont. Adaugă-l întâi în Energy-Mate.");
  const want = (env.DEVICE_SN || "").trim();
  const d = (want && list.find(x => x.sn === want || x.pn === want)) || list[0];
  session.device = { pn: d.pn, sn: d.sn, devcode: d.devcode, devaddr: d.devaddr, alias: d.devalias, status: d.status, all: list.map(x => ({ pn: x.pn, sn: x.sn, alias: x.devalias, status: x.status })) };
  session.deviceAt = Date.now();
  return session.device;
}
const devParams = d => ({ pn: d.pn, devcode: d.devcode, devaddr: d.devaddr, sn: d.sn });

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */
const GROUP_RO = { gd_: "Rețea", pv_: "Fotovoltaic", bt_: "Baterie", by_: "Consum", bc_: "Consum", sy_: "Sistem" };
const num = v => { if (v === null || v === undefined || v === "") return NaN; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; };
const toW = (v, unit) => { const n = num(v); if (!isFinite(n)) return NaN; return /^kw$/i.test(String(unit || "").trim()) ? n * 1000 : n; };

function flatten(pars) {
  const out = [];
  for (const [g, items] of Object.entries(pars || {})) {
    if (!Array.isArray(items)) continue;
    for (const it of items) out.push({ group: GROUP_RO[g] || "Altele", key: g, id: it.id || "", par: String(it.par ?? it.id ?? ""), val: it.val, unit: it.unit || "" });
  }
  return out;
}
function pick(list, groups, ...patterns) {
  for (const re of patterns) {
    const hit = list.find(p => (!groups || groups.includes(p.key)) && (re.test(p.par) || re.test(p.id)));
    if (hit) return hit;
  }
  return null;
}
const pv = (p) => (p ? num(p.val) : NaN);

// DessMonitor sends times like "2026-11-09 15:05:00" in the plant's local time.
// The browser tells us its UTC offset (minutes, as Date#getTimezoneOffset) so we can convert.
function parseTime(t, tzMin) {
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  const s = String(t).trim().replace(" ", "T");
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s.slice(10))) return Date.parse(s);
  const ms = Date.parse(s + "Z");
  return isFinite(ms) ? ms + (tzMin || 0) * 60000 : NaN;
}

function normalise(last, flow, dev, tzMin) {
  const list = flatten(last?.pars);
  const P = (g, ...re) => pick(list, g, ...re);
  const strings = [];
  for (const i of [1, 2]) {
    const v = pv(P(["pv_"], new RegExp(`pv${i}.*(input )?voltage`, "i"), new RegExp(`pv${i}.*volt`, "i")));
    const a = pv(P(["pv_"], new RegExp(`pv${i}.*current`, "i")));
    let wP = P(["pv_"], new RegExp(`pv${i}.*(charging |input )?power`, "i"));
    let w = wP ? toW(wP.val, wP.unit) : NaN;
    if (!isFinite(w) && isFinite(v) && isFinite(a)) w = v * a;
    if (isFinite(v) || isFinite(w)) strings.push({ v, a: isFinite(a) ? a : (isFinite(w) && v > 0 ? w / v : NaN), w });
  }
  // energy-flow endpoint values (often more direct)
  const F = (k, name) => (flow?.[k] || []).find(x => x.par === name) || (flow?.[k] || [])[0];
  const fPv = flow ? F("pv_status", "pv_output_power") : null;
  const fLoad = flow ? F("bc_status", "load_active_power") : null;
  const fGrid = flow ? F("gd_status", "grid_active_power") : null;
  const fBatt = flow ? (flow.bt_status || []) : [];

  let pvPower = fPv ? toW(fPv.val, fPv.unit) : NaN;
  const sumStr = strings.reduce((s, x) => s + (isFinite(x.w) ? x.w : 0), 0);
  if (!isFinite(pvPower)) { const p = P(["pv_"], /pv.*(total|output).*power/i); pvPower = p ? toW(p.val, p.unit) : (strings.length ? sumStr : NaN); }

  const loadP = P(["by_", "bc_", "sy_"], /output active power/i, /load.*active power/i, /active power/i);
  let loadPower = loadP ? toW(loadP.val, loadP.unit) : NaN;
  if (!isFinite(loadPower) && fLoad) loadPower = toW(fLoad.val, fLoad.unit);
  const loadPct = pv(P(["by_", "bc_", "sy_"], /load percent/i, /load.*%/i, /output load/i));

  const bv = pv(P(["bt_"], /battery voltage/i, /voltage/i));
  const socP = P(["bt_"], /capacity|soc|state of charge/i);
  let soc = socP && /%/.test(socP.unit || "%") ? num(socP.val) : NaN;
  if (!isFinite(soc)) { const fs = fBatt.find(x => /capacity|soc/i.test(x.par) && /%/.test(x.unit || "")); if (fs) soc = num(fs.val); }
  const chg = pv(P(["bt_"], /charging current/i, /charge current/i));
  const dis = pv(P(["bt_"], /discharg.*current/i));
  let bcur = NaN;
  if (isFinite(chg) || isFinite(dis)) bcur = (isFinite(chg) ? chg : 0) - (isFinite(dis) ? dis : 0);
  else { const c = pv(P(["bt_"], /current/i)); if (isFinite(c)) bcur = c; }
  let bpow = NaN;
  const fbp = fBatt.find(x => /power/i.test(x.par));
  if (fbp) { bpow = toW(fbp.val, fbp.unit); if (fbp.status === -1 && bpow > 0) bpow = -bpow; }
  if (isFinite(bv) && isFinite(bcur)) bpow = bv * bcur; // currents give the reliable sign
  if (!isFinite(bpow) && isFinite(pvPower) && isFinite(loadPower)) bpow = pvPower - loadPower;

  const gv = pv(P(["gd_"], /grid voltage/i, /voltage/i));
  const gf = pv(P(["gd_"], /grid freq/i, /freq/i));
  let gpow = fGrid ? toW(fGrid.val, fGrid.unit) : NaN;
  if (!isFinite(gpow)) { const g = P(["gd_"], /power/i); gpow = g ? toW(g.val, g.unit) : NaN; }

  const ov = pv(P(["by_", "bc_", "sy_"], /output voltage/i));
  const of = pv(P(["by_", "bc_", "sy_"], /output freq/i));
  const temp = pv(P(null, /heat ?sink.*temp/i, /inverter.*temp/i, /temperature/i));
  const modeP = P(null, /working (state|mode)/i, /operating mode/i, /device mode/i, /^mode$/i, /mode/i);

  const ts = last?.gts ? parseTime(last.gts, tzMin) : NaN;
  return {
    ts: isFinite(ts) ? ts : null,
    online: dev.status === 0 || dev.status === undefined ? true : dev.status !== 1,
    mode: modeP ? String(modeP.val) : null,
    device: { pn: dev.pn, sn: dev.sn, alias: dev.alias },
    pv: { power: pvPower, strings },
    battery: { soc, voltage: bv, current: bcur, power: bpow },
    load: { power: loadPower, percent: loadPct },
    output: { voltage: ov, freq: of },
    grid: { voltage: gv, freq: gf, power: isFinite(gpow) ? gpow : 0, present: isFinite(gv) ? gv > 150 : null },
    temp,
    params: list.map(({ group, par, val, unit }) => ({ group, par, val, unit })),
  };
}

// Pull [timeMs, value] pairs out of whatever shape the day-curve endpoint returns.
function seriesFrom(dat, tzMin) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) {
      for (const it of x) {
        if (it && typeof it === "object" && !Array.isArray(it)) {
          const t = it.ts ?? it.gts ?? it.time ?? it.key ?? it.date;
          const v = it.val ?? it.value ?? it.v;
          if (t !== undefined && v !== undefined) {
            const ms = parseTime(t, tzMin);
            const n = num(v);
            if (isFinite(ms) && isFinite(n)) out.push([ms, n]);
          } else walk(Object.values(it));
        } else if (Array.isArray(it) && it.length === 2) {
          const [t, v] = it; const ms = parseTime(t, tzMin); const n = num(v);
          if (isFinite(ms) && isFinite(n)) out.push([ms, n]);
        } else walk(it);
      }
    } else if (x && typeof x === "object") for (const v of Object.values(x)) walk(v);
  };
  walk(dat);
  out.sort((a, b) => a[0] - b[0]);
  // values reported in kW are small; the chart works in W
  const max = out.reduce((m, p) => Math.max(m, Math.abs(p[1])), 0);
  const unit = JSON.stringify(dat || "").match(/"unit"\s*:\s*"(k?W)"/i)?.[1];
  if ((unit && /^kw$/i.test(unit)) || (max > 0 && max < 30)) for (const p of out) p[1] *= 1000;
  return out;
}

async function daySeries(env, date, tzMin) {
  const d = await device(env);
  const one = async (parameter) => {
    try {
      const j = await call(env, "querySPDeviceKeyParameterOneDay", { ...devParams(d), i18n: "en_US", parameter, chartStatus: "false", date });
      return seriesFrom(j.dat, tzMin);
    } catch { return []; }
  };
  const [pvS, loadS, battS, gridS] = await Promise.all([
    one("PV_OUTPUT_POWER"), one("LOAD_ACTIVE_POWER"), one("BATTERY_ACTIVE_POWER"), one("GRID_ACTIVE_POWER"),
  ]);
  return { date, pv: pvS, load: loadS, battery: battS, grid: gridS };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
const SEC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj, (k, v) => (typeof v === "number" && !isFinite(v) ? null : v)), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SEC },
});

function pinOk(req, env) {
  const given = req.headers.get("x-pin") || "";
  const want = String(env.APP_PIN || "");
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const tzMin = Math.max(-840, Math.min(840, parseInt(url.searchParams.get("tz") || "0", 10) || 0));

    if (p === "/" || p === "/index.html")
      return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...SEC } });
    if (p === "/icon.svg")
      return new Response(ICON_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (p === "/manifest.webmanifest")
      return new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json" } });

    if (p === "/api/ping")
      return json({ app: "nicuinvertor", configured: Boolean(env.DESS_USER && env.DESS_PASS && env.APP_PIN) });

    if (p.startsWith("/api/")) {
      if (!env.APP_PIN) return json({ error: "Setează APP_PIN în Cloudflare ca să poți folosi aplicația." }, 503);
      if (!pinOk(req, env)) return json({ error: "PIN greșit" }, 401);
      try {
        if (p === "/api/auth") return json({ ok: true });
        if (p === "/api/devices") { const d = await device(env); return json({ device: d, devices: d.all }); }
        if (p === "/api/live") {
          const d = await device(env);
          const [last, flow] = await Promise.all([
            call(env, "querySPDeviceLastData", { ...devParams(d), i18n: "en_US" }),
            call(env, "webQueryDeviceEnergyFlowEs", devParams(d)).catch(() => null),
          ]);
          return json(normalise(last.dat, flow?.dat, d, tzMin));
        }
        if (p === "/api/day") {
          const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : new Date().toISOString().slice(0, 10);
          return json(await daySeries(env, date, tzMin));
        }
        if (p === "/api/raw") { // diagnostic: raw cloud answer, behind the PIN
          const d = await device(env);
          const last = await call(env, "querySPDeviceLastData", { ...devParams(d), i18n: "en_US" });
          return json({ device: d, last: last.dat });
        }
        return json({ error: "Nu există" }, 404);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }
    return new Response("Nu există", { status: 404 });
  },
};
