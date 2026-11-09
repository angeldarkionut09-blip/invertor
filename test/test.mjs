// Runs the built worker against a fake DessMonitor that checks every signature.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const worker = (await import("../worker.js")).default;

const sha1 = s => createHash("sha1").update(s).digest("hex");
const USER = "ion.pop@example.ro", PASS = "Parola#2026", TOKEN = "tok123abc", SECRET = "sec456def";
const calls = [];

globalThis.fetch = async (url) => {
  const u = String(url);
  const q = u.slice(u.indexOf("?") + 1);
  const params = new URLSearchParams(q);
  const salt = params.get("salt"), sign = params.get("sign"), action = params.get("action");
  calls.push(action);
  const reply = o => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  if (action === "authSource") {
    const actionPart = q.slice(q.indexOf("&action="));
    assert.equal(sign, sha1(salt + sha1(PASS) + actionPart), "auth signature");
    assert.equal(params.get("usr"), USER);
    return reply({ err: 0, desc: "ERR_NONE", dat: { secret: SECRET, token: TOKEN, expire: 604800 } });
  }
  assert.equal(params.get("token"), TOKEN);
  const actionPart = q.slice(q.indexOf("&action="));
  assert.equal(sign, sha1(salt + SECRET + TOKEN + actionPart), "call signature for " + action);
  if (action === "webQueryDeviceEs")
    return reply({ err: 0, desc: "ERR_NONE", dat: { total: 1, device: [{ devalias: "PIP-MAX 11KW", sn: "96342207100417", status: 0, pn: "W0012345678901", devaddr: 1, devcode: 2451 }] } });
  if (action === "querySPDeviceLastData")
    return reply({ err: 0, desc: "ERR_NONE", dat: { gts: "2026-11-09 15:05:00", pars: {
      gd_: [{ id: "gd_grid_voltage", par: "Grid Voltage", val: "231.2", unit: "V" }, { par: "Grid Frequency", val: "50.01", unit: "Hz" }],
      pv_: [{ par: "PV1 Input Voltage", val: "356.1", unit: "V" }, { par: "PV1 Charging Power", val: "1820", unit: "W" }, { par: "PV2 Input Voltage", val: "349.0", unit: "V" }, { par: "PV2 Charging Power", val: "1640", unit: "W" }],
      bt_: [{ par: "Battery Voltage", val: "53.40", unit: "V" }, { par: "Battery Capacity", val: "76", unit: "%" }, { par: "Battery Charging Current", val: "40", unit: "A" }, { par: "Battery Discharge Current", val: "0", unit: "A" }],
      bc_: [{ par: "AC Output Voltage", val: "230.0", unit: "V" }, { par: "AC Output Frequency", val: "50.0", unit: "Hz" }, { par: "AC Output Active Power", val: "1290", unit: "W" }, { par: "Output Load Percent", val: "12", unit: "%" }],
      sy_: [{ par: "Working State", val: "Line Mode", unit: "" }, { par: "Inverter Heat Sink Temperature", val: "41", unit: "°C" }],
    } } });
  if (action === "webQueryDeviceEnergyFlowEs")
    return reply({ err: 0, desc: "ERR_NONE", dat: { pv_status: [{ par: "pv_output_power", val: "3.4600", unit: "kW", status: 1 }], bc_status: [{ par: "load_active_power", val: "1.2900", unit: "kW" }], gd_status: [{ par: "grid_active_power", val: "0.0000", unit: "kW" }], bt_status: [{ par: "bt_battery_capacity", val: "76", unit: "%" }] } });
  if (action === "querySPDeviceKeyParameterOneDay") {
    const name = params.get("parameter");
    if (name === "GRID_ACTIVE_POWER") return reply({ err: 0x0102, desc: "ERR_NO_RECORD" });
    return reply({ err: 0, desc: "ERR_NONE", dat: { parameter: name, unit: "kW", detail: [
      { ts: "2026-11-09 09:00:00", val: "1.2" }, { ts: "2026-11-09 12:00:00", val: "4.1" }, { ts: "2026-11-09 15:00:00", val: "2.0" } ] } });
  }
  throw new Error("unexpected " + action);
};

const env = { DESS_USER: USER, DESS_PASS: PASS, APP_PIN: "4821" };
const get = (path, pin) => worker.fetch(new Request("https://nicuinvertor.example.workers.dev" + path, { headers: pin ? { "x-pin": pin } : {} }), env);

let r = await get("/api/ping"); assert.deepEqual(await r.json(), { app: "nicuinvertor", configured: true });
r = await get("/api/live"); assert.equal(r.status, 401, "no pin");
r = await get("/api/live", "0000"); assert.equal(r.status, 401, "wrong pin");
r = await get("/api/live?tz=-120", "4821"); assert.equal(r.status, 200);
const live = await r.json();
console.log(JSON.stringify({ ...live, params: live.params.length + " params" }, null, 1));
assert.equal(live.pv.power, 3460);
assert.equal(live.load.power, 1290);
assert.equal(live.battery.soc, 76);
assert.ok(Math.abs(live.battery.power - 53.4 * 40) < 0.01);
assert.equal(live.grid.present, true);
assert.equal(live.mode, "Line Mode");
assert.equal(live.pv.strings.length, 2);
assert.equal(new Date(live.ts).toISOString(), "2026-11-09T13:05:00.000Z", "15:05 Bucharest = 13:05 UTC");
r = await get("/api/day?date=2026-11-09&tz=-120", "4821"); const day = await r.json();
assert.equal(day.pv.length, 3); assert.equal(day.pv[1][1], 4100); assert.equal(day.grid.length, 0);
r = await get("/", null); const html = await r.text(); assert.ok(html.startsWith("<!DOCTYPE html>") && html.includes("NicuInvertor"));
console.log("calls:", calls.join(", "));
console.log("ALL TESTS PASSED");
