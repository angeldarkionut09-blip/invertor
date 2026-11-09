# NicuInvertor

Aplicație de monitorizare pentru invertorul solar **MPP Solar PIP-MAX 11 kW**: flux de energie în timp real, baterie și autonomie, grafice pe zile, toți parametrii invertorului. Merge de oriunde, pe telefon și pe calculator, și se deschide cu PIN.

## Ghid de instalare

Durează cam 15 minute. Ai nevoie de telefon, de parola Wi-Fi a casei și de un cont gratuit Cloudflare.

## Cum funcționează

```
Invertor PIP-MAX ─Wi-Fi─► Cloud DessMonitor ◄── Serverul NicuInvertor (Cloudflare, gratuit) ◄── Telefonul tău, de oriunde
```

Modulul Wi-Fi al invertorului trimite datele în cloud-ul producătorului (DessMonitor). Serverul NicuInvertor le citește de acolo cu contul tău și le arată în aplicație. Parola contului stă doar pe server. Aplicația se deschide cu un PIN.

---

## Partea 1: Conectează invertorul la Wi-Fi

1. **Instalează Energy-Mate** din App Store sau Google Play (aplicația oficială MPP Solar, care înlocuiește WatchPower și SolarPower). Fă-ți cont și ține minte e-mailul și parola.
2. **Pornește invertorul** și uită-te la modulul Wi-Fi încorporat. Pe etichetă găsești **PN**-ul (14 caractere, de exemplu `W0012345678901`) și un cod QR.
3. În Energy-Mate apasă **+ / Adaugă dispozitiv**, apoi scanează QR-ul sau scrie PN-ul.
4. Când aplicația îți cere, **conectează telefonul la rețeaua Wi-Fi a invertorului** (are de obicei PN-ul în nume). Parola implicită e scrisă în manualul modulului; adesea este `12345678`.
5. **Alege rețeaua Wi-Fi a casei** și scrie parola ei.
   * Modulul merge doar pe **2,4 GHz**. Dacă routerul are o singură rețea pentru 2,4 și 5 GHz, activează o rețea separată de 2,4 GHz.
   * Evită diacriticele și caracterele speciale în numele rețelei.
6. După 1–5 minute invertorul apare **online** în Energy-Mate.
7. **Verifică pe calculator:** intră pe [dessmonitor.com](https://www.dessmonitor.com) cu **același cont**. Dacă vezi invertorul acolo, NicuInvertor îl poate citi.

> Dacă dessmonitor.com nu-ți acceptă contul de Energy-Mate, scrie-mi ce mesaj apare. Rezolvăm din setările serverului.

---

## Partea 2: Pornește serverul NicuInvertor (Cloudflare, gratuit)

1. Fă-ți cont pe [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). Nu îți cere card.
2. În meniu: **Compute (Workers) → Workers & Pages → Create → Start with Hello World** (sau **Create Worker**).
3. Dă-i un nume, de exemplu `nicuinvertor`, și apasă **Deploy**.
4. Apasă **Edit code**, șterge tot ce e acolo, **lipește conținutul fișierului [`worker.js`](worker.js) din acest repository** și apasă **Deploy**.
5. Mergi la **Settings → Variables and Secrets → Add** și adaugă:

| Nume | Tip | Ce pui |
|---|---|---|
| `DESS_USER` | Text | e-mailul / utilizatorul contului Energy-Mate |
| `DESS_PASS` | **Secret** | parola contului Energy-Mate |
| `APP_PIN` | **Secret** | un PIN ales de tine, de exemplu 6 cifre |

   Opționale: `DEVICE_SN` (seria invertorului, dacă ai mai multe dispozitive în cont).

6. Apasă **Deploy** din nou. Adresa ta va fi de forma `https://nicuinvertor.<numele-tău>.workers.dev`.

---

## Partea 3: Pune aplicația pe telefon

1. Deschide adresa de mai sus pe telefon și scrie PIN-ul.
2. **iPhone:** Safari → Share → **Add to Home Screen**. **Android:** Chrome → ⋮ → **Add to Home screen / Install app**.
3. NicuInvertor se deschide acum ca o aplicație, pe ecran complet, de oriunde ai internet.

În **Setări** trece capacitatea reală a bateriei (kWh) și prețul energiei, ca autonomia și economia să fie corecte.

---

## Dacă ceva nu merge

| Ce vezi | Ce faci |
|---|---|
| „Autentificare respinsă de DessMonitor” | Verifică `DESS_USER` / `DESS_PASS` și că poți intra pe dessmonitor.com cu ele. |
| „Nu am găsit niciun invertor în cont” | Invertorul nu e încă adăugat în Energy-Mate (Partea 1). |
| „Invertor offline” | Modulul Wi-Fi nu mai trimite date: verifică routerul și semnalul în camera invertorului. |
| Unele valori apar „—” | Deschide `adresa-ta/api/raw` cu PIN-ul (în aplicație) sau trimite-mi o captură din tabul **Detalii**, ca să potrivesc numele parametrilor. |

Datele vin din cloud cam o dată la 5 minute. Asta e viteza standard a modulului Wi-Fi; aplicația se reîmprospătează singură la 30 de secunde.

---

## Pentru dezvoltatori

| Fișier | Ce conține |
|---|---|
| `worker.js` | Fișierul final pentru Cloudflare: aplicația + serverul. **Generat**, nu-l edita direct. |
| `src/index.html` | Interfața aplicației (HTML/CSS/JS, fără dependențe). Deschisă singură, rulează în mod demonstrativ. |
| `src/worker.template.js` | Serverul: autentificarea semnată la DessMonitor, citirea datelor, PIN-ul. |
| `build.mjs` | Pune `src/index.html` în `src/worker.template.js` și scrie `worker.js`. |
| `test/test.mjs` | Teste cu un cloud DessMonitor simulat, care verifică fiecare semnătură. |
| `test/serve.mjs` | Server local pe portul 8787, cu date simulate (PIN `4821`). |
| `wrangler.toml` | Configurare pentru publicarea automată din GitHub în Cloudflare. |

```bash
node build.mjs        # regenerează worker.js după o modificare în src/
node test/test.mjs    # rulează testele
node test/serve.mjs   # previzualizare locală: http://localhost:8787
```

Necesită Node.js 18 sau mai nou.

### Publicare automată din GitHub (opțional)

În loc să lipești `worker.js` de mână, poți lega worker-ul de acest repository: în Cloudflare, **Workers & Pages → Create → Import a repository**, alegi `invertor`. La fiecare `git push`, Cloudflare publică singur versiunea nouă. Variabilele `DESS_USER`, `DESS_PASS` și `APP_PIN` se pun tot din **Settings → Variables and Secrets**. Nu le scrie niciodată în cod sau în `wrangler.toml`.
