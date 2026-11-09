import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync(new URL("./src/index.html", import.meta.url), "utf8");
const tpl = readFileSync(new URL("./src/worker.template.js", import.meta.url), "utf8");
const out = tpl.replace("__APP_HTML__", () => JSON.stringify(html).replace(/<\/script/gi, "<\\/script"));
writeFileSync(new URL("./worker.js", import.meta.url), out);
console.log("worker.js", (out.length / 1024).toFixed(1), "KB");
