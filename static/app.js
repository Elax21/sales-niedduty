/* ============================================================
   Niedduty Sales. Einzelseiten-App ohne Framework.
   Alles, was von Nutzern kommt, landet per textContent im DOM,
   nie per innerHTML.
   ============================================================ */

const STUFEN = [
  ['idee', 'Idee'], ['kontakt', 'Kontaktiert'], ['gespraech', 'Gespräch'],
  ['angebot', 'Angebot'], ['gewonnen', 'Gewonnen'], ['verloren', 'Verloren'],
];
const STUFE_NAME = Object.fromEntries(STUFEN);
const ENTWURF = { fehlt: ['fehlt', 'rot'], in_arbeit: ['in Arbeit', ''], fertig: ['fertig', 'blau'], verschickt: ['verschickt', 'gruen'] };
const entwurfChip = (s) => h('span', { class: 'chip' + (ENTWURF[s][1] ? ' chip--' + ENTWURF[s][1] : '') }, 'Entwurf ' + ENTWURF[s][0]);
const STATUS = { entwurf: ['Entwurf', ''], gestellt: ['Gestellt', 'blau'], bezahlt: ['Bezahlt', 'gruen'], storniert: ['Storniert', 'rot'] };

// Häufige Positionen, ein Klick fügt sie ein
const BAUSTEINE = [
  { titel: 'Konzept und Gestaltung', beschreibung: 'Seitenstruktur, Gestaltung für Handy und Computer', menge: 1, einheit: 'pauschal', preis: 900 },
  { titel: 'Umsetzung der Seiten', beschreibung: '', menge: 8, einheit: 'Seiten', preis: 250 },
  { titel: 'Texte und Referenzen', beschreibung: 'Vorhandene Texte gekürzt und geordnet, Referenzgalerie', menge: 1, einheit: 'pauschal', preis: 500 },
  { titel: 'Anfrageformular', beschreibung: 'Formular, Ablage auf dem Server, Benachrichtigung, Spamschutz', menge: 1, einheit: 'pauschal', preis: 500 },
  { titel: 'Umzug der Website', beschreibung: 'Domain, Weiterleitungen der alten Adressen', menge: 1, einheit: 'pauschal', preis: 400 },
  { titel: 'Umzug der E-Mail-Postfächer', beschreibung: 'Einrichtung beim neuen Anbieter, Übernahme der Mails', menge: 1, einheit: 'pauschal', preis: 300 },
  { titel: 'Rechtstexte, Tests und Livegang', beschreibung: 'Impressum und Datenschutz eingebunden, Tests', menge: 1, einheit: 'pauschal', preis: 300 },
  { titel: 'Betreuung', beschreibung: 'Hosting, Updates, Backups, Postfächer, bis 1 Stunde Änderungen', menge: 1, einheit: 'Monat', preis: 79 },
  { titel: 'Arbeitszeit', beschreibung: '', menge: 1, einheit: 'Std.', preis: 70 },
];

const app = document.getElementById('app');
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const zahl = (x) => euro.format(+x || 0);
const datum = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const heute = () => new Date().toISOString().slice(0, 10);

// ---------- DOM-Helfer ----------
function h(tag, attrs = {}, ...kinder) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'style') el.style.cssText = v;   // CSP erlaubt keine style-Attribute, CSSOM schon
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kinder.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function fuellen(el, ...kinder) {
  el.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && k !== false && k !== ''));
}
const svg = (pfad) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', pfad); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.append(p); return s;
};
const ICON = {
  uebersicht: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z',
  firmen: 'M4 20V6l8-3 8 3v14M9 20v-5h6v5M8 9h1M15 9h1M8 12h1M15 12h1',
  belege: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  einstellungen: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .3-1.5-1.5L17 5l-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.3L7.5 17 7 19l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .3 1-3z',
};

// ---------- API ----------
async function api(methode, pfad, daten) {
  const r = await fetch('/api/' + pfad, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-Niedduty': '1' },
    body: daten ? JSON.stringify(daten) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && pfad !== 'login') { zeigeLogin(); throw new Error('abgemeldet'); }
  if (!r.ok) throw new Error(j.fehler || 'Fehler');
  return j;
}

// ---------- Rahmen ----------
function rahmen(aktiv, ...inhalt) {
  const nav = [['uebersicht', 'Übersicht'], ['pipeline', 'Pipeline'], ['firmen', 'Firmen'], ['belege', 'Belege'], ['einstellungen', 'Einstellungen']];
  app.replaceChildren(h('div', { class: 'rahmen' },
    h('aside', { class: 'leiste' },
      h('a', { class: 'marke', href: '#/uebersicht' }, h('img', { src: '/logo/zeichen-64.svg', alt: '' }), 'Sales'),
      h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' },
        nav.map(([id, name]) => h('a', { href: '#/' + id, 'aria-current': aktiv === id ? 'page' : false }, svg(ICON[id]), name))),
      h('div', { class: 'unten' }, h('button', { class: 'btn btn--leise', onclick: abmelden }, 'Abmelden'))),
    h('main', { class: 'inhalt' }, ...inhalt)));
  window.scrollTo(0, 0);
}
const kopf = (titel, unter, ...aktionen) => h('div', { class: 'kopfzeile' },
  h('div', {}, h('h1', {}, titel), unter ? h('p', { class: 'dim' }, unter) : null),
  h('div', { class: 'aktionen' }, ...aktionen));

async function abmelden() { await api('POST', 'logout').catch(() => {}); zeigeLogin(); }

function zeigeLogin() {
  const meldung = h('p', { class: 'meldung', role: 'alert' });
  const feld = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  app.replaceChildren(h('div', { class: 'anmeldung' },
    h('form', { class: 'karte', onsubmit: async (e) => {
      e.preventDefault(); meldung.textContent = '';
      try { await api('POST', 'login', { passwort: feld.value }); location.hash = '#/uebersicht'; route(); }
      catch (err) { meldung.textContent = err.message; feld.select(); }
    } },
      h('img', { src: '/logo/wortmarke-hell.svg', alt: 'Niedduty' }),
      h('h1', {}, 'Sales'),
      h('div', { class: 'feld' }, h('label', { for: 'pw' }, 'Passwort'), feld),
      meldung,
      h('button', { class: 'btn btn--voll', type: 'submit' }, 'Anmelden'))));
  feld.focus();
}

// ---------- Übersicht ----------
async function seiteUebersicht() {
  const u = await api('GET', 'uebersicht');
  const anteil = Math.min(100, (u.umsatz_jahr / (u.grenze || 1)) * 100);
  const eintrag = (f) => h('li', {},
    h('a', { href: '#/firmen/' + f.id }, f.name),
    h('span', { class: 'dim', style: false }, f.naechster_schritt || STUFE_NAME[f.stufe], ' · ',
      h('span', { class: f.faellig_am < heute() ? 'ueberfaellig mono' : 'mono' }, datum(f.faellig_am))));
  rahmen('uebersicht',
    kopf('Übersicht', new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
      h('a', { class: 'btn btn--voll', href: '#/firmen/neu' }, 'Neue Firma')),
    h('div', { class: 'raster raster--4' },
      h('div', { class: 'karte kennzahl' }, h('h3', {}, `Umsatz ${u.jahr}`), h('p', { class: 'wert' }, zahl(u.umsatz_jahr)),
        h('div', { class: 'balken' + (anteil > 85 ? ' warn' : '') }, h('i', { style: `width:${anteil}%` })),
        h('p', { class: 'klein' }, `${Math.round(anteil)} % der Kleinunternehmer-Grenze (${zahl(u.grenze)}), bezahlte Rechnungen`)),
      h('div', { class: 'karte kennzahl' }, h('h3', {}, 'Offene Rechnungen'), h('p', { class: 'wert' }, zahl(u.offene_rechnungen)),
        h('p', { class: 'klein' }, 'gestellt, noch nicht bezahlt')),
      h('div', { class: 'karte kennzahl' }, h('h3', {}, 'In Aussicht'), h('p', { class: 'wert' }, zahl(u.pipeline_einmalig)),
        h('p', { class: 'klein' }, `plus ${zahl(u.pipeline_monatlich)} monatlich, Gespräch und Angebot`)),
      h('div', { class: 'karte kennzahl' }, h('h3', {}, 'Betreuung'), h('p', { class: 'wert' }, zahl(u.monatlich)),
        h('p', { class: 'klein' }, 'pro Monat, gewonnene Kunden'))),
    h('div', { class: 'raster raster--2', style: 'margin-top:14px' },
      h('div', { class: 'karte' }, h('h2', {}, 'Heute fällig'),
        u.faellig.length ? h('ul', { class: 'liste' }, u.faellig.map(eintrag)) : h('p', { class: 'leer' }, 'Nichts fällig.')),
      h('div', { class: 'karte' }, h('h2', {}, 'Nächste 7 Tage'),
        u.bald.length ? h('ul', { class: 'liste' }, u.bald.map(eintrag)) : h('p', { class: 'leer' }, 'Nichts geplant.'))),
    u.boni.length ? h('div', { class: 'karte', style: 'margin-top:14px' }, h('h2', {}, 'Empfehlungsbonus fällig'),
      h('p', { class: 'dim', style: 'font-size:.88rem' }, 'Empfohlene Firmen, die Kunde geworden sind.'),
      h('ul', { class: 'liste' }, u.boni.map((x) => h('li', {},
        h('span', {}, h('a', { href: '#/firmen/' + x.von_id }, x.von), h('span', { class: 'dim' }, ' hat '), h('a', { href: '#/firmen/' + x.id }, x.name), h('span', { class: 'dim' }, ' gebracht')),
        h('button', { class: 'btn', onclick: async () => { await api('PUT', 'firmen/' + x.id, { bonus_erledigt: 1 }); seiteUebersicht(); } }, 'Erledigt'))))) : null,
    h('div', { class: 'karte', style: 'margin-top:14px' }, h('h2', {}, 'Entwürfe offen'),
      h('p', { class: 'dim', style: 'font-size:.88rem' }, 'Firmen im Gespräch, für die noch kein Entwurf fertig ist.'),
      u.entwuerfe_offen.length ? h('ul', { class: 'liste' }, u.entwuerfe_offen.map((f) => h('li', {},
        h('a', { href: '#/firmen/' + f.id }, f.name), h('span', {}, h('span', { class: 'dim' }, STUFE_NAME[f.stufe], ' · '), entwurfChip(f.entwurf_status)))))
        : h('p', { class: 'leer' }, 'Alles erledigt.')),
    h('div', { class: 'karte', style: 'margin-top:14px' }, h('h2', {}, 'Pipeline'),
      h('ul', { class: 'liste' }, STUFEN.map(([id, name]) =>
        h('li', {}, h('a', { href: '#/pipeline' }, name), h('span', { class: 'mono' }, u.stufen[id] || 0))))));
}

// ---------- Pipeline ----------
async function seitePipeline() {
  const firmen = await api('GET', 'firmen');
  const spalten = STUFEN.map(([id, name]) => {
    const drin = firmen.filter((f) => f.stufe === id);
    const wert = drin.reduce((s, f) => s + (+f.wert_einmalig || 0), 0);
    const spalte = h('section', { class: 'spalte', 'data-stufe': id },
      h('h3', {}, `${name} (${drin.length})`, wert ? h('span', { class: 'summe' }, zahl(wert)) : null),
      drin.map((f) => h('a', {
        class: 'kachel', href: '#/firmen/' + f.id, draggable: 'true',
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', f.id); },
      },
        h('b', {}, f.name),
        f.naechster_schritt ? h('p', { class: 'schritt' }, f.naechster_schritt) : null,
        h('div', { class: 'fuss' },
          h('span', { class: f.faellig_am && f.faellig_am < heute() ? 'ueberfaellig mono' : 'mono' }, datum(f.faellig_am)),
          h('span', { class: 'mono' }, f.wert_einmalig ? zahl(f.wert_einmalig) : '')))));
    spalte.addEventListener('dragover', (e) => { e.preventDefault(); spalte.classList.add('ziel'); });
    spalte.addEventListener('dragleave', () => spalte.classList.remove('ziel'));
    spalte.addEventListener('drop', async (e) => {
      e.preventDefault(); spalte.classList.remove('ziel');
      await api('PUT', 'firmen/' + e.dataTransfer.getData('text/plain'), { stufe: id });
      seitePipeline();
    });
    return spalte;
  });
  rahmen('pipeline',
    kopf('Pipeline', 'Karten zwischen den Spalten verschieben. Auf dem Handy die Stufe in der Firma ändern.',
      h('a', { class: 'btn btn--voll', href: '#/firmen/neu' }, 'Neue Firma')),
    h('div', { class: 'pipeline' }, spalten));
}

// ---------- Firmen ----------
async function seiteFirmen() {
  const firmen = await api('GET', 'firmen');
  const koerper = h('tbody');
  const zeichnen = (q = '') => {
    const s = q.toLowerCase();
    koerper.replaceChildren(...firmen
      .filter((f) => !s || [f.name, f.ansprechpartner, f.plz_ort, f.branche].join(' ').toLowerCase().includes(s))
      .map((f) => h('tr', { class: 'klickbar', onclick: () => { location.hash = '#/firmen/' + f.id; } },
        h('td', {}, h('b', {}, f.name), h('div', { class: 'dim' }, f.ansprechpartner)),
        h('td', { class: 'weg' }, f.plz_ort),
        h('td', {}, h('span', { class: 'chip' + (f.stufe === 'gewonnen' ? ' chip--gruen' : f.stufe === 'verloren' ? ' chip--rot' : '') }, STUFE_NAME[f.stufe])),
        h('td', { class: 'weg' }, f.entwurf_link ? h('a', { href: f.entwurf_link, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, entwurfChip(f.entwurf_status)) : entwurfChip(f.entwurf_status)),
        h('td', { class: 'weg' }, f.naechster_schritt, f.faellig_am ? h('div', { class: 'mono dim' }, datum(f.faellig_am)) : null))));
    if (!koerper.children.length) koerper.append(h('tr', {}, h('td', { colspan: 5, class: 'leer' }, 'Keine Firma gefunden.')));
  };
  zeichnen();
  rahmen('firmen',
    kopf('Firmen', `${firmen.length} insgesamt`, h('a', { class: 'btn btn--voll', href: '#/firmen/neu' }, 'Neue Firma')),
    h('div', { class: 'feld suche', style: 'margin-bottom:16px' },
      h('input', { type: 'search', placeholder: 'Suchen: Name, Ort, Branche …', 'aria-label': 'Firmen suchen', oninput: (e) => zeichnen(e.target.value) })),
    h('div', { class: 'karte' }, h('table', { class: 'tabelle' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Firma'), h('th', { class: 'weg' }, 'Ort'), h('th', {}, 'Stufe'), h('th', { class: 'weg' }, 'Entwurf'), h('th', { class: 'weg' }, 'Nächster Schritt'))),
      koerper)));
}

const FELDER = [
  ['name', 'Firma'], ['ansprechpartner', 'Ansprechpartner'], ['telefon', 'Telefon', 'tel'], ['email', 'E-Mail', 'email'],
  ['website', 'Website'], ['strasse', 'Straße'], ['plz_ort', 'PLZ und Ort'], ['branche', 'Branche'],
  ['quelle', 'Quelle (wie gefunden)'], ['empfohlen_von', 'Empfohlen von (Person)'],
  ['wert_einmalig', 'Wert einmalig (€)', 'number'], ['wert_monatlich', 'Wert monatlich (€)', 'number'],
];

async function seiteFirma(id) {
  const neu = id === 'neu';
  const [f, alle] = await Promise.all([
    neu ? { stufe: 'idee', verlauf: [], belege: [], dateien: [], empfehlungen: [] } : api('GET', 'firmen/' + id),
    api('GET', 'firmen')]);
  const status = h('p', { class: 'gespeichert', 'aria-live': 'polite' });
  const speichern = async (daten) => {
    if (neu) return;
    try { await api('PUT', 'firmen/' + id, daten); status.textContent = 'Gespeichert'; setTimeout(() => { status.textContent = ''; }, 1500); }
    catch (e) { status.textContent = e.message; }
  };
  const eingabe = (k, name, typ = 'text') => h('div', { class: 'feld' },
    h('label', { for: 'f-' + k }, name),
    h('input', { id: 'f-' + k, name: k, type: typ, step: typ === 'number' ? '0.01' : false, value: f[k] ?? '',
      onchange: (e) => speichern({ [k]: e.target.value }) }));

  const form = h('form', { class: 'karte', onsubmit: async (e) => {
    e.preventDefault();
    if (!neu) return;   // Bestehende Firmen speichern Feld für Feld
    const d = Object.fromEntries(new FormData(e.target));
    try { const n = await api('POST', 'firmen', d); location.hash = '#/firmen/' + n.id; }
    catch (err) { status.textContent = err.message; }
  } },
    h('div', { class: 'felder' }, FELDER.map(([k, n, t]) => eingabe(k, n, t))),
    h('div', { class: 'felder', style: 'margin-top:12px' },
      h('div', { class: 'feld' }, h('label', { for: 'f-stufe' }, 'Stufe'),
        h('select', { id: 'f-stufe', name: 'stufe', onchange: (e) => speichern({ stufe: e.target.value }) },
          STUFEN.map(([v, n]) => h('option', { value: v, selected: f.stufe === v }, n)))),
      eingabe('naechster_schritt', 'Nächster Schritt'),
      h('div', { class: 'feld' }, h('label', { for: 'f-empfohlen_von_id' }, 'Empfohlen von (Firma)'),
        h('select', { id: 'f-empfohlen_von_id', name: 'empfohlen_von_id', onchange: (e) => speichern({ empfohlen_von_id: e.target.value }) },
          h('option', { value: '' }, '—'),
          alle.filter((x) => String(x.id) !== String(id)).map((x) => h('option', { value: x.id, selected: f.empfohlen_von_id === x.id }, x.name)))),
      eingabe('faellig_am', 'Fällig am', 'date')),
    h('div', { class: 'feld', style: 'margin-top:12px' }, h('label', { for: 'f-notiz' }, 'Notiz'),
      h('textarea', { id: 'f-notiz', name: 'notiz', onchange: (e) => speichern({ notiz: e.target.value }) }, f.notiz || '')),
    neu ? h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn btn--voll', type: 'submit' }, 'Anlegen')) : null,
    status);

  const aktionen = neu ? [] : [
    f.telefon ? h('a', { class: 'btn', href: 'tel:' + f.telefon.replace(/[^\d+]/g, '') }, 'Anrufen') : null,
    h('button', { class: 'btn', onclick: () => belegAnlegen('angebot', f.id) }, 'Angebot'),
    h('button', { class: 'btn btn--voll', onclick: () => belegAnlegen('rechnung', f.id) }, 'Rechnung'),
  ];

  const notiz = h('textarea', { placeholder: 'Was ist passiert? Anruf, Treffen, Zusage …', 'aria-label': 'Neue Notiz' });
  const rechts = neu ? null : h('div', { class: 'raster' },
    h('div', { class: 'karte' }, h('h2', {}, 'Verlauf'),
      h('form', { class: 'feld', style: 'margin-top:10px', onsubmit: async (e) => {
        e.preventDefault(); if (!notiz.value.trim()) return;
        await api('POST', `firmen/${id}/verlauf`, { text: notiz.value }); seiteFirma(id);
      } }, notiz, h('button', { class: 'btn', type: 'submit', style: 'justify-self:start' }, 'Notiz speichern')),
      h('ul', { class: 'verlauf' }, f.verlauf.map((v) => h('li', {}, h('time', { datetime: v.zeit }, datum(v.zeit)), h('p', {}, v.text))))),
    h('div', { class: 'karte' }, h('h2', {}, 'Empfehlungen'),
      f.empfohlen_von_name ? h('p', { class: 'dim', style: 'margin-top:4px' }, 'Selbst empfohlen von ', h('a', { href: '#/firmen/' + f.empfohlen_von_id }, f.empfohlen_von_name)) : null,
      f.empfehlungen.length ? h('ul', { class: 'liste' }, f.empfehlungen.map((x) => h('li', {},
        h('a', { href: '#/firmen/' + x.id }, x.name),
        x.stufe !== 'gewonnen' ? h('span', { class: 'chip' }, STUFE_NAME[x.stufe])
          : x.bonus_erledigt ? h('span', { class: 'chip chip--gruen' }, 'Bonus erledigt')
          : h('button', { class: 'btn', onclick: async () => { await api('PUT', 'firmen/' + x.id, { bonus_erledigt: 1 }); seiteFirma(id); } }, 'Bonus fällig · erledigt?'))))
        : h('p', { class: 'leer' }, 'Hat noch niemanden empfohlen.')),
    (() => {
      const neuFeld = (k, platz) => h('input', { name: k, placeholder: platz, 'aria-label': platz });
      const formular = h('form', { class: 'zugang-neu', hidden: true, onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', `firmen/${id}/zugaenge`, Object.fromEntries(new FormData(e.target))); seiteFirma(id); }
        catch (err) { alert(err.message); }
      } },
        neuFeld('dienst', 'Dienst (z. B. INWX)'), neuFeld('konto', 'Konto / Kundennummer'),
        neuFeld('url', 'Login-Adresse'), neuFeld('ablage', 'Passwort liegt in … (z. B. Bitwarden)'),
        neuFeld('notiz', 'Notiz'),
        h('button', { class: 'btn btn--voll', type: 'submit' }, 'Speichern'));
      return h('div', { class: 'karte raster' }, h('h2', {}, 'Zugänge'),
        h('p', { class: 'dim', style: 'font-size:.86rem' }, 'Welche Konten du für diese Firma betreust. Passwörter gehören in einen Passwort-Manager, nicht hierher.'),
        f.zugaenge.length ? h('ul', { class: 'liste' }, f.zugaenge.map((z) => h('li', {},
          h('div', {}, h('b', {}, z.url ? h('a', { href: z.url, target: '_blank', rel: 'noopener' }, z.dienst + ' ↗') : z.dienst),
            h('div', { class: 'dim', style: 'font-size:.86rem' }, [z.konto, z.ablage && 'Passwort: ' + z.ablage, z.notiz].filter(Boolean).join(' · '))),
          h('button', { class: 'btn btn--leise', 'aria-label': 'Zugang löschen', onclick: async () => {
            if (!confirm(`Zugang „${z.dienst}“ löschen?`)) return; await api('DELETE', 'zugaenge/' + z.id); seiteFirma(id);
          } }, '×'))))
          : h('p', { class: 'leer' }, 'Noch keine eingetragen.'),
        formular,
        h('button', { class: 'btn', style: 'justify-self:start', onclick: (e) => { formular.hidden = false; e.target.hidden = true; formular.querySelector('input').focus(); } }, '+ Zugang eintragen'));
    })(),
    h('div', { class: 'karte raster' }, h('h2', {}, 'Entwurf'),
      h('div', { class: 'felder' },
        h('div', { class: 'feld' }, h('label', { for: 'f-entwurf_status' }, 'Status'),
          h('select', { id: 'f-entwurf_status', onchange: (e) => speichern({ entwurf_status: e.target.value }) },
            Object.entries(ENTWURF).map(([v, [n]]) => h('option', { value: v, selected: f.entwurf_status === v }, n)))),
        h('div', { class: 'feld' }, h('label', { for: 'f-entwurf_link' }, 'Link zum Entwurf'),
          h('input', { id: 'f-entwurf_link', type: 'url', placeholder: 'niedduty.de/fuer/…', value: f.entwurf_link || '',
            onchange: async (e) => { await speichern({ entwurf_link: e.target.value }); seiteFirma(id); } }))),
      f.entwurf_link ? h('a', { class: 'btn', href: f.entwurf_link, target: '_blank', rel: 'noopener', style: 'justify-self:start' }, 'Entwurf öffnen ↗') : null,
      h('h3', { style: 'margin-top:6px' }, 'Dateien'),
      f.dateien.length ? h('ul', { class: 'liste' }, f.dateien.map((d) => h('li', {},
        h('a', { href: '/api/dateien/' + d.id, target: '_blank', rel: 'noopener' }, d.original),
        h('span', {}, h('span', { class: 'dim mono' }, `${d.art.toUpperCase()} · ${Math.max(1, Math.round(d.groesse / 1024))} KB `),
          h('button', { class: 'btn btn--leise', 'aria-label': 'Datei löschen', onclick: async () => {
            if (!confirm(`„${d.original}“ löschen?`)) return; await api('DELETE', 'dateien/' + d.id); seiteFirma(id);
          } }, '×')))))
        : h('p', { class: 'leer' }, 'Screenshots, Mockups oder PDFs ablegen.'),
      (() => {
        const eingabe = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', multiple: true, hidden: true,
          onchange: async (e) => {
            for (const datei of e.target.files) {
              if (datei.size > 15 * 1024 * 1024) { alert(`${datei.name} ist zu groß (höchstens 15 MB).`); continue; }
              const r = await fetch(`/api/firmen/${id}/dateien`, { method: 'POST', body: datei,
                headers: { 'X-Niedduty': '1', 'X-Dateiname': encodeURIComponent(datei.name), 'Content-Type': datei.type || 'application/octet-stream' } });
              if (!r.ok) alert((await r.json().catch(() => ({}))).fehler || 'Hochladen fehlgeschlagen');
            }
            seiteFirma(id);
          } });
        return h('div', {}, eingabe, h('button', { class: 'btn', onclick: () => eingabe.click() }, 'Dateien hochladen'));
      })()),
    h('div', { class: 'karte' }, h('h2', {}, 'Belege'),
      f.belege.length ? h('ul', { class: 'liste' }, f.belege.map((b) => h('li', {},
        h('a', { href: '#/belege/' + b.id }, `${b.art === 'angebot' ? 'Angebot' : 'Rechnung'} ${b.nummer || '(Entwurf)'}`),
        h('span', {}, h('span', { class: 'mono' }, zahl(b.zahlbetrag)), ' ', statusChip(b.status)))))
        : h('p', { class: 'leer' }, 'Noch keine.')),
    h('button', { class: 'btn btn--leise btn--rot', style: 'justify-self:start', onclick: async () => {
      if (!confirm(`„${f.name}“ wirklich löschen?`)) return;
      try { await api('DELETE', 'firmen/' + id); location.hash = '#/firmen'; } catch (e) { alert(e.message); }
    } }, 'Firma löschen'));

  rahmen('firmen',
    kopf(neu ? 'Neue Firma' : f.name, neu ? null : STUFE_NAME[f.stufe], ...aktionen),
    h('div', { class: 'raster raster--2' }, form, rechts));
}

const statusChip = (s) => h('span', { class: 'chip' + (STATUS[s][1] ? ' chip--' + STATUS[s][1] : '') }, STATUS[s][0]);

async function belegAnlegen(art, firmaId, ausBeleg) {
  const b = await api('POST', 'belege', { art, firma_id: firmaId, aus_beleg: ausBeleg });
  location.hash = '#/belege/' + b.id;
}

// ---------- Belege ----------
async function seiteBelege() {
  const belege = await api('GET', 'belege');
  rahmen('belege',
    kopf('Angebote und Rechnungen', 'Neue Belege legst du in der jeweiligen Firma an.'),
    h('div', { class: 'karte' }, belege.length ? h('table', { class: 'tabelle' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Nummer'), h('th', {}, 'Firma'), h('th', { class: 'weg' }, 'Datum'), h('th', { class: 'rechts' }, 'Betrag'), h('th', {}, 'Status'))),
      h('tbody', {}, belege.map((b) => h('tr', { class: 'klickbar', onclick: () => { location.hash = '#/belege/' + b.id; } },
        h('td', {}, h('span', { class: 'mono' }, b.nummer || '—'), h('div', { class: 'dim' }, b.art === 'angebot' ? 'Angebot' : 'Rechnung')),
        h('td', {}, b.firma),
        h('td', { class: 'weg mono' }, datum(b.datum)),
        h('td', { class: 'rechts mono' }, zahl(b.zahlbetrag)),
        h('td', {}, statusChip(b.status))))))
      : h('p', { class: 'leer' }, 'Noch keine Belege. Öffne eine Firma und lege dort ein Angebot oder eine Rechnung an.')));
}

async function seiteBeleg(id) {
  const b = await api('GET', 'belege/' + id);
  const gesperrt = b.status !== 'entwurf';
  const istRechnung = b.art === 'rechnung';
  const vorschau = h('div', { class: 'a4' });
  const status = h('p', { class: 'gespeichert', 'aria-live': 'polite' });
  let timer;

  const summen = () => {
    const s = b.positionen.reduce((a, p) => a + (+p.menge || 0) * (+p.preis || 0), 0);
    return [s, s - (+b.anzahlung_betrag || 0)];
  };
  const speichern = () => {
    if (gesperrt) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await api('PUT', 'belege/' + id, {
          datum: b.datum, leistung_von: b.leistung_von, leistung_bis: b.leistung_bis, zahlbar_bis: b.zahlbar_bis,
          empfaenger: b.empfaenger, text_oben: b.text_oben, text_unten: b.text_unten,
          anzahlung_text: b.anzahlung_text, anzahlung_betrag: b.anzahlung_betrag, positionen: b.positionen,
        });
        status.textContent = 'Gespeichert';
      } catch (e) { status.textContent = e.message; }
    }, 500);
  };
  const aendern = () => { zeichneVorschau(); speichern(); };

  // -- Vorschau (A4, auch fürs Drucken)
  function zeichneVorschau() {
    const a = b.absender;
    const [summe, zahlbetrag] = summen();
    const fakten = istRechnung
      ? [['Rechnungsnummer', b.nummer || 'Entwurf'], ['Rechnungsdatum', datum(b.datum)],
        (b.leistung_von || b.leistung_bis) && ['Leistungszeitraum', [datum(b.leistung_von), datum(b.leistung_bis)].filter(Boolean).join(' – ')],
        ['Kundennummer', 'K-' + String(b.firma_id).padStart(3, '0')]]
      : [['Angebotsnummer', b.nummer || 'Entwurf'], ['Datum', datum(b.datum)], ['Gültig bis', datum(b.zahlbar_bis)],
        ['Kundennummer', 'K-' + String(b.firma_id).padStart(3, '0')]];
    const hinweise = [
      a.kleinunternehmer === '1' ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : null,
      istRechnung && b.zahlbar_bis ? `Bitte überweisen Sie den Betrag bis zum ${datum(b.zahlbar_bis)} unter Angabe der Rechnungsnummer${b.nummer ? ' ' + b.nummer : ''}.` : null,
      !istRechnung ? 'Ich freue mich auf Ihre Rückmeldung.' : null,
      b.text_unten || null,
    ].filter(Boolean).join('\n');
    fuellen(vorschau,
      h('div', { class: 'k' }, h('img', { src: '/logo/wortmarke-hell.svg', alt: 'Niedduty' }),
        h('div', { class: 'abs' }, h('b', {}, a.name), `\n${a.strasse} · ${a.plz_ort}\n${a.telefon} · ${a.email}\n${a.web}`)),
      h('div', { class: 'ans' }, h('p', { class: 'rs' }, `${a.name.split('·')[0].trim()} · ${a.strasse} · ${a.plz_ort}`), h('p', { class: 'emp' }, b.empfaenger)),
      h('div', { class: 'dat' },
        h('h1', {}, istRechnung ? (b.anzahlung_betrag ? 'Schlussrechnung' : 'Rechnung') : 'Angebot',
          b.status === 'storniert' ? h('span', { class: 'storno' }, 'STORNIERT') : null),
        h('dl', {}, fakten.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      b.text_oben ? h('p', { class: 'oben' }, b.text_oben) : null,
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { class: 'nr' }, 'Pos.'), h('th', {}, 'Leistung'), h('th', { class: 'me' }, 'Menge'), h('th', { class: 'g' }, 'Einzelpreis'), h('th', { class: 'g' }, 'Betrag'))),
        h('tbody', {}, b.positionen.map((p, i) => h('tr', {},
          h('td', { class: 'nr' }, i + 1),
          h('td', {}, p.titel, p.beschreibung ? h('small', {}, p.beschreibung) : null),
          h('td', { class: 'me' }, p.einheit === 'pauschal' ? 'pauschal' : `${String(p.menge).replace('.', ',')} ${p.einheit}`),
          h('td', { class: 'g' }, zahl(p.preis)), h('td', { class: 'g' }, zahl((+p.menge || 0) * (+p.preis || 0))))))),
      h('div', { class: 'sum' },
        b.anzahlung_betrag ? [
          h('div', {}, h('span', {}, 'Summe der Leistungen'), h('span', {}, zahl(summe))),
          h('div', { class: 'ab' }, h('span', {}, b.anzahlung_text || 'abzüglich Anzahlung'), h('span', {}, '− ' + zahl(b.anzahlung_betrag))),
        ] : null,
        h('div', { class: 'of' }, h('span', {}, istRechnung ? (b.anzahlung_betrag ? 'Offener Betrag' : 'Gesamtbetrag') : 'Angebotssumme'), h('span', {}, zahl(zahlbetrag)))),
      h('p', { class: 'hin' }, hinweise),
      h('div', { class: 'fu' },
        h('div', {}, h('b', {}, 'Niedduty'), h('br'), a.name.split('·').pop().trim(), h('br'), a.strasse, h('br'), a.plz_ort),
        h('div', {}, h('b', {}, 'Kontakt'), h('br'), a.telefon, h('br'), a.email, h('br'), a.web),
        h('div', {}, h('b', {}, 'Bank und Steuer'), h('br'), 'IBAN ', a.iban || '—', h('br'), 'Bank ', a.bank || '—', h('br'), 'Steuernr. ', a.steuernummer || '—')));
    skalieren();
  }
  function skalieren() {
    const rahmenBreite = vorschau.parentElement?.clientWidth - 28;
    const breite = 793.7; // 210 mm in px
    if (rahmenBreite > 0 && rahmenBreite < breite) {
      const f = rahmenBreite / breite;
      vorschau.style.transform = `scale(${f})`;
      vorschau.parentElement.style.height = `${1122.5 * f + 28}px`;
    } else { vorschau.style.transform = ''; vorschau.parentElement.style.height = ''; }
  }

  // -- Eingaben
  const feld = (k, name, typ = 'text', extra = {}) => h('div', { class: 'feld' }, h('label', { for: 'b-' + k }, name),
    h(typ === 'textarea' ? 'textarea' : 'input', { id: 'b-' + k, type: typ === 'textarea' ? false : typ, value: typ === 'textarea' ? false : (typ === 'number' ? (b[k] || '') : (b[k] ?? '')),
      disabled: gesperrt, ...extra, oninput: (e) => { b[k] = typ === 'number' ? +e.target.value : e.target.value; aendern(); } },
    typ === 'textarea' ? (b[k] || '') : null));

  const posListe = h('div', { class: 'positionen' });
  function zeichnePositionen() {
    posListe.replaceChildren(...b.positionen.map((p, i) => {
      const ein = (k, typ, platz, cls) => h(typ === 'textarea' ? 'textarea' : 'input', {
        class: cls || false, type: typ === 'textarea' ? false : typ, step: typ === 'number' ? '0.01' : false, placeholder: platz,
        'aria-label': platz, value: typ === 'textarea' ? false : p[k], disabled: gesperrt,
        oninput: (e) => { p[k] = typ === 'number' ? +e.target.value : e.target.value; aendern(); } }, typ === 'textarea' ? p[k] : null);
      return h('div', { class: 'position' },
        ein('titel', 'text', 'Leistung', 'titel'), ein('menge', 'number', 'Menge'), ein('einheit', 'text', 'Einheit'), ein('preis', 'number', 'Einzelpreis €'),
        gesperrt ? h('span') : h('button', { class: 'weg', type: 'button', 'aria-label': 'Position entfernen', onclick: () => { b.positionen.splice(i, 1); zeichnePositionen(); aendern(); } }, '×'),
        h('div', { class: 'voll' }, ein('beschreibung', 'textarea', 'Beschreibung (optional)')));
    }));
  }
  zeichnePositionen();
  const neuePosition = (p) => { b.positionen.push({ ...p }); zeichnePositionen(); aendern(); };

  // -- Statuswechsel
  const wechsel = async (ziel, frage) => {
    if (frage && !confirm(frage)) return;
    try { await api('POST', `belege/${id}/status`, { status: ziel }); seiteBeleg(id); } catch (e) { alert(e.message); }
  };
  const aktionen = [
    h('button', { class: 'btn', onclick: () => window.print() }, 'Drucken / PDF'),
    b.status === 'entwurf' ? h('button', { class: 'btn btn--voll', onclick: () => wechsel('gestellt',
      istRechnung ? 'Rechnung jetzt stellen? Sie bekommt ihre Nummer und lässt sich danach nicht mehr ändern.' : 'Angebot jetzt festschreiben? Es bekommt seine Nummer.') }, istRechnung ? 'Rechnung stellen' : 'Angebot festschreiben') : null,
    istRechnung && b.status === 'gestellt' ? h('button', { class: 'btn btn--voll', onclick: () => wechsel('bezahlt') }, 'Als bezahlt markieren') : null,
    istRechnung && b.status === 'bezahlt' ? h('button', { class: 'btn', onclick: () => wechsel('gestellt') }, 'Doch nicht bezahlt') : null,
    !istRechnung && b.status !== 'entwurf' ? h('button', { class: 'btn btn--voll', onclick: () => belegAnlegen('rechnung', b.firma_id, b.id) }, 'Rechnung daraus') : null,
    b.status === 'gestellt' ? h('button', { class: 'btn btn--leise btn--rot', onclick: () => wechsel('storniert', 'Beleg stornieren? Das lässt sich nicht rückgängig machen.') }, 'Stornieren') : null,
    b.status === 'entwurf' ? h('button', { class: 'btn btn--leise btn--rot', onclick: async () => {
      if (!confirm('Entwurf löschen?')) return; await api('DELETE', 'belege/' + id); location.hash = '#/firmen/' + b.firma_id;
    } }, 'Entwurf löschen') : null,
  ];

  const links = h('div', { class: 'raster' },
    gesperrt ? h('p', { class: 'karte dim' }, 'Dieser Beleg ist ', STATUS[b.status][0].toLowerCase(), ' und deshalb gesperrt. Bei einem Fehler: stornieren und neu anlegen.') : null,
    h('div', { class: 'karte raster' },
      h('div', { class: 'felder' },
        feld('datum', 'Datum', 'date'),
        feld('zahlbar_bis', istRechnung ? 'Zahlbar bis' : 'Gültig bis', 'date'),
        istRechnung ? feld('leistung_von', 'Leistung von', 'date') : null,
        istRechnung ? feld('leistung_bis', 'Leistung bis', 'date') : null),
      feld('empfaenger', 'Empfänger', 'textarea'),
      feld('text_oben', 'Text über den Positionen (optional)', 'textarea')),
    h('div', { class: 'karte raster' }, h('h2', {}, 'Positionen'),
      posListe,
      gesperrt ? null : h('div', { class: 'raster' },
        h('button', { class: 'btn', type: 'button', style: 'justify-self:start', onclick: () => neuePosition({ titel: '', beschreibung: '', menge: 1, einheit: 'pauschal', preis: 0 }) }, '+ Leere Position'),
        h('div', { class: 'bausteine', 'aria-label': 'Bausteine' }, BAUSTEINE.map((p) => h('button', { type: 'button', onclick: () => neuePosition(p) }, '+ ' + p.titel))))),
    istRechnung ? h('div', { class: 'karte felder' },
      feld('anzahlung_text', 'Anzahlung, Text', 'text', { placeholder: 'abzüglich Anzahlung (Rechnung 2026-001)' }),
      feld('anzahlung_betrag', 'Anzahlung, Betrag (€)', 'number', { step: '0.01' })) : null,
    h('div', { class: 'karte' }, feld('text_unten', 'Zusätzlicher Hinweis unten (optional)', 'textarea')),
    status);

  const titel = `${istRechnung ? 'Rechnung' : 'Angebot'} ${b.nummer || '(Entwurf)'}`;
  rahmen('belege',
    kopf(titel, b.firma ? b.firma.name : null, statusChip(b.status), ...aktionen),
    h('div', { class: 'editor' }, links, h('div', { class: 'vorschau-rahmen' }, vorschau)));
  zeichneVorschau();
  addEventListener('resize', skalieren, { once: true });
}

// ---------- Einstellungen ----------
async function seiteEinstellungen() {
  const e = await api('GET', 'einstellungen');
  const status = h('p', { class: 'gespeichert', 'aria-live': 'polite' });
  const felder = [['name', 'Name auf Belegen'], ['strasse', 'Straße'], ['plz_ort', 'PLZ und Ort'], ['telefon', 'Telefon'],
    ['email', 'E-Mail'], ['web', 'Website'], ['iban', 'IBAN'], ['bank', 'Bank'], ['steuernummer', 'Steuernummer'],
    ['zahlungsziel_tage', 'Zahlungsziel (Tage)'], ['umsatzgrenze', 'Umsatzgrenze Kleinunternehmer (€)']];
  rahmen('einstellungen',
    kopf('Einstellungen', 'Diese Angaben stehen auf deinen Angeboten und Rechnungen.'),
    h('form', { class: 'karte raster', onsubmit: async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      d.kleinunternehmer = ev.target.kleinunternehmer.checked ? '1' : '0';
      try { await api('PUT', 'einstellungen', d); status.textContent = 'Gespeichert'; } catch (err) { status.textContent = err.message; }
    } },
      h('div', { class: 'felder' }, felder.map(([k, n]) => h('div', { class: 'feld' }, h('label', { for: 'e-' + k }, n),
        h('input', { id: 'e-' + k, name: k, value: e[k] || '' })))),
      h('label', { style: 'display:flex;gap:8px;align-items:center' },
        h('input', { type: 'checkbox', name: 'kleinunternehmer', checked: e.kleinunternehmer === '1' }),
        'Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer, Hinweis auf jedem Beleg)'),
      h('button', { class: 'btn btn--voll', type: 'submit', style: 'justify-self:start' }, 'Speichern'),
      status),
    h('div', { style: 'margin-top:20px' }, h('button', { class: 'btn', onclick: abmelden }, 'Abmelden')));
}

// ---------- Router ----------
async function route() {
  const teile = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (teile[0] === 'pipeline') await seitePipeline();
    else if (teile[0] === 'firmen' && teile[1]) await seiteFirma(teile[1]);
    else if (teile[0] === 'firmen') await seiteFirmen();
    else if (teile[0] === 'belege' && teile[1]) await seiteBeleg(teile[1]);
    else if (teile[0] === 'belege') await seiteBelege();
    else if (teile[0] === 'einstellungen') await seiteEinstellungen();
    else await seiteUebersicht();
  } catch (e) {
    if (e.message !== 'abgemeldet') app.replaceChildren(h('p', { class: 'meldung', style: 'padding:24px' }, e.message));
  }
}

addEventListener('hashchange', route);
(async () => {
  const ich = await fetch('/api/ich').then((r) => r.json()).catch(() => ({}));
  if (ich.angemeldet) route(); else zeigeLogin();
})();
