import sqlite3
import json
import secrets
import re
from pathlib import Path
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / 'it_signer.db'

def get_db_connection():
    """Create and return a database connection configured with Row factory and WAL mode."""
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db():
    """Initialize SQLite database tables and indexes."""
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    quick_access_token TEXT UNIQUE NOT NULL,
                    settings TEXT NOT NULL DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_token ON users(quick_access_token);")
    finally:
        conn.close()

def parse_user_row(row):
    """Convert a sqlite3.Row into a Python dictionary with parsed settings."""
    if not row:
        return None
    user_dict = dict(row)
    # Parse settings JSON
    raw_settings = user_dict.get('settings', '{}')
    if isinstance(raw_settings, str):
        try:
            user_dict['settings'] = json.loads(raw_settings)
        except Exception:
            user_dict['settings'] = {}
    elif not isinstance(user_dict.get('settings'), dict):
        user_dict['settings'] = {}
    return user_dict

def validate_username(username):
    """Validate username format."""
    clean = (username or '').strip()
    if not clean:
        return False, "Username cannot be empty."
    if len(clean) < 2 or len(clean) > 40:
        return False, "Username must be between 2 and 40 characters."
    if not re.match(r'^[a-zA-Z0-9_\.\-]+$', clean):
        return False, "Username can only contain letters, numbers, hyphens, dots, and underscores."
    return True, clean

def create_user(username, password, display_name=None, initial_settings=None):
    """Create a new user account with hashed password, unique access token, and settings."""
    valid, result = validate_username(username)
    if not valid:
        raise ValueError(result)
    clean_username = result

    clean_pw = (password or '').strip()
    if len(clean_pw) < 4:
        raise ValueError("Password must be at least 4 characters long.")

    clean_display = (display_name or '').strip() or clean_username
    pw_hash = generate_password_hash(clean_pw)
    token = secrets.token_urlsafe(24)
    settings_json = json.dumps(initial_settings or {})

    conn = get_db_connection()
    try:
        with conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO users (username, display_name, password_hash, quick_access_token, settings, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (clean_username, clean_display, pw_hash, token, settings_json, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            user_id = cursor.lastrowid
            
            cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            return parse_user_row(cursor.fetchone())
    except sqlite3.IntegrityError:
        raise ValueError(f"Username '{clean_username}' is already taken.")
    finally:
        conn.close()

def authenticate_user(username, password):
    """Authenticate a user with username and password. Updates last_login on success."""
    clean_username = (username or '').strip()
    clean_pw = (password or '').strip()
    if not clean_username or not clean_pw:
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (clean_username,))
        row = cursor.fetchone()
        if not row:
            return None

        user = parse_user_row(row)
        if check_password_hash(user['password_hash'], clean_pw):
            with conn:
                cursor.execute(
                    "UPDATE users SET last_login = ? WHERE id = ?", 
                    (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), user['id'])
                )
            del user['password_hash']
            return user
        return None
    finally:
        conn.close()

def get_user_by_id(user_id):
    """Retrieve user dictionary by integer ID."""
    if not user_id:
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = parse_user_row(cursor.fetchone())
        if user and 'password_hash' in user:
            del user['password_hash']
        return user
    finally:
        conn.close()

def get_user_by_username(username):
    """Retrieve user dictionary by username."""
    clean = (username or '').strip()
    if not clean:
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (clean,))
        user = parse_user_row(cursor.fetchone())
        if user and 'password_hash' in user:
            del user['password_hash']
        return user
    finally:
        conn.close()

def get_user_by_token(token):
    """Retrieve user dictionary by quick access token."""
    clean = (token or '').strip()
    if not clean:
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE quick_access_token = ?", (clean,))
        user = parse_user_row(cursor.fetchone())
        if user and 'password_hash' in user:
            del user['password_hash']
        return user
    finally:
        conn.close()

def update_user_settings(user_id, new_settings):
    """Update settings dictionary for a specific user."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT settings FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return False, "User not found."

        current_settings = {}
        try:
            current_settings = json.loads(row['settings'])
        except Exception:
            pass

        current_settings.update(new_settings)
        with conn:
            cursor.execute(
                "UPDATE users SET settings = ? WHERE id = ?", 
                (json.dumps(current_settings, indent=2), user_id)
            )
        return True, current_settings
    finally:
        conn.close()

def update_user_profile(user_id, display_name=None, password=None):
    """Update display name and/or password for a user."""
    updates = []
    params = []
    
    if display_name is not None and display_name.strip():
        updates.append("display_name = ?")
        params.append(display_name.strip())

    if password is not None and password.strip():
        if len(password.strip()) < 4:
            return False, "Password must be at least 4 characters long."
        updates.append("password_hash = ?")
        params.append(generate_password_hash(password.strip()))

    if not updates:
        return True, "No changes."

    params.append(user_id)
    sql = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(sql, params)
        return True, "Profile updated successfully."
    finally:
        conn.close()

def regenerate_user_token(user_id):
    """Generate and save a new quick access token for a user."""
    new_token = secrets.token_urlsafe(24)
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET quick_access_token = ? WHERE id = ?", (new_token, user_id))
        return new_token
    finally:
        conn.close()

def count_users():
    """Return total number of registered users."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS total FROM users")
        return cursor.fetchone()['total']
    finally:
        conn.close()

def list_all_users():
    """Return list of all registered users without password hashes."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, display_name, quick_access_token, created_at, last_login FROM users ORDER BY username ASC")
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()
