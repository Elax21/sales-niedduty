#!/usr/bin/env python3
"""
Niedduty Sales: Firmen, Pipeline, Angebote und Rechnungen.

Läuft als systemd-Dienst auf 127.0.0.1:8083, nginx reicht
sales.niedduty.de durch. Bewusst ohne Fremdbibliotheken, wie der
Anfragedienst: Python, SQLite, statische Dateien.

Ein Benutzer, ein Passwort. Der Hash steht in SALES_PASSWORT_HASH
(erzeugen mit: python3 server.py passwort).

Lokal starten:
    SALES_DEV=1 SALES_DB=./sales.db SALES_PASSWORT_HASH=... python3 server.py
"""

import hashlib
import hmac
import json
import mimetypes
import os
import pathlib
import re
import secrets
import sqlite3
import sys
import time
from collections import deque
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HIER = pathlib.Path(__file__).resolve().parent
STATIC = HIER / 'static'
SCHRIFTEN = pathlib.Path(os.environ.get('SALES_SCHRIFTEN', HIER / 'schriften'))
LOGO = pathlib.Path(os.environ.get('SALES_LOGO', HIER / 'logo'))
DB = pathlib.Path(os.environ.get('SALES_DB', '/var/lib/niedduty-sales/sales.db'))
PORT = int(os.environ.get('SALES_PORT', '8083'))
DEV = os.environ.get('SALES_DEV') == '1'
PASSWORT_HASH = os.environ.get('SALES_PASSWORT_HASH', '')

DATEIEN = DB.parent / 'dateien'
COOKIE = 'sitzung' if DEV else '__Host-sitzung'
SITZUNG_TAGE = 30
MAX_BYTES = 512 * 1024
MAX_DATEI = 15 * 1024 * 1024
DATEI_NAME = re.compile(r'^[0-9a-f]{24}\.(jpg|png|webp|pdf)$')
DATEI_TYP = {'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'pdf': 'application/pdf'}
ENTWURF_STATUS = ['fehlt', 'in_arbeit', 'fertig', 'verschickt']

STUFEN = ['idee', 'kontakt', 'gespraech', 'angebot', 'gewonnen', 'verloren']
BELEG_ARTEN = {'angebot', 'rechnung'}
FIRMEN_FELDER = ['name', 'ansprechpartner', 'telefon', 'email', 'website', 'strasse', 'plz_ort',
                 'branche', 'quelle', 'empfohlen_von', 'stufe', 'wert_einmalig', 'wert_monatlich',
                 'naechster_schritt', 'faellig_am', 'notiz', 'entwurf_status', 'entwurf_link',
                 'empfohlen_von_id', 'bonus_erledigt']
EINSTELLUNGEN = {
    'name': 'Niedduty · Alessandro Nieddu', 'strasse': 'Rosenstraße 1b-c', 'plz_ort': '59227 Ahlen',
    'telefon': '+49 1517 4456084', 'email': 'info@niedduty.de', 'web': 'niedduty.de',
    'iban': '', 'bank': '', 'steuernummer': '', 'kleinunternehmer': '1',
    'zahlungsziel_tage': '14', 'umsatzgrenze': '25000',
}


# ---------------------------------------------------------------- Datenbank

SCHEMA = '''
CREATE TABLE IF NOT EXISTS firmen (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, ansprechpartner TEXT DEFAULT '', telefon TEXT DEFAULT '',
  email TEXT DEFAULT '', website TEXT DEFAULT '', strasse TEXT DEFAULT '', plz_ort TEXT DEFAULT '',
  branche TEXT DEFAULT '', quelle TEXT DEFAULT '', empfohlen_von TEXT DEFAULT '',
  stufe TEXT NOT NULL DEFAULT 'idee',
  wert_einmalig REAL DEFAULT 0, wert_monatlich REAL DEFAULT 0,
  naechster_schritt TEXT DEFAULT '', faellig_am TEXT DEFAULT '', notiz TEXT DEFAULT '',
  erstellt TEXT NOT NULL, geaendert TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verlauf (
  id INTEGER PRIMARY KEY,
  firma_id INTEGER NOT NULL REFERENCES firmen(id) ON DELETE CASCADE,
  zeit TEXT NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS belege (
  id INTEGER PRIMARY KEY,
  art TEXT NOT NULL, nummer TEXT UNIQUE, firma_id INTEGER REFERENCES firmen(id),
  datum TEXT, leistung_von TEXT DEFAULT '', leistung_bis TEXT DEFAULT '', zahlbar_bis TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'entwurf',
  positionen TEXT NOT NULL DEFAULT '[]',
  anzahlung_text TEXT DEFAULT '', anzahlung_betrag REAL DEFAULT 0,
  text_oben TEXT DEFAULT '', text_unten TEXT DEFAULT '',
  empfaenger TEXT DEFAULT '',
  bezahlt_am TEXT DEFAULT '', erstellt TEXT NOT NULL, geaendert TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dateien (
  id INTEGER PRIMARY KEY,
  firma_id INTEGER NOT NULL REFERENCES firmen(id) ON DELETE CASCADE,
  datei TEXT NOT NULL, original TEXT NOT NULL, groesse INTEGER NOT NULL, erstellt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sitzungen (token_hash TEXT PRIMARY KEY, ablauf REAL NOT NULL);
'''


def db():
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys = ON')
    return con


def einrichten():
    DB.parent.mkdir(parents=True, exist_ok=True)
    DATEIEN.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.execute('PRAGMA journal_mode = WAL')
        con.executescript(SCHEMA)
        # Spalten, die später dazukamen
        vorhanden = {r['name'] for r in con.execute('PRAGMA table_info(firmen)')}
        for spalte, art in (('entwurf_status', "TEXT NOT NULL DEFAULT 'fehlt'"), ('entwurf_link', "TEXT DEFAULT ''"),
                            ('empfohlen_von_id', 'INTEGER REFERENCES firmen(id) ON DELETE SET NULL'),
                            ('bonus_erledigt', 'INTEGER NOT NULL DEFAULT 0')):
            if spalte not in vorhanden:
                con.execute(f'ALTER TABLE firmen ADD COLUMN {spalte} {art}')
        for k, v in EINSTELLUNGEN.items():
            con.execute('INSERT OR IGNORE INTO einstellungen VALUES (?, ?)', (k, v))
    os.chmod(DB, 0o600)


def jetzt():
    return datetime.now().isoformat(timespec='seconds')


def zeile(r):
    return dict(r) if r else None


# ---------------------------------------------------------------- Anmeldung

def hash_erzeugen(passwort):
    salz = secrets.token_bytes(16)
    h = hashlib.scrypt(passwort.encode(), salt=salz, n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024)
    return f'scrypt${salz.hex()}${h.hex()}'


def passwort_stimmt(passwort):
    try:
        _, salz, soll = PASSWORT_HASH.split('$')
        ist = hashlib.scrypt(passwort.encode(), salt=bytes.fromhex(salz), n=2**15, r=8, p=1,
                             maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(ist.hex(), soll)
    except Exception:
        return False


_versuche = {}
_versuche_gesamt = deque()


def zu_viele_versuche(ip):
    """5 Fehlversuche je IP in 15 Minuten, 30 insgesamt je Stunde."""
    t = time.time()
    v = _versuche.setdefault(ip, deque())
    while v and t - v[0] > 900:
        v.popleft()
    while _versuche_gesamt and t - _versuche_gesamt[0] > 3600:
        _versuche_gesamt.popleft()
    return len(v) >= 5 or len(_versuche_gesamt) >= 30


def fehlversuch(ip):
    _versuche.setdefault(ip, deque()).append(time.time())
    _versuche_gesamt.append(time.time())


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------- Fachliches

def betrag(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def datum_ok(x):
    return isinstance(x, str) and (x == '' or re.fullmatch(r'\d{4}-\d{2}-\d{2}', x) is not None)


def positionen_pruefen(roh):
    if not isinstance(roh, list) or len(roh) > 60:
        raise ValueError('Positionen ungültig')
    aus = []
    for p in roh:
        if not isinstance(p, dict):
            raise ValueError('Position ungültig')
        aus.append({
            'titel': str(p.get('titel', ''))[:200],
            'beschreibung': str(p.get('beschreibung', ''))[:500],
            'menge': betrag(p.get('menge', 1)),
            'einheit': str(p.get('einheit', ''))[:30],
            'preis': betrag(p.get('preis', 0)),
        })
    return aus


def datei_art(kopf):
    if kopf[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if kopf[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if kopf[:4] == b'RIFF' and kopf[8:12] == b'WEBP':
        return 'webp'
    if kopf[:5] == b'%PDF-':
        return 'pdf'
    return None


def summe(beleg):
    pos = json.loads(beleg['positionen']) if isinstance(beleg['positionen'], str) else beleg['positionen']
    s = round(sum(p['menge'] * p['preis'] for p in pos), 2)
    return s, round(s - betrag(beleg.get('anzahlung_betrag')), 2)


def naechste_nummer(con, art, jahr):
    praefix = f'{jahr}-' if art == 'rechnung' else f'A-{jahr}-'
    r = con.execute('SELECT nummer FROM belege WHERE art = ? AND nummer LIKE ? ORDER BY nummer DESC LIMIT 1',
                    (art, praefix + '%')).fetchone()
    n = int(r['nummer'].rsplit('-', 1)[1]) + 1 if r else 1
    return f'{praefix}{n:03d}'


def empfaenger_aus(firma):
    teile = [firma['name'], firma['ansprechpartner'] and f"z. Hd. {firma['ansprechpartner']}",
             firma['strasse'], firma['plz_ort']]
    return '\n'.join(t for t in teile if t)


def uebersicht(con):
    heute = date.today().isoformat()
    jahr = str(date.today().year)
    faellig = [dict(r) for r in con.execute(
        "SELECT id, name, naechster_schritt, faellig_am, stufe FROM firmen "
        "WHERE faellig_am != '' AND faellig_am <= ? AND stufe NOT IN ('gewonnen','verloren') "
        "ORDER BY faellig_am", (heute,))]
    bald = [dict(r) for r in con.execute(
        "SELECT id, name, naechster_schritt, faellig_am, stufe FROM firmen "
        "WHERE faellig_am > ? AND faellig_am <= ? AND stufe NOT IN ('gewonnen','verloren') "
        "ORDER BY faellig_am", (heute, (date.today() + timedelta(days=7)).isoformat()))]
    stufen = {s: 0 for s in STUFEN}
    for r in con.execute('SELECT stufe, COUNT(*) n FROM firmen GROUP BY stufe'):
        stufen[r['stufe']] = r['n']
    offen = con.execute(
        "SELECT COALESCE(SUM(wert_einmalig),0) e, COALESCE(SUM(wert_monatlich),0) m FROM firmen "
        "WHERE stufe IN ('gespraech','angebot')").fetchone()
    monatlich = con.execute(
        "SELECT COALESCE(SUM(wert_monatlich),0) m FROM firmen WHERE stufe = 'gewonnen'").fetchone()['m']
    umsatz = 0.0
    offen_rechnungen = 0.0
    for b in con.execute("SELECT * FROM belege WHERE art = 'rechnung' AND status IN ('gestellt','bezahlt')"):
        _, zahl = summe(dict(b))
        if b['status'] == 'bezahlt' and (b['bezahlt_am'] or '').startswith(jahr):
            umsatz += zahl
        if b['status'] == 'gestellt':
            offen_rechnungen += zahl
    grenze = betrag(con.execute("SELECT wert FROM einstellungen WHERE schluessel='umsatzgrenze'").fetchone()['wert'])
    entwuerfe_offen = [dict(r) for r in con.execute(
        "SELECT id, name, stufe, entwurf_status FROM firmen WHERE entwurf_status IN ('fehlt','in_arbeit') "
        "AND stufe IN ('kontakt','gespraech','angebot') ORDER BY entwurf_status DESC, geaendert DESC")]
    boni = [dict(r) for r in con.execute(
        "SELECT f.id, f.name, e.id AS von_id, e.name AS von FROM firmen f JOIN firmen e ON e.id = f.empfohlen_von_id "
        "WHERE f.stufe = 'gewonnen' AND f.bonus_erledigt = 0 ORDER BY f.geaendert DESC")]
    return {'faellig': faellig, 'bald': bald, 'stufen': stufen, 'entwuerfe_offen': entwuerfe_offen, 'boni': boni,
            'pipeline_einmalig': offen['e'], 'pipeline_monatlich': offen['m'],
            'monatlich': monatlich, 'umsatz_jahr': round(umsatz, 2), 'jahr': jahr,
            'offene_rechnungen': round(offen_rechnungen, 2), 'grenze': grenze}


# ---------------------------------------------------------------- HTTP

SICHERHEIT = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
                               "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
                               "form-action 'self'",
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
}


class Fehler(Exception):
    def __init__(self, code, text):
        self.code, self.text = code, text


class Handler(BaseHTTPRequestHandler):
    server_version = 'sales'
    sys_version = ''

    # -- Antworten
    def _senden(self, code, koerper, typ, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', typ)
        self.send_header('Content-Length', str(len(koerper)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in {**SICHERHEIT, **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(koerper)

    def _json(self, code, daten, extra=None):
        self._senden(code, json.dumps(daten, ensure_ascii=False).encode(), 'application/json; charset=utf-8', extra)

    def _ip(self):
        return self.headers.get('X-Real-IP', self.client_address[0])

    def _cookie(self, token, max_age):
        teile = [f'{COOKIE}={token}', 'Path=/', 'HttpOnly', 'SameSite=Strict', f'Max-Age={max_age}']
        if not DEV:
            teile.append('Secure')
        return {'Set-Cookie': '; '.join(teile)}

    def _angemeldet(self):
        c = SimpleCookie(self.headers.get('Cookie', ''))
        if COOKIE not in c:
            return False
        with db() as con:
            r = con.execute('SELECT ablauf FROM sitzungen WHERE token_hash = ?',
                            (token_hash(c[COOKIE].value),)).fetchone()
        return bool(r and r['ablauf'] > time.time())

    def _body(self):
        laenge = int(self.headers.get('Content-Length') or 0)
        if laenge > MAX_BYTES:
            raise Fehler(413, 'Zu groß')
        if laenge == 0:
            return {}
        try:
            d = json.loads(self.rfile.read(laenge))
        except Exception:
            raise Fehler(400, 'Ungültiges JSON')
        if not isinstance(d, dict):
            raise Fehler(400, 'Ungültige Anfrage')
        return d

    # -- statische Dateien
    def _statisch(self, pfad):
        if pfad.startswith('/schriften/'):
            basis, rest = SCHRIFTEN, pfad[len('/schriften/'):]
        elif pfad.startswith('/logo/'):
            basis, rest = LOGO, pfad[len('/logo/'):]
        else:
            basis, rest = STATIC, (pfad.lstrip('/') or 'index.html')
        ziel = (basis / rest).resolve()
        if not str(ziel).startswith(str(basis.resolve()) + os.sep) or not ziel.is_file():
            ziel = STATIC / 'index.html'   # Einzelseiten-App: alles andere ist die App
        typ = mimetypes.guess_type(str(ziel))[0] or 'application/octet-stream'
        if typ.startswith('text/') or typ in ('application/javascript',):
            typ += '; charset=utf-8'
        self._senden(200, ziel.read_bytes(), typ)

    # -- Verteilung
    def do_GET(self):
        self._verteilen('GET')

    def do_HEAD(self):
        self._verteilen('GET')

    def do_POST(self):
        self._verteilen('POST')

    def do_PUT(self):
        self._verteilen('PUT')

    def do_DELETE(self):
        self._verteilen('DELETE')

    def _verteilen(self, methode):
        pfad = urlparse(self.path).path
        try:
            if not pfad.startswith('/api/'):
                if methode != 'GET':
                    raise Fehler(405, 'Nicht erlaubt')
                return self._statisch(pfad)

            # Schreibende Anfragen nur mit eigenem Kopf: Fremde Seiten können
            # ihn ohne CORS nicht setzen. Zusammen mit SameSite=Strict gegen CSRF.
            if methode != 'GET' and self.headers.get('X-Niedduty') != '1':
                raise Fehler(403, 'Fehlender Kopf')

            if pfad == '/api/login' and methode == 'POST':
                return self._login()
            if pfad == '/api/ich':
                return self._json(200, {'angemeldet': self._angemeldet()})
            if not self._angemeldet():
                raise Fehler(401, 'Bitte anmelden')
            if pfad == '/api/logout' and methode == 'POST':
                return self._logout()
            m = re.fullmatch(r'/api/firmen/(\d+)/dateien', pfad)
            if m and methode == 'POST':
                return self._hochladen(int(m.group(1)))
            m = re.fullmatch(r'/api/dateien/(\d+)', pfad)
            if m:
                return self._datei(methode, int(m.group(1)))
            self._api(methode, pfad)
        except Fehler as f:
            self._json(f.code, {'fehler': f.text})
        except ValueError as f:
            self._json(400, {'fehler': str(f)})
        except Exception as f:
            print(f'Fehler bei {methode} {pfad}: {f!r}', flush=True)
            self._json(500, {'fehler': 'Serverfehler'})

    def _hochladen(self, fid):
        laenge = int(self.headers.get('Content-Length') or 0)
        if laenge <= 0 or laenge > MAX_DATEI:
            raise Fehler(413, 'Datei zu groß (höchstens 15 MB)')
        from urllib.parse import unquote
        original = re.sub(r'[\x00-\x1f/\\]', '', unquote(self.headers.get('X-Dateiname', 'datei')))[:120] or 'datei'
        daten = self.rfile.read(laenge)
        art = datei_art(daten[:12])
        if not art:
            raise Fehler(415, 'Nur Bilder (JPG, PNG, WebP) oder PDF')
        with db() as con:
            if not con.execute('SELECT 1 FROM firmen WHERE id = ?', (fid,)).fetchone():
                raise Fehler(404, 'Firma nicht gefunden')
            name = f'{secrets.token_hex(12)}.{art}'
            (DATEIEN / name).write_bytes(daten)
            os.chmod(DATEIEN / name, 0o600)
            cur = con.execute('INSERT INTO dateien (firma_id, datei, original, groesse, erstellt) VALUES (?, ?, ?, ?, ?)',
                              (fid, name, original, laenge, jetzt()))
            con.execute('INSERT INTO verlauf (firma_id, zeit, text) VALUES (?, ?, ?)', (fid, jetzt(), f'Datei hochgeladen: {original}'))
        self._json(201, {'id': cur.lastrowid})

    def _datei(self, methode, did):
        with db() as con:
            r = con.execute('SELECT * FROM dateien WHERE id = ?', (did,)).fetchone()
            if not r or not DATEI_NAME.match(r['datei']):
                raise Fehler(404, 'Datei nicht gefunden')
            if methode == 'DELETE':
                (DATEIEN / r['datei']).unlink(missing_ok=True)
                con.execute('DELETE FROM dateien WHERE id = ?', (did,))
                return self._json(200, {'ok': True})
        if methode != 'GET':
            raise Fehler(405, 'Nicht erlaubt')
        art = r['datei'].rsplit('.', 1)[1]
        ascii_name = re.sub(r'[^A-Za-z0-9._-]', '_', r['original'])
        self._senden(200, (DATEIEN / r['datei']).read_bytes(), DATEI_TYP[art],
                     {'Content-Disposition': f'inline; filename="{ascii_name}"', 'Cache-Control': 'private, max-age=3600'})

    def _login(self):
        ip = self._ip()
        if zu_viele_versuche(ip):
            raise Fehler(429, 'Zu viele Versuche. Bitte später noch einmal.')
        d = self._body()
        if not PASSWORT_HASH or not passwort_stimmt(str(d.get('passwort', ''))[:200]):
            fehlversuch(ip)
            time.sleep(0.8)
            raise Fehler(401, 'Passwort falsch')
        token = secrets.token_urlsafe(32)
        with db() as con:
            con.execute('DELETE FROM sitzungen WHERE ablauf < ?', (time.time(),))
            con.execute('INSERT INTO sitzungen VALUES (?, ?)', (token_hash(token), time.time() + SITZUNG_TAGE * 86400))
        self._json(200, {'ok': True}, self._cookie(token, SITZUNG_TAGE * 86400))

    def _logout(self):
        c = SimpleCookie(self.headers.get('Cookie', ''))
        with db() as con:
            con.execute('DELETE FROM sitzungen WHERE token_hash = ?', (token_hash(c[COOKIE].value),))
        self._json(200, {'ok': True}, self._cookie('', 0))

    # -- eigentliche API
    def _api(self, m, pfad):
        teile = pfad.strip('/').split('/')[1:]   # ohne "api"
        with db() as con:
            if teile == ['uebersicht'] and m == 'GET':
                return self._json(200, uebersicht(con))

            if teile == ['einstellungen']:
                if m == 'PUT':
                    d = self._body()
                    for k in EINSTELLUNGEN:
                        if k in d:
                            con.execute('UPDATE einstellungen SET wert = ? WHERE schluessel = ?', (str(d[k])[:200], k))
                return self._json(200, {r['schluessel']: r['wert'] for r in con.execute('SELECT * FROM einstellungen')})

            if teile[0] == 'firmen':
                return self._firmen(con, m, teile[1:])
            if teile[0] == 'belege':
                return self._belege(con, m, teile[1:])
        raise Fehler(404, 'Unbekannt')

    def _firmen(self, con, m, rest):
        if not rest:
            if m == 'GET':
                return self._json(200, [dict(r) for r in con.execute('SELECT * FROM firmen ORDER BY geaendert DESC')])
            if m == 'POST':
                d = self._firma_daten(self._body(), neu=True)
                d['erstellt'] = d['geaendert'] = jetzt()
                spalten = ', '.join(d)
                cur = con.execute(f'INSERT INTO firmen ({spalten}) VALUES ({", ".join("?" * len(d))})', list(d.values()))
                con.execute('INSERT INTO verlauf (firma_id, zeit, text) VALUES (?, ?, ?)', (cur.lastrowid, jetzt(), 'Angelegt'))
                return self._json(201, zeile(con.execute('SELECT * FROM firmen WHERE id = ?', (cur.lastrowid,)).fetchone()))
        fid = int(rest[0]) if rest[0].isdigit() else -1
        firma = zeile(con.execute('SELECT * FROM firmen WHERE id = ?', (fid,)).fetchone())
        if not firma:
            raise Fehler(404, 'Firma nicht gefunden')
        if len(rest) == 1:
            if m == 'GET':
                firma['verlauf'] = [dict(r) for r in con.execute(
                    'SELECT * FROM verlauf WHERE firma_id = ? ORDER BY zeit DESC, id DESC', (fid,))]
                firma['belege'] = [self._beleg_kurz(dict(r)) for r in con.execute(
                    'SELECT * FROM belege WHERE firma_id = ? ORDER BY erstellt DESC', (fid,))]
                firma['empfehlungen'] = [dict(r) for r in con.execute(
                    'SELECT id, name, stufe, bonus_erledigt, wert_einmalig FROM firmen WHERE empfohlen_von_id = ? ORDER BY name', (fid,))]
                firma['empfohlen_von_name'] = (con.execute('SELECT name FROM firmen WHERE id = ?', (firma['empfohlen_von_id'],)).fetchone() or {'name': ''})['name'] if firma['empfohlen_von_id'] else ''
                firma['dateien'] = [{k: r[k] for k in ('id', 'original', 'groesse', 'erstellt')} | {'art': r['datei'].rsplit('.', 1)[1]}
                                    for r in con.execute('SELECT * FROM dateien WHERE firma_id = ? ORDER BY erstellt DESC', (fid,))]
                return self._json(200, firma)
            if m == 'PUT':
                d = self._firma_daten(self._body())
                if d.get('empfohlen_von_id') == fid:
                    raise ValueError('Eine Firma kann sich nicht selbst empfehlen')
                if d.get('empfohlen_von_id') and not con.execute('SELECT 1 FROM firmen WHERE id = ?', (d['empfohlen_von_id'],)).fetchone():
                    raise ValueError('Empfehlende Firma unbekannt')
                if 'stufe' in d and d['stufe'] != firma['stufe']:
                    con.execute('INSERT INTO verlauf (firma_id, zeit, text) VALUES (?, ?, ?)',
                                (fid, jetzt(), f"Stufe: {firma['stufe']} → {d['stufe']}"))
                d['geaendert'] = jetzt()
                con.execute(f'UPDATE firmen SET {", ".join(k + " = ?" for k in d)} WHERE id = ?', [*d.values(), fid])
                return self._json(200, zeile(con.execute('SELECT * FROM firmen WHERE id = ?', (fid,)).fetchone()))
            if m == 'DELETE':
                if con.execute("SELECT 1 FROM belege WHERE firma_id = ? AND status != 'entwurf'", (fid,)).fetchone():
                    raise Fehler(409, 'Firma hat gestellte Belege und bleibt deshalb erhalten.')
                con.execute("DELETE FROM belege WHERE firma_id = ? AND status = 'entwurf'", (fid,))
                for r in con.execute('SELECT datei FROM dateien WHERE firma_id = ?', (fid,)):
                    if DATEI_NAME.match(r['datei']):
                        (DATEIEN / r['datei']).unlink(missing_ok=True)
                con.execute('DELETE FROM firmen WHERE id = ?', (fid,))
                return self._json(200, {'ok': True})
        if rest[1:] == ['verlauf'] and m == 'POST':
            text = str(self._body().get('text', '')).strip()[:4000]
            if not text:
                raise Fehler(400, 'Leere Notiz')
            con.execute('INSERT INTO verlauf (firma_id, zeit, text) VALUES (?, ?, ?)', (fid, jetzt(), text))
            con.execute('UPDATE firmen SET geaendert = ? WHERE id = ?', (jetzt(), fid))
            return self._json(201, {'ok': True})
        raise Fehler(404, 'Unbekannt')

    def _firma_daten(self, roh, neu=False):
        d = {}
        for k in FIRMEN_FELDER:
            if k not in roh:
                continue
            v = roh[k]
            if k in ('wert_einmalig', 'wert_monatlich'):
                d[k] = betrag(v)
            elif k == 'stufe':
                if v not in STUFEN:
                    raise ValueError('Unbekannte Stufe')
                d[k] = v
            elif k == 'empfohlen_von_id':
                d[k] = int(v) if str(v or '').isdigit() else None
            elif k == 'bonus_erledigt':
                d[k] = 1 if v in (1, True, '1', 'true') else 0
            elif k == 'entwurf_status':
                if v not in ENTWURF_STATUS:
                    raise ValueError('Unbekannter Entwurf-Status')
                d[k] = v
            elif k == 'entwurf_link':
                v = str(v or '').strip()[:500]
                if v and not re.match(r'^https?://', v):
                    v = 'https://' + v
                d[k] = v
            elif k == 'faellig_am':
                if not datum_ok(v):
                    raise ValueError('Datum ungültig')
                d[k] = v
            else:
                d[k] = str(v or '').strip()[:4000 if k == 'notiz' else 300]
        if neu and not d.get('name'):
            raise ValueError('Name fehlt')
        if 'name' in d and not d['name']:
            raise ValueError('Name fehlt')
        return d

    def _beleg_kurz(self, b):
        brutto, zahl = summe(b)
        return {k: b[k] for k in ('id', 'art', 'nummer', 'firma_id', 'datum', 'status', 'bezahlt_am', 'erstellt')} | \
            {'summe': brutto, 'zahlbetrag': zahl}

    def _belege(self, con, m, rest):
        if not rest:
            if m == 'GET':
                aus = []
                for r in con.execute('SELECT b.*, f.name AS firma FROM belege b LEFT JOIN firmen f ON f.id = b.firma_id '
                                     'ORDER BY b.erstellt DESC'):
                    k = self._beleg_kurz(dict(r))
                    k['firma'] = r['firma']
                    aus.append(k)
                return self._json(200, aus)
            if m == 'POST':
                d = self._body()
                art = d.get('art')
                if art not in BELEG_ARTEN:
                    raise ValueError('Art ungültig')
                firma = zeile(con.execute('SELECT * FROM firmen WHERE id = ?', (int(d.get('firma_id') or 0),)).fetchone())
                if not firma:
                    raise ValueError('Firma fehlt')
                ziel = int(con.execute("SELECT wert FROM einstellungen WHERE schluessel='zahlungsziel_tage'").fetchone()['wert'] or 14)
                vorlage = None
                if d.get('aus_beleg'):
                    vorlage = zeile(con.execute('SELECT * FROM belege WHERE id = ?', (int(d['aus_beleg']),)).fetchone())
                heute = date.today()
                cur = con.execute(
                    'INSERT INTO belege (art, firma_id, datum, zahlbar_bis, positionen, empfaenger, text_oben, erstellt, geaendert) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (art, firma['id'], heute.isoformat(),
                     (heute + timedelta(days=ziel)).isoformat() if art == 'rechnung' else (heute + timedelta(days=30)).isoformat(),
                     vorlage['positionen'] if vorlage else '[]', empfaenger_aus(firma),
                     vorlage['text_oben'] if vorlage else '', jetzt(), jetzt()))
                return self._json(201, {'id': cur.lastrowid})
        bid = int(rest[0]) if rest[0].isdigit() else -1
        b = zeile(con.execute('SELECT * FROM belege WHERE id = ?', (bid,)).fetchone())
        if not b:
            raise Fehler(404, 'Beleg nicht gefunden')
        if len(rest) == 1 and m == 'GET':
            b['positionen'] = json.loads(b['positionen'])
            b['summe'], b['zahlbetrag'] = summe(b)
            b['firma'] = zeile(con.execute('SELECT * FROM firmen WHERE id = ?', (b['firma_id'],)).fetchone())
            b['absender'] = {r['schluessel']: r['wert'] for r in con.execute('SELECT * FROM einstellungen')}
            return self._json(200, b)
        if len(rest) == 1 and m == 'PUT':
            if b['status'] != 'entwurf':
                raise Fehler(409, 'Gestellte Belege sind gesperrt. Bei Fehlern stornieren und neu anlegen.')
            d = self._body()
            neu = {}
            for k in ('datum', 'leistung_von', 'leistung_bis', 'zahlbar_bis'):
                if k in d:
                    if not datum_ok(d[k]):
                        raise ValueError('Datum ungültig')
                    neu[k] = d[k]
            for k, n in (('anzahlung_text', 200), ('text_oben', 2000), ('text_unten', 2000), ('empfaenger', 500)):
                if k in d:
                    neu[k] = str(d[k] or '')[:n]
            if 'anzahlung_betrag' in d:
                neu['anzahlung_betrag'] = betrag(d['anzahlung_betrag'])
            if 'positionen' in d:
                neu['positionen'] = json.dumps(positionen_pruefen(d['positionen']), ensure_ascii=False)
            neu['geaendert'] = jetzt()
            con.execute(f'UPDATE belege SET {", ".join(k + " = ?" for k in neu)} WHERE id = ?', [*neu.values(), bid])
            return self._json(200, {'ok': True})
        if len(rest) == 1 and m == 'DELETE':
            if b['status'] != 'entwurf':
                raise Fehler(409, 'Nur Entwürfe lassen sich löschen.')
            con.execute('DELETE FROM belege WHERE id = ?', (bid,))
            return self._json(200, {'ok': True})
        if rest[1:] == ['status'] and m == 'POST':
            ziel = self._body().get('status')
            erlaubt = {('entwurf', 'gestellt'), ('gestellt', 'bezahlt'), ('gestellt', 'storniert'),
                       ('bezahlt', 'gestellt')}
            if (b['status'], ziel) not in erlaubt:
                raise Fehler(409, 'Dieser Wechsel ist nicht möglich.')
            neu = {'status': ziel, 'geaendert': jetzt()}
            if ziel == 'gestellt' and not b['nummer']:
                if not json.loads(b['positionen']):
                    raise Fehler(409, 'Ohne Positionen lässt sich nichts stellen.')
                neu['nummer'] = naechste_nummer(con, b['art'], (b['datum'] or date.today().isoformat())[:4])
            if ziel == 'bezahlt':
                neu['bezahlt_am'] = date.today().isoformat()
            if b['status'] == 'bezahlt' and ziel == 'gestellt':
                neu['bezahlt_am'] = ''
            con.execute(f'UPDATE belege SET {", ".join(k + " = ?" for k in neu)} WHERE id = ?', [*neu.values(), bid])
            art = 'Angebot' if b['art'] == 'angebot' else 'Rechnung'
            con.execute('INSERT INTO verlauf (firma_id, zeit, text) VALUES (?, ?, ?)',
                        (b['firma_id'], jetzt(), f"{art} {neu.get('nummer') or b['nummer']}: {ziel}"))
            return self._json(200, {'ok': True})
        raise Fehler(404, 'Unbekannt')

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    if sys.argv[1:] == ['passwort']:
        import getpass
        p1 = getpass.getpass('Neues Passwort: ')
        if len(p1) < 12:
            sys.exit('Bitte mindestens 12 Zeichen.')
        if getpass.getpass('Noch einmal: ') != p1:
            sys.exit('Stimmt nicht überein.')
        print('SALES_PASSWORT_HASH=' + hash_erzeugen(p1))
        sys.exit(0)
    if not PASSWORT_HASH:
        print('Warnung: SALES_PASSWORT_HASH fehlt, Anmelden ist nicht möglich.', flush=True)
    einrichten()
    print(f'Sales läuft auf http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
