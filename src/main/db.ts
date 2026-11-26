import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

const META_COLS: Array<[string, string]> = [
  ['duration', 'REAL'],
  ['width', 'INTEGER'],
  ['height', 'INTEGER'],
  ['fps', 'REAL'],
  ['vcodec', 'TEXT'],
  ['acodec', 'TEXT'],
  ['bitrate', 'INTEGER'],
  ['probe_src', 'TEXT'],
  ['meta_at', 'INTEGER NOT NULL DEFAULT 0']
]

function migrate(d: Database.Database): void {
  const existing = new Set(
    (d.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>).map((r) => r.name)
  )
  for (const [name, def] of META_COLS) {
    if (!existing.has(name)) d.exec(`ALTER TABLE files ADD COLUMN ${name} ${def}`)
  }
}

export function initDb(dbPath?: string): Database.Database {
  if (db) return db
  db = new Database(dbPath ?? join(app.getPath('userData'), 'album.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('video', 'photo')),
      dir_date TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      taken_at INTEGER NOT NULL DEFAULT 0,
      thumb TEXT,
      lrf_path TEXT,
      indexed_at INTEGER NOT NULL,
      duration REAL,
      width INTEGER,
      height INTEGER,
      fps REAL,
      vcodec TEXT,
      acodec TEXT,
      bitrate INTEGER,
      probe_src TEXT,
      meta_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_files_date ON files(dir_date DESC, taken_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
    CREATE TABLE IF NOT EXISTS favorites (
      path TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trash (
      path TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    );
  `)
  migrate(db)
  // 必须在 migrate 之后：旧库此时才补上 meta_at 列
  db.exec('CREATE INDEX IF NOT EXISTS idx_files_meta ON files(meta_at)')
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('db not initialized')
  return db
}
