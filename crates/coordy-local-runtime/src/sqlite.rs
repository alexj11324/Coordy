use std::path::Path;

use coordy_kernel::World;
use coordy_protocol::CoordyError;

pub struct SqliteStore {
    conn: rusqlite::Connection,
}

impl SqliteStore {
    pub fn open(path: &Path) -> Result<Self, CoordyError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoordyError::unavailable(format!("sqlite dir: {e}")))?;
        }
        let conn = rusqlite::Connection::open(path)
            .map_err(|e| CoordyError::unavailable(format!("sqlite: {e}")))?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS world_snapshot (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS effect_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                json TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| CoordyError::unavailable(format!("migrate: {e}")))?;
        Ok(Self { conn })
    }

    pub fn load(&self) -> Result<World, CoordyError> {
        let json: Result<String, rusqlite::Error> =
            self.conn
                .query_row("SELECT json FROM world_snapshot WHERE id = 1", [], |row| {
                    row.get(0)
                });
        match json {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| CoordyError::unavailable(format!("world decode: {e}"))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(World::default()),
            Err(e) => Err(CoordyError::unavailable(format!("world load: {e}"))),
        }
    }

    pub fn save(&self, world: &World) -> Result<(), CoordyError> {
        let json = serde_json::to_string(world)
            .map_err(|e| CoordyError::unavailable(format!("world encode: {e}")))?;
        self.conn
            .execute(
                "INSERT INTO world_snapshot(id, json) VALUES(1, ?1)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json",
                [&json],
            )
            .map_err(|e| CoordyError::unavailable(format!("world save: {e}")))?;
        self.conn
            .execute(
                "INSERT INTO event_log(json, created_at) VALUES(?1, ?2)",
                rusqlite::params![json, chrono_now()],
            )
            .map_err(|e| CoordyError::unavailable(format!("event log: {e}")))?;
        self.conn
            .execute("DELETE FROM effect_outbox", [])
            .map_err(|e| CoordyError::unavailable(format!("outbox clear: {e}")))?;
        for effect in &world.effects {
            let row = serde_json::to_string(effect)
                .map_err(|e| CoordyError::unavailable(format!("outbox encode: {e}")))?;
            self.conn
                .execute("INSERT INTO effect_outbox(json) VALUES(?1)", [row])
                .map_err(|e| CoordyError::unavailable(format!("outbox insert: {e}")))?;
        }
        Ok(())
    }
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
