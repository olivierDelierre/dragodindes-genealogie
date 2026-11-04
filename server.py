#!/usr/bin/env python3
"""Serveur de Haras : fichiers statiques + petite API JSON (comptes sans mot de passe, montures possédées).

    python3 server.py [port] [--host 0.0.0.0]

Aucune dépendance (bibliothèque standard uniquement). Les données sont dans haras.db (SQLite),
à côté de ce fichier, ou à l'emplacement donné par la variable d'environnement HARAS_DB.
"""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import unicodedata
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('HARAS_DB', os.path.join(ROOT, 'haras.db'))
SESSION_REMEMBER = 90 * 24 * 3600   # « Se souvenir de moi »
SESSION_SHORT = 2 * 24 * 3600       # session simple (le navigateur l'oublie à sa fermeture)
MAX_BODY = 256 * 1024
MAX_OWNED = 2000
USERNAME_RE = re.compile(r"^[\w .'\-]{2,30}$")
MOUNT_ID_RE = re.compile(r'^[a-z]:[a-z0-9\-]{1,64}$')
STATIC_EXT = {'.html', '.js', '.css', '.png', '.svg', '.ico', '.webmanifest', '.woff2'}


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys = ON')
    return con


def init_db():
    with db() as con:
        con.execute('PRAGMA journal_mode = WAL')
        con.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                username_key TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS owned (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                mount_id TEXT NOT NULL,
                PRIMARY KEY (user_id, mount_id)
            );
        """)


def username_key(name):
    return unicodedata.normalize('NFKC', name).casefold()


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(con, user_id, remember):
    token = secrets.token_urlsafe(32)
    ttl = SESSION_REMEMBER if remember else SESSION_SHORT
    con.execute('DELETE FROM sessions WHERE expires_at < ?', (int(time.time()),))
    con.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
                (hash_token(token), user_id, int(time.time()) + ttl))
    return token


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


class Handler(SimpleHTTPRequestHandler):
    server_version = 'Haras'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ----- fichiers statiques (liste blanche d'extensions : jamais le .db ni le .py) -----
    def _static_allowed(self):
        path = urlsplit(self.path).path
        if path.endswith('/'):
            return True
        parts = [p for p in path.split('/') if p]
        if any(p.startswith('.') for p in parts):
            return False
        return os.path.splitext(path)[1].lower() in STATIC_EXT

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self._api('GET')
        if not self._static_allowed():
            return self.send_error(HTTPStatus.NOT_FOUND)
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith('/api/') or not self._static_allowed():
            return self.send_error(HTTPStatus.NOT_FOUND)
        super().do_HEAD()

    def do_POST(self):
        self._api('POST') if self.path.startswith('/api/') else self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        self._api('PUT') if self.path.startswith('/api/') else self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    # ----- API -----
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            raise ApiError(400, 'Requête invalide.')
        if length > MAX_BODY:
            raise ApiError(413, 'Requête trop volumineuse.')
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            raise ApiError(400, 'JSON invalide.')
        if not isinstance(data, dict):
            raise ApiError(400, 'JSON invalide.')
        return data

    def _token(self):
        auth = self.headers.get('Authorization', '')
        return auth[7:].strip() if auth.startswith('Bearer ') else None

    def _user(self, con):
        token = self._token()
        if not token:
            raise ApiError(401, 'Connexion requise.')
        row = con.execute(
            'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id '
            'WHERE s.token_hash = ? AND s.expires_at > ?', (hash_token(token), int(time.time()))).fetchone()
        if not row:
            raise ApiError(401, 'Session expirée.')
        return row

    @staticmethod
    def _clean_username(data):
        name = ' '.join(str(data.get('username', '')).split())
        if not USERNAME_RE.match(name):
            raise ApiError(400, "Pseudo invalide : 2 à 30 caractères (lettres, chiffres, espace, . _ ' -).")
        return name

    @staticmethod
    def _clean_owned(ids):
        if not isinstance(ids, list) or len(ids) > MAX_OWNED:
            raise ApiError(400, 'Liste invalide.')
        return sorted({i for i in ids if isinstance(i, str) and MOUNT_ID_RE.match(i)})

    def _api(self, method):
        route = urlsplit(self.path).path
        try:
            with db() as con:
                payload = self._route(con, method, route)
            self._send_json(200, payload)
        except ApiError as e:
            self._send_json(e.status, {'error': e.message})
        except Exception as e:  # noqa: BLE001 — l'API ne doit jamais planter le serveur
            self.log_error('API error: %r', e)
            self._send_json(500, {'error': 'Erreur serveur.'})

    def _route(self, con, method, route):
        if route == '/api/register' and method == 'POST':
            data = self._read_json()
            name = self._clean_username(data)
            try:
                cur = con.execute('INSERT INTO users (username, username_key, created_at) VALUES (?, ?, ?)',
                                  (name, username_key(name), int(time.time())))
            except sqlite3.IntegrityError:
                raise ApiError(409, 'Ce pseudo est déjà pris.')
            uid = cur.lastrowid
            owned = self._clean_owned(data.get('owned', []))  # reprise des montures déjà cochées en local
            con.executemany('INSERT INTO owned (user_id, mount_id) VALUES (?, ?)', [(uid, i) for i in owned])
            token = new_session(con, uid, bool(data.get('remember')))
            return {'token': token, 'username': name, 'owned': owned}

        if route == '/api/login' and method == 'POST':
            data = self._read_json()
            name = self._clean_username(data)
            row = con.execute('SELECT id, username FROM users WHERE username_key = ?', (username_key(name),)).fetchone()
            if not row:
                raise ApiError(404, "Aucun compte avec ce pseudo.")
            token = new_session(con, row['id'], bool(data.get('remember')))
            owned = [r['mount_id'] for r in con.execute('SELECT mount_id FROM owned WHERE user_id = ?', (row['id'],))]
            return {'token': token, 'username': row['username'], 'owned': sorted(owned)}

        if route == '/api/logout' and method == 'POST':
            token = self._token()
            if token:
                con.execute('DELETE FROM sessions WHERE token_hash = ?', (hash_token(token),))
            return {'ok': True}

        if route == '/api/users' and method == 'GET':
            # Liste publique des pseudos : l'écran de connexion propose de choisir son profil.
            rows = con.execute('SELECT username FROM users ORDER BY username_key').fetchall()
            return {'users': [r['username'] for r in rows]}

        if route == '/api/me' and method == 'GET':
            user = self._user(con)
            owned = [r['mount_id'] for r in con.execute('SELECT mount_id FROM owned WHERE user_id = ?', (user['id'],))]
            return {'username': user['username'], 'owned': sorted(owned)}

        if route == '/api/owned' and method == 'PUT':
            user = self._user(con)
            owned = self._clean_owned(self._read_json().get('owned'))
            con.execute('DELETE FROM owned WHERE user_id = ?', (user['id'],))
            con.executemany('INSERT INTO owned (user_id, mount_id) VALUES (?, ?)', [(user['id'], i) for i in owned])
            return {'owned': owned}

        raise ApiError(404, 'Route inconnue.')


def main(argv):
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', 8765))
    args = argv[1:]
    while args:
        a = args.pop(0)
        if a == '--host' and args:
            host = args.pop(0)
        elif a.isdigit():
            port = int(a)
    init_db()
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f'Haras : http://{host}:{port}/  (base : {DB_PATH})', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main(sys.argv)
