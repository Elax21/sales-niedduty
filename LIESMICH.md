# Niedduty Sales

Firmen, Pipeline, Angebote und Rechnungen für Niedduty (niedduty.de).
Schriften und Logo liegen mit im Repo, es hängt an nichts anderem. Läuft unter
`sales.niedduty.de`, mit Passwort, nicht indexiert. Python ohne
Fremdbibliotheken, SQLite, reines JavaScript, kein Build-Schritt.

## Lokal starten

```
python3 server.py passwort            # Passwort-Hash erzeugen
SALES_DEV=1 SALES_DB=./sales.db SALES_PASSWORT_HASH='scrypt$…' python3 server.py
```

Dann http://127.0.0.1:8083 öffnen. `sales.db` ist in `.gitignore`.

## Aktualisieren

```
cd /opt/niedduty-sales && sudo git pull && sudo systemctl restart niedduty-sales
```

## Regeln

- **Gestellte Belege sind gesperrt** (GoBD). Fehler: stornieren, neu anlegen.
  Nummern werden erst beim Stellen vergeben, fortlaufend je Jahr:
  Rechnungen `2026-001`, Angebote `A-2026-001`.
- Umsatz in der Übersicht = bezahlte Rechnungen im laufenden Jahr, mit
  Balken zur Kleinunternehmer-Grenze (Einstellungen, Standard 25.000 €).
- Alles von Nutzern landet per `textContent` im DOM, nie per `innerHTML`.
- CSP ohne `unsafe-inline`: keine `style`-Attribute, Stile per CSSOM.

## Auf den Server bringen (einmalig)

1. DNS bei INWX: `A`-Eintrag `sales` → `159.195.246.253`
2. Auf dem Server:
   ```
   sudo useradd --system --no-create-home niedduty-sales
   sudo install -d -o root -g root /opt/niedduty-sales
   sudo install -d -m 700 -o niedduty-sales -g niedduty-sales /var/lib/niedduty-sales
   sudo git clone https://github.com/Elax21/sales-niedduty.git /opt/niedduty-sales   # oder per scp kopieren
   sudo python3 /opt/niedduty-sales/server.py passwort   # Hash erzeugen
   echo "SALES_PASSWORT_HASH=…" | sudo tee /etc/niedduty/sales.env; sudo chmod 640 /etc/niedduty/sales.env
   sudo chgrp niedduty-sales /etc/niedduty/sales.env
   ```
3. `niedduty-sales.service` nach `/etc/systemd/system/`, `enable --now`
4. `nginx-sales.conf` nach `sites-available`, verlinken, `certbot --nginx -d sales.niedduty.de`, `nginx -t`, reload
5. **Backup:** `/var/lib/niedduty-sales/sales.db` regelmäßig woanders hin sichern.
