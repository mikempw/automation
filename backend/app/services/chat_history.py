"""Chat history persistence — SQLite-backed storage for chat conversations."""
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = os.getenv("DATA_DIR", "/app/data")
DB_PATH = os.path.join(DATA_DIR, "chat_history.db")


def _get_db() -> sqlite3.Connection:
    """Get a SQLite connection with WAL mode for concurrent reads."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    """Create tables if they don't exist."""
    conn = _get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Conversation',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                skill_request TEXT,
                execution_result TEXT,
                status TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
        """)
        conn.commit()
    finally:
        conn.close()


# Initialize on import
_init_db()


def create_conversation(title: str = "New Conversation") -> dict:
    """Create a new conversation and return it."""
    conv_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conv_id, title, now, now),
        )
        conn.commit()
        return {"id": conv_id, "title": title, "created_at": now, "updated_at": now}
    finally:
        conn.close()


def list_conversations(limit: int = 50) -> list[dict]:
    """List conversations ordered by most recently updated."""
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT c.*, COUNT(m.id) as message_count FROM conversations c "
            "LEFT JOIN messages m ON m.conversation_id = c.id "
            "GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_conversation(conv_id: str) -> Optional[dict]:
    """Get a conversation with all its messages."""
    conn = _get_db()
    try:
        conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
        if not conv:
            return None
        msgs = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()
        messages = []
        for m in msgs:
            msg = dict(m)
            if msg.get("skill_request"):
                msg["skill_request"] = json.loads(msg["skill_request"])
            if msg.get("execution_result"):
                msg["execution_result"] = json.loads(msg["execution_result"])
            messages.append(msg)
        return {**dict(conv), "messages": messages}
    finally:
        conn.close()


def add_message(conv_id: str, role: str, content: str,
                skill_request: dict = None, execution_result: dict = None,
                status: str = None) -> dict:
    """Add a message to a conversation."""
    msg_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, skill_request, execution_result, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                msg_id, conv_id, role, content,
                json.dumps(skill_request) if skill_request else None,
                json.dumps(execution_result) if execution_result else None,
                status, now,
            ),
        )
        # Update conversation title from first user message if still default
        if role == "user":
            conv = conn.execute("SELECT title FROM conversations WHERE id = ?", (conv_id,)).fetchone()
            if conv and conv["title"] == "New Conversation":
                title = content[:80].strip()
                if len(content) > 80:
                    title += "..."
                conn.execute("UPDATE conversations SET title = ? WHERE id = ?", (title, conv_id))
        conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conv_id))
        conn.commit()
        msg = {
            "id": msg_id, "conversation_id": conv_id, "role": role,
            "content": content, "skill_request": skill_request,
            "execution_result": execution_result, "status": status,
            "created_at": now,
        }
        return msg
    finally:
        conn.close()


def update_message(msg_id: str, execution_result: dict = None, status: str = None) -> bool:
    """Update an existing message (e.g., after skill execution)."""
    conn = _get_db()
    try:
        updates = []
        params = []
        if execution_result is not None:
            updates.append("execution_result = ?")
            params.append(json.dumps(execution_result))
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if not updates:
            return False
        params.append(msg_id)
        conn.execute(f"UPDATE messages SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return True
    finally:
        conn.close()


def delete_conversation(conv_id: str) -> bool:
    """Delete a conversation and all its messages."""
    conn = _get_db()
    try:
        cursor = conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def rename_conversation(conv_id: str, title: str) -> bool:
    """Rename a conversation."""
    conn = _get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        cursor = conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, conv_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()
