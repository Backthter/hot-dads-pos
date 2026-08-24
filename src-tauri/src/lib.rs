mod sync;
mod print;

use sync::SyncState;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;
use rusqlite::Connection;
use serde::Serialize;

fn find_extension(app: &tauri::App) -> PathBuf {
    let names = ["cloudsync.dll", "cloudsync.so", "cloudsync.dylib"];

    if let Ok(rd) = app.path().resource_dir() {
        for name in &names {
            let p = rd.join(name);
            if p.exists() {
                return p;
            }
        }
    }

    for name in &names {
        let p = PathBuf::from(name);
        if p.exists() {
            return p;
        }
    }

    PathBuf::from("cloudsync.dll")
}

fn run_migrations(db_path: &PathBuf) {
    let conn = Connection::open(db_path).expect("Failed to open database for migrations");
    // Clean up any leftover cloudsync triggers that break plugin-sql saves
        if let Ok(mut trigger_names) = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%cloudsync_is_sync%'"
    ) {
        if let Ok(rows) = trigger_names.query_map([], |row| row.get::<_, String>(0)) {
            for name in rows.flatten() {
                let _ = conn.execute_batch(&format!("DROP TRIGGER IF EXISTS [{name}]"));
            }
        }
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS menu_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            show_in_order_mode INTEGER NOT NULL DEFAULT 1,
            category TEXT NOT NULL DEFAULT '',
            deal_items TEXT DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS app_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL,
            customer_name TEXT NOT NULL DEFAULT 'Customer',
            notes TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'preparing',
            total REAL NOT NULL DEFAULT 0,
            timestamp INTEGER NOT NULL,
            paid TEXT
        );
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            menu_item_id TEXT NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 1,
            deal_items TEXT DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS parked_sessions (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            notes TEXT DEFAULT '',
            last_modified INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS parked_session_cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            menu_item_id TEXT NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 1,
            deal_items TEXT DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS stock_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            unit TEXT NOT NULL DEFAULT 'pcs',
            low_stock_threshold REAL NOT NULL DEFAULT 0,
            cost_per_unit REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS stock_assignments (
            menu_item_id TEXT NOT NULL,
            stock_item_id TEXT NOT NULL,
            quantity_per_item REAL NOT NULL DEFAULT 1,
            PRIMARY KEY (menu_item_id, stock_item_id)
        );
        CREATE TABLE IF NOT EXISTS stock_movements (
            id TEXT PRIMARY KEY,
            stock_item_id TEXT NOT NULL,
            delta REAL NOT NULL DEFAULT 0,
            resulting REAL NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT 'added',
            note TEXT,
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory_snapshots (
            snapshot_date TEXT NOT NULL,
            stock_item_id TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            unit_cost REAL NOT NULL DEFAULT 0,
            value REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (snapshot_date, stock_item_id)
        );
        CREATE TABLE IF NOT EXISTS oversell_events (
            id TEXT PRIMARY KEY,
            menu_item_id TEXT NOT NULL,
            menu_item_name TEXT NOT NULL DEFAULT '',
            quantity REAL NOT NULL DEFAULT 1,
            bottleneck_stock_item_id TEXT,
            order_id TEXT,
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trading_events (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            planned_start INTEGER,
            planned_end INTEGER,
            venue TEXT,
            notes TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trading_sessions (
            id TEXT PRIMARY KEY,
            event_id TEXT,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            ticket_counter INTEGER NOT NULL DEFAULT 0,
            paused_ms INTEGER NOT NULL DEFAULT 0,
            paused_at INTEGER,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS cost_entries (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            event_id TEXT,
            amount REAL NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'fixed',
            basis TEXT NOT NULL DEFAULT 'per-session',
            timestamp INTEGER NOT NULL
        );"
    )
    .expect("Failed to run migrations");

    // --- Additive column migrations (safe to re-run on existing databases) ---
    add_column_if_missing(&conn, "orders", "seq", "INTEGER NOT NULL DEFAULT 0");
    add_column_if_missing(&conn, "orders", "subtotal", "REAL NOT NULL DEFAULT 0");
    add_column_if_missing(&conn, "orders", "discount_kind", "TEXT");
    add_column_if_missing(&conn, "orders", "discount_value", "REAL");
    add_column_if_missing(&conn, "orders", "discount_amount", "REAL NOT NULL DEFAULT 0");
    add_column_if_missing(&conn, "orders", "edited_at", "INTEGER");
    add_column_if_missing(&conn, "orders", "tax_rate", "REAL NOT NULL DEFAULT 0");
    add_column_if_missing(&conn, "orders", "tax_amount", "REAL NOT NULL DEFAULT 0");

    add_column_if_missing(&conn, "stock_items", "packet_size", "REAL");
    add_column_if_missing(&conn, "stock_items", "packet_label", "TEXT");
    add_column_if_missing(&conn, "stock_items", "icon_id", "TEXT");

    // Voiding replaces deletion; stage timestamps make throughput measurable.
    add_column_if_missing(&conn, "orders", "edit_count", "INTEGER NOT NULL DEFAULT 0");
    add_column_if_missing(&conn, "orders", "voided_at", "INTEGER");
    add_column_if_missing(&conn, "orders", "void_reason", "TEXT");
    add_column_if_missing(&conn, "orders", "grilled_at", "INTEGER");
    add_column_if_missing(&conn, "orders", "ready_at", "INTEGER");
    add_column_if_missing(&conn, "orders", "completed_at", "INTEGER");

    // Cost frozen at the moment of sale. NULL means "never costed", not zero.
    add_column_if_missing(&conn, "order_items", "unit_cost", "REAL");
    add_column_if_missing(&conn, "order_items", "oversold_quantity", "REAL NOT NULL DEFAULT 0");

    add_column_if_missing(&conn, "stock_items", "packet_size", "REAL");
    add_column_if_missing(&conn, "stock_items", "packet_label", "TEXT");
    add_column_if_missing(&conn, "stock_items", "icon_id", "TEXT");
    add_column_if_missing(&conn, "stock_items", "cost_updated_at", "INTEGER");
    add_column_if_missing(&conn, "stock_items", "packet_cost", "REAL");

    // The ledger links to causes by immutable id, never by display order number.
    add_column_if_missing(&conn, "stock_movements", "reference_type", "TEXT");
    add_column_if_missing(&conn, "stock_movements", "reference_id", "TEXT");
    add_column_if_missing(&conn, "stock_movements", "unit_cost", "REAL");
    add_column_if_missing(&conn, "stock_movements", "total_cost", "REAL");
    add_column_if_missing(&conn, "stock_movements", "reversed", "INTEGER NOT NULL DEFAULT 0");

    // Session membership is stored on the order, not derived from its time: a
    // session pauses overnight, and the hours in between fall inside its span
    // without belonging to it.
    add_column_if_missing(&conn, "orders", "session_id", "TEXT");
    add_column_if_missing(&conn, "orders", "session_ticket", "INTEGER");

    // Costs carry a basis — what the amount is charged per — rather than a
    // fixed/variable kind, and an event id for the costs that belong to a whole
    // market rather than to one of its days (ADR-012).
    //
    // `kind` is deliberately left in place. Historical rows carry it and it is
    // the only record of how they were filed before this; dropping it would
    // make the old interpretation unrecoverable. Existing rows take the
    // 'per-session' default, including those filed as 'variable' — the app
    // offers those for re-filing rather than guessing a basis from their names.
    add_column_if_missing(&conn, "cost_entries", "event_id", "TEXT");
    add_column_if_missing(
        &conn,
        "cost_entries",
        "basis",
        "TEXT NOT NULL DEFAULT 'per-session'",
    );

    // An event may now exist before its sessions do (ADR-020), so it needs
    // somewhere to say when it is *meant* to run and where. These are a plan and
    // never the record: what an event actually spanned still comes from its
    // sessions, and nothing derives membership or a window from these columns.
    //
    // All nullable with no default. A missing plan is not a plan of zero, and an
    // event created by grouping sessions after the fact correctly has none.
    // There is no `status` column here on purpose — status is derived from the
    // sessions, and storing it would drift the first time one was resumed.
    add_column_if_missing(&conn, "trading_events", "planned_start", "INTEGER");
    add_column_if_missing(&conn, "trading_events", "planned_end", "INTEGER");
    add_column_if_missing(&conn, "trading_events", "venue", "TEXT");

    add_column_if_missing(&conn, "parked_sessions", "discount_kind", "TEXT");
    add_column_if_missing(&conn, "parked_sessions", "discount_value", "REAL");
    add_column_if_missing(&conn, "parked_sessions", "editing_order_id", "TEXT");

    // Indexes come after the columns above exist, or a fresh upgrade would fail.
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders (timestamp);
         CREATE INDEX IF NOT EXISTS idx_orders_voided ON orders (voided_at);
         CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
         CREATE INDEX IF NOT EXISTS idx_movements_item_time ON stock_movements (stock_item_id, timestamp);
         CREATE INDEX IF NOT EXISTS idx_movements_reference ON stock_movements (reference_id);
         CREATE INDEX IF NOT EXISTS idx_oversell_time ON oversell_events (timestamp);
         CREATE INDEX IF NOT EXISTS idx_orders_session ON orders (session_id);
         CREATE INDEX IF NOT EXISTS idx_sessions_event ON trading_sessions (event_id);
         CREATE INDEX IF NOT EXISTS idx_costs_session ON cost_entries (session_id);
         CREATE INDEX IF NOT EXISTS idx_costs_event ON cost_entries (event_id);
         CREATE INDEX IF NOT EXISTS idx_costs_time ON cost_entries (timestamp);",
    );

    // One-time adoption of the old session model.
    //
    // Sessions used to be a boolean and a start timestamp in app_state, with
    // nothing kept once they ended. If one is still open on upgrade, turn it
    // into a real row and claim the orders taken since it began — the only case
    // where the timestamp rule was ever correct, since the old model had no
    // pause and so could not span a night.
    let legacy_active = conn
        .query_row::<String, _, _>(
            "SELECT value FROM app_state WHERE key = 'session_active'",
            [],
            |row| row.get(0),
        )
        .map(|v| v == "true")
        .unwrap_or(false);

    if legacy_active {
        let already: i64 = conn
            .query_row("SELECT COUNT(*) FROM trading_sessions", [], |row| row.get(0))
            .unwrap_or(0);
        let started_at: i64 = conn
            .query_row(
                "SELECT value FROM app_state WHERE key = 'session_started_at'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        if already == 0 && started_at > 0 {
            let _ = conn.execute(
                "INSERT INTO trading_sessions (id, name, status, started_at, ticket_counter, paused_ms)
                 VALUES ('s-legacy', 'Recovered session', 'active', ?1, 0, 0)",
                [started_at],
            );
            let _ = conn.execute(
                "UPDATE orders SET session_id = 's-legacy' WHERE timestamp >= ?1 AND session_id IS NULL",
                [started_at],
            );
            // Number them in creation order, and point the counter past the last.
            let _ = conn.execute_batch(
                "WITH numbered AS (
                     SELECT id, ROW_NUMBER() OVER (ORDER BY timestamp, rowid) AS rn
                     FROM orders WHERE session_id = 's-legacy'
                 )
                 UPDATE orders
                 SET session_ticket = (SELECT rn FROM numbered WHERE numbered.id = orders.id)
                 WHERE session_id = 's-legacy';

                 UPDATE trading_sessions
                 SET ticket_counter = (SELECT COUNT(*) FROM orders WHERE session_id = 's-legacy')
                 WHERE id = 's-legacy';",
            );
        }
    }

    // Backfill: pre-migration rows have subtotal 0 but a real total.
    let _ = conn.execute_batch(
        "UPDATE orders SET subtotal = total WHERE subtotal = 0 AND total <> 0;",
    );

    // Backfill: assign sequence numbers in creation order to rows that predate `seq`.
    if let Ok(count) = conn.query_row::<i64, _, _>(
        "SELECT COUNT(*) FROM orders WHERE seq = 0",
        [],
        |row| row.get(0),
    ) {
        if count > 0 {
            let _ = conn.execute_batch(
                "WITH numbered AS (
                     SELECT id, ROW_NUMBER() OVER (ORDER BY timestamp, rowid) AS rn FROM orders
                 )
                 UPDATE orders
                 SET seq = (SELECT rn FROM numbered WHERE numbered.id = orders.id),
                     order_number = printf('%02d', (SELECT rn FROM numbered WHERE numbered.id = orders.id));",
            );
        }
    }
}

/// ALTER TABLE ... ADD COLUMN, skipped when the column already exists.
fn add_column_if_missing(conn: &Connection, table: &str, column: &str, definition: &str) {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            Ok(rows.flatten().any(|name| name == column))
        })
        .unwrap_or(false);

    if !exists {
        if let Err(err) = conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        )) {
            eprintln!("Migration: failed to add {table}.{column}: {err}");
        }
    }
}

#[derive(Serialize)]
pub struct DiagReport {
    db_path: String,
    app_data_dir: String,
    cwd: String,
    file_exists: bool,
    file_size: u64,
    file_readonly: bool,
    menu_items: u64,
    app_categories: u64,
    orders: u64,
    order_items: u64,
    app_state_rows: u64,
    db_version: String,
    can_open_with_rusqlite: bool,
    can_write_with_rusqlite: bool,
    errors: Vec<String>,
}

#[tauri::command]
fn diagnose_storage(state: tauri::State<SyncState>) -> DiagReport {
    let mut errors = Vec::new();
    let db_path = state.db_path.lock().unwrap().clone();
    let db_path_str = db_path.display().to_string();
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_else(|e| format!("(error: {e})"));
    let app_data_dir_str = db_path.parent().map(|p| p.display().to_string()).unwrap_or_else(|| "(unknown)".to_string());

    let (file_exists, file_size, file_readonly) = match std::fs::metadata(&db_path) {
        Ok(m) => {
            let readonly = m.permissions().readonly();
            (true, m.len(), readonly)
        }
        Err(_) => (false, 0, false),
    };

    let mut menu_items = 0u64;
    let mut app_categories = 0u64;
    let mut orders = 0u64;
    let mut order_items = 0u64;
    let mut app_state_rows = 0u64;
    let mut db_version = String::new();
    let mut can_open = false;
    let mut can_write = false;

    match Connection::open(&db_path) {
        Ok(conn) => {
            can_open = true;
            let count = |sql: &str| -> u64 {
                conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0) as u64
            };
            menu_items = count("SELECT COUNT(*) FROM menu_items");
            app_categories = count("SELECT COUNT(*) FROM app_categories");
            orders = count("SELECT COUNT(*) FROM orders");
            order_items = count("SELECT COUNT(*) FROM order_items");
            app_state_rows = count("SELECT COUNT(*) FROM app_state");
            db_version = conn
                .query_row("SELECT value FROM app_state WHERE key = 'db_version'", [], |r| r.get::<_, String>(0))
                .unwrap_or_else(|_| "(none)".to_string());
            // test write
            match conn.execute_batch("CREATE TABLE IF NOT EXISTS _diag_test (x INTEGER); DROP TABLE IF EXISTS _diag_test;") {
                Ok(_) => can_write = true,
                Err(e) => errors.push(format!("write test failed: {e}")),
            }
        }
        Err(e) => errors.push(format!("open failed: {e}")),
    }

    DiagReport {
        db_path: db_path_str,
        app_data_dir: app_data_dir_str,
        cwd,
        file_exists,
        file_size,
        file_readonly,
        menu_items,
        app_categories,
        orders,
        order_items,
        app_state_rows,
        db_version,
        can_open_with_rusqlite: can_open,
        can_write_with_rusqlite: can_write,
        errors,
    }
}

#[tauri::command]
async fn close_app(window: tauri::Window) {
    let _ = window.destroy();
}

/// Writes an exported workbook next to the database, under `exports/`.
///
/// A fixed folder rather than a save dialog: exports are produced in pairs and
/// on a routine, and a dialog per file turns a one-click action into six. The
/// resolved path is returned so the UI can show exactly where it landed.
#[tauri::command]
fn write_export(
    state: tauri::State<SyncState>,
    file_name: String,
    contents: Vec<u8>,
) -> Result<String, String> {
    // Refuse anything that could climb out of the exports folder.
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err("Invalid file name".to_string());
    }

    let db_path = state.db_path.lock().map_err(|e| e.to_string())?.clone();
    let base = db_path
        .parent()
        .ok_or_else(|| "Could not resolve the data folder".to_string())?
        .join("exports");

    std::fs::create_dir_all(&base).map_err(|e| format!("Could not create {}: {e}", base.display()))?;
    let target = base.join(&file_name);
    std::fs::write(&target, &contents).map_err(|e| format!("Could not write {}: {e}", target.display()))?;
    Ok(target.display().to_string())
}

/// Where exports are written, so the UI can say so before anything is written.
#[tauri::command]
fn export_folder(state: tauri::State<SyncState>) -> Result<String, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?.clone();
    db_path
        .parent()
        .map(|p| p.join("exports").display().to_string())
        .ok_or_else(|| "Could not resolve the data folder".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default().build(),
        )
        .setup(|app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to get resource dir");
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("hotdads.db");

            // Intercept close requests — hand off to frontend for confirmation
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.emit("close-requested-ui", ());
                    }
                });
            }

            // Migrate from old database location (resource dir) if it exists
            let old_db_path = resource_dir.join("data").join("hotdads.db");
            if old_db_path.exists() && !db_path.exists() {
                let _ = std::fs::copy(&old_db_path, &db_path);
                let _ = std::fs::remove_file(old_db_path.with_extension("db-wal"));
                let _ = std::fs::remove_file(old_db_path.with_extension("db-shm"));
                let _ = std::fs::remove_dir_all(resource_dir.join("data"));
            }

            run_migrations(&db_path);

            let ext_path = find_extension(&app);

            app.manage(SyncState {
                db_path: Mutex::new(db_path),
                extension_path: Mutex::new(ext_path),
                config: Mutex::new(None),
                stream: tokio::sync::Mutex::new(None),
                last_data_version: Mutex::new(None),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync::sync_get_version,
            sync::sync_init_tables,
            sync::sync_connect,
            sync::sync_now,
            sync::sync_send_changes,
            sync::sync_check_changes,
            sync::sync_has_unsent_changes,
            sync::sync_is_connected,
            sync::sync_disconnect,
            diagnose_storage,
            print::print_ticket,
            close_app,
            write_export,
            export_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
