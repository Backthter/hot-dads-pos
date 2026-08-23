use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;
use std::sync::Arc;

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncConfig {
    pub host: String,
    pub port: u16,
    pub managed_db_id: String,
    pub api_key: String,
    pub connection_string: String,
}

const SYNC_TABLES: &[&str] = &[
    "menu_items",
    "app_categories",
    // Sessions before orders: orders carry a session_id, and a till that syncs
    // the orders without the sessions shows tickets pointing at nothing, with
    // every session-scoped figure silently empty.
    "trading_events",
    "trading_sessions",
    "cost_entries",
    "orders",
    "order_items",
    "parked_sessions",
    "parked_session_cart_items",
    "stock_items",
    "stock_assignments",
    "app_state",
];

fn parse_connection_string(s: &str) -> Result<(String, u16, String, String), String> {
    let after_protocol = s
        .find("://")
        .ok_or_else(|| "Invalid connection string: missing ://".to_string())?;
    let rest = &s[after_protocol + 3..];

    let slash_pos = rest
        .find('/')
        .ok_or_else(|| "Invalid connection string: missing path".to_string())?;

    let host_port = &rest[..slash_pos];
    let (host, port) = if let Some(pos) = host_port.rfind(':') {
        let h = &host_port[..pos];
        let p = host_port[pos + 1..]
            .parse::<u16>()
            .map_err(|_| "Invalid port".to_string())?;
        (h.to_string(), p)
    } else {
        (host_port.to_string(), 8860u16)
    };

    let path_and_query = &rest[slash_pos + 1..];

    let (db_id, query) = path_and_query
        .split_once('?')
        .ok_or_else(|| "Invalid connection string: missing query parameters".to_string())?;

    let managed_db_id = url_decode(db_id);

    let api_key = query
        .split('&')
        .find_map(|part| part.strip_prefix("apikey="))
        .ok_or_else(|| "Invalid connection string: missing apikey".to_string())?;

    Ok((host, port, managed_db_id, api_key.to_string()))
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hi = chars.next().and_then(|c| c.to_digit(16)).unwrap_or(0);
            let lo = chars.next().and_then(|c| c.to_digit(16)).unwrap_or(0);
            result.push(char::from((hi * 16 + lo) as u8));
        } else {
            result.push(c);
        }
    }
    result
}

pub type SyncStream = tokio_rustls::client::TlsStream<tokio::net::TcpStream>;

pub struct SyncState {
    pub db_path: Mutex<PathBuf>,
    pub extension_path: Mutex<PathBuf>,
    pub config: Mutex<Option<SyncConfig>>,
    pub stream: AsyncMutex<Option<SyncStream>>,
    pub last_data_version: Mutex<Option<i64>>,
}

fn open_conn(db_path: &PathBuf, _ext_path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {e}"))?;
    Ok(conn)
}

fn drop_cloudsync_triggers(conn: &Connection) -> Result<(), String> {
    let trigger_names: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%cloudsync_is_sync%'")
        .map_err(|e| format!("Failed to query triggers: {e}"))?
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to query triggers: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    for name in &trigger_names {
        conn.execute_batch(&format!("DROP TRIGGER IF EXISTS [{name}]"))
            .map_err(|e| format!("Failed to drop trigger '{name}': {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn sync_init_tables(state: tauri::State<SyncState>) -> Result<SyncResult, String> {
    let db_path = state.db_path.lock().unwrap().clone();
    let ext_path = state.extension_path.lock().unwrap().clone();
    let conn = open_conn(&db_path, &ext_path)?;
    drop_cloudsync_triggers(&conn)?;
    Ok(SyncResult {
        success: true,
        message: "Cloudsync triggers removed".into(),
    })
}

#[tauri::command]
pub async fn sync_connect(
    state: tauri::State<'_, SyncState>,
    connection_string: String,
) -> Result<SyncResult, String> {
    let (host, port, managed_db_id, api_key) = parse_connection_string(&connection_string)?;

    let config = SyncConfig {
        host: host.clone(),
        port,
        managed_db_id: managed_db_id.clone(),
        api_key: api_key.clone(),
        connection_string,
    };

    let mut stream = scsp_connect(&host, port).await?;
    scsp_send(&mut stream, &format!("AUTH APIKEY {};", api_key)).await?;
    scsp_send(&mut stream, &format!("USE DATABASE {};", managed_db_id)).await?;

    *state.config.lock().unwrap() = Some(config);
    *state.stream.lock().await = Some(stream);

    Ok(SyncResult {
        success: true,
        message: "Connected".into(),
    })
}

async fn scsp_connect(
    host: &str,
    port: u16,
) -> Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>, String> {
    let addr = format!("{}:{}", host, port);
    let tcp = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP connection to {addr} failed: {e}"))?;

    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAllVerifier))
        .with_no_client_auth();

    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let server_name = rustls_pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("Invalid hostname: {e}"))?;
    let tls = connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("TLS handshake with {host} failed: {e}"))?;

    Ok(tls)
}

#[derive(Debug)]
struct AcceptAllVerifier;

impl rustls::client::danger::ServerCertVerifier for AcceptAllVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
        ]
    }
}

async fn scsp_send(
    stream: &mut tokio_rustls::client::TlsStream<tokio::net::TcpStream>,
    command: &str,
) -> Result<String, String> {
    let scsp = format!("+{} {}", command.len(), command);
    stream
        .write_all(scsp.as_bytes())
        .await
        .map_err(|e| format!("Failed to send command: {e}"))?;

    // Read SCSP response: <type><len> <data>
    let mut type_buf = [0u8; 1];
    stream.read_exact(&mut type_buf).await
        .map_err(|e| format!("Failed to read response type: {e}"))?;
    let res_type = type_buf[0] as char;

    // Read length decimal until space
    let mut len_str = String::new();
    loop {
        let mut b = [0u8; 1];
        stream.read_exact(&mut b).await
            .map_err(|e| format!("Failed to read response length: {e}"))?;
        if b[0] == b' ' {
            break;
        }
        len_str.push(b[0] as char);
    }

    let data_len: usize = len_str.parse()
        .map_err(|e| format!("Invalid response length '{}': {e}", len_str))?;

    // Read data payload
    let mut data = vec![0u8; data_len];
    if data_len > 0 {
        stream.read_exact(&mut data).await
            .map_err(|e| format!("Failed to read response data ({data_len} bytes): {e}"))?;
    }

    let response = String::from_utf8_lossy(&data).to_string();

    match res_type {
        '-' => Err(response),
        _ => Ok(response),
    }
}

fn read_table_data(conn: &Connection, table: &str) -> Result<Vec<Vec<serde_json::Value>>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM [{table}]"))
        .map_err(|e| format!("Failed to prepare SELECT from {table}: {e}"))?;

    let col_count = stmt.column_count();
    let mut rows = Vec::new();

    let row_iter = stmt
        .query_map([], |row| {
            let mut values = Vec::new();
            for i in 0..col_count {
                let val = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                    Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::json!(f),
                    Ok(rusqlite::types::ValueRef::Text(s)) => {
                        let s = std::str::from_utf8(s).unwrap_or("");
                        serde_json::Value::String(s.to_string())
                    }
                    Ok(rusqlite::types::ValueRef::Blob(_)) => {
                        serde_json::Value::String("[blob]".to_string())
                    }
                    Err(_) => serde_json::Value::Null,
                };
                values.push(val);
            }
            Ok(values)
        })
        .map_err(|e| format!("Failed to query {table}: {e}"))?;

    for row in row_iter {
        rows.push(row.map_err(|e| format!("Failed to read row from {table}: {e}"))?);
    }

    Ok(rows)
}

fn get_table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info([{table}])"))
        .map_err(|e| format!("Failed to get schema for {table}: {e}"))?;

    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read schema for {table}: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read column names for {table}: {e}"))?;

    Ok(cols)
}

fn escape_sql_string(s: &str) -> String {
    s.replace('\'', "''")
}

fn row_to_insert_sql(
    table: &str,
    columns: &[String],
    row: &[serde_json::Value],
) -> String {
    let col_names: Vec<String> = columns.iter().map(|c| format!("[{}]", c)).collect();
    let col_list = col_names.join(", ");

    let vals: Vec<String> = row
        .iter()
        .map(|v| match v {
            serde_json::Value::Null => "NULL".to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => format!("'{}'", escape_sql_string(s)),
            serde_json::Value::Bool(b) => (if *b { "1" } else { "0" }).to_string(),
            serde_json::Value::Array(arr) => format!(
                "'{}'",
                escape_sql_string(&serde_json::to_string(&arr).unwrap_or_default())
            ),
            serde_json::Value::Object(obj) => format!(
                "'{}'",
                escape_sql_string(&serde_json::to_string(&obj).unwrap_or_default())
            ),
        })
        .collect();

    format!(
        "INSERT OR REPLACE INTO [{}] ({}) VALUES ({});",
        table,
        col_list,
        vals.join(", ")
    )
}

fn collect_upload_data(conn: &Connection) -> Result<(Vec<(String, String)>, Vec<(String, Vec<String>, u64)>), String> {
    let mut creates = Vec::new();
    for table in SYNC_TABLES {
        let ddl: String = conn
            .query_row(
                &format!("SELECT sql FROM sqlite_master WHERE type='table' AND name='{table}'"),
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to read schema for {table}: {e}"))?;
        let create_sql = ddl.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS");
        creates.push((table.to_string(), create_sql));
    }

    let mut table_data = Vec::new();
    for table in SYNC_TABLES {
        let columns = get_table_columns(conn, table)?;
        if columns.is_empty() {
            continue;
        }
        let rows = read_table_data(conn, table)?;
        if rows.is_empty() {
            continue;
        }
        let mut statements = Vec::new();
        for row in &rows {
            statements.push(row_to_insert_sql(table, &columns, row));
        }
        table_data.push((table.to_string(), statements, rows.len() as u64));
    }

    Ok((creates, table_data))
}

async fn send_upload_to_cloud(
    stream: &mut SyncStream,
    creates: &[(String, String)],
    table_data: &[(String, Vec<String>, u64)],
) -> Result<String, String> {

    for (_table, create_sql) in creates {
        scsp_send(stream, create_sql).await?;
    }

    let mut total_rows = 0u64;
    for (_table, statements, row_count) in table_data {
        for stmt in statements {
            scsp_send(stream, stmt).await?;
        }
        total_rows += row_count;
    }

    let table_count = table_data.len();
    let table_info = if table_count > 0 {
        format!(" across {} tables", table_count)
    } else {
        String::new()
    };

    Ok(format!("Uploaded {total_rows} rows{table_info}"))
}

fn write_cloud_data_to_local(conn: &Connection, table_responses: &[(String, Vec<serde_json::Value>, Vec<String>)]) -> Result<(u64, Vec<String>), String> {
    let mut total_rows = 0u64;
    let mut details = Vec::new();
    for (table, rows, columns) in table_responses {
        if rows.is_empty() {
            continue;
        }

        let col_names: Vec<String> = columns.iter().map(|c| format!("[{}]", c)).collect();
        conn.execute(&format!("DELETE FROM [{}]", table), [])
            .map_err(|e| format!("Failed to clear {table}: {e}"))?;

        for row_val in rows {
            let obj = row_val
                .as_object()
                .ok_or_else(|| format!("Row is not an object in {table}"))?;

            let vals: Vec<String> = columns
                .iter()
                .map(|c| {
                    match obj.get(c) {
                        Some(serde_json::Value::Null) | None => "NULL".to_string(),
                        Some(serde_json::Value::Number(n)) => n.to_string(),
                        Some(serde_json::Value::String(s)) => {
                            format!("'{}'", escape_sql_string(s))
                        }
                        Some(serde_json::Value::Bool(b)) => {
                            (if *b { "1" } else { "0" }).to_string()
                        }
                        Some(v) => format!(
                            "'{}'",
                            escape_sql_string(&serde_json::to_string(&v).unwrap_or_default())
                        ),
                    }
                })
                .collect();

            let col_list = col_names.join(", ");
            let sql = format!(
                "INSERT OR REPLACE INTO [{}] ({}) VALUES ({});",
                table,
                col_list,
                vals.join(", ")
            );
            conn.execute(&sql, [])
                .map_err(|e| format!("Failed to insert into {table}: {e}"))?;
        }

        total_rows += rows.len() as u64;
        details.push(format!("{table}: {} rows", rows.len()));
    }

    Ok((total_rows, details))
}

fn get_all_columns(conn: &Connection) -> Vec<(String, Vec<String>)> {
    SYNC_TABLES.iter()
        .map(|t| {
            let cols = get_table_columns(conn, t).unwrap_or_default();
            (t.to_string(), cols)
        })
        .filter(|(_, cols)| !cols.is_empty())
        .collect()
}

async fn query_cloud_tables(
    stream: &mut SyncStream,
    columns_map: &[(String, Vec<String>)],
) -> Result<Vec<(String, Vec<serde_json::Value>, Vec<String>)>, String> {

    let mut results = Vec::new();
    for (table, columns) in columns_map {
        let json_parts: Vec<String> = columns
            .iter()
            .map(|c| format!("'{}', [{}]", c, c))
            .collect();
        let select_sql = format!(
            "SELECT json_group_array(json_object({})) FROM [{}]",
            json_parts.join(", "),
            table
        );

        let resp = scsp_send(stream, &select_sql).await?;

        // SCSP response format: 0:1 N M +{len} {echoed_sql} +{len} {json_result}
        // Extract the last +{digits} payload
        let json_str = match resp.rfind('+') {
            Some(plus_pos) => {
                let after_plus = &resp[plus_pos + 1..];
                let digits_end = after_plus.find(|c: char| !c.is_ascii_digit()).unwrap_or(after_plus.len());
                if digits_end > 0 {
                    let after_digits = &after_plus[digits_end..];
                    after_digits.trim()
                } else {
                    after_plus.trim()
                }
            }
            None => resp.trim(),
        };

        if json_str == "null" || json_str.is_empty() {
            results.push((table.clone(), Vec::new(), columns.clone()));
            continue;
        }

        let rows: Vec<serde_json::Value> =
            serde_json::from_str(json_str).map_err(|e| {
                format!("Failed to parse cloud data for {table}: {e} (response: {resp})")
            })?;

        results.push((table.clone(), rows, columns.clone()));
    }

    Ok(results)
}

#[tauri::command]
pub async fn sync_now(state: tauri::State<'_, SyncState>) -> Result<String, String> {
    let (db_path, ext_path) = {
        let p = state.db_path.lock().unwrap().clone();
        let e = state.extension_path.lock().unwrap().clone();
        (p, e)
    };

    // Try to use existing stream; if dead, reconnect
    let mut stream_guard = 'reconnect: {
        let mut guard = state.stream.lock().await;
        if let Some(ref mut s) = *guard {
            // Quick ping — if USE DATABASE fails, stream is dead
            match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                scsp_send(s, "SELECT 1;"),
            )
            .await
            {
                Ok(Ok(_)) => break 'reconnect guard,
                _ => {
                    // Stream is dead, drop it
                    *guard = None;
                }
            }
        }
        drop(guard);

        // Reconnect using stored config
        let config = state
            .config
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Not connected. Connect first.".to_string())?;

        let mut new_stream = scsp_connect(&config.host, config.port).await?;
        scsp_send(&mut new_stream, &format!("AUTH APIKEY {};", config.api_key)).await?;
        scsp_send(
            &mut new_stream,
            &format!("USE DATABASE {};", config.managed_db_id),
        )
        .await?;

        let mut guard = state.stream.lock().await;
        *guard = Some(new_stream);
        guard
    };

    let conn = open_conn(&db_path, &ext_path)?;

    let mut local_has_data = false;
    for table in SYNC_TABLES {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM [{table}]"), [], |row| row.get(0))
            .unwrap_or(0);
        if count > 0 {
            local_has_data = true;
            break;
        }
    }

    if local_has_data {
        let dv: i64 = conn
            .query_row("PRAGMA data_version", [], |row| row.get(0))
            .unwrap_or(0);
        let (creates, table_data) = collect_upload_data(&conn)?;
        drop(conn);
        let result = send_upload_to_cloud(stream_guard.as_mut().unwrap(), &creates, &table_data).await?;
        *state.last_data_version.lock().unwrap() = Some(dv);
        Ok(format!("Sync Now (upload):\n{result}"))
    } else {
        let columns_map = get_all_columns(&conn);
        drop(conn);
        let cloud_data = query_cloud_tables(stream_guard.as_mut().unwrap(), &columns_map).await?;
        drop(stream_guard);
        let conn2 = open_conn(&db_path, &ext_path)?;
        let (total_rows, details) = write_cloud_data_to_local(&conn2, &cloud_data)?;
        let dv: i64 = conn2
            .query_row("PRAGMA data_version", [], |row| row.get(0))
            .unwrap_or(0);
        *state.last_data_version.lock().unwrap() = Some(dv);
        Ok(format!(
            "Sync Now (download):\nDownloaded {total_rows} rows across {} tables\n{}",
            details.len(),
            details.join("\n"),
        ))
    }
}

#[tauri::command]
pub async fn sync_send_changes(state: tauri::State<'_, SyncState>) -> Result<String, String> {
    let (db_path, ext_path) = {
        let p = state.db_path.lock().unwrap().clone();
        let e = state.extension_path.lock().unwrap().clone();
        (p, e)
    };

    let mut guard = state.stream.lock().await;
    let stream = guard
        .as_mut()
        .ok_or_else(|| "Not connected. Connect first.".to_string())?;

    let conn = open_conn(&db_path, &ext_path)?;
    drop_cloudsync_triggers(&conn)?;
    let dv: i64 = conn
        .query_row("PRAGMA data_version", [], |row| row.get(0))
        .unwrap_or(0);
    let (creates, table_data) = collect_upload_data(&conn)?;
    drop(conn);
    let result = send_upload_to_cloud(stream, &creates, &table_data).await?;
    *state.last_data_version.lock().unwrap() = Some(dv);
    Ok(result)
}

#[tauri::command]
pub async fn sync_check_changes(state: tauri::State<'_, SyncState>) -> Result<String, String> {
    let (db_path, ext_path) = {
        let p = state.db_path.lock().unwrap().clone();
        let e = state.extension_path.lock().unwrap().clone();
        (p, e)
    };

    let mut guard = state.stream.lock().await;
    let stream = guard
        .as_mut()
        .ok_or_else(|| "Not connected. Connect first.".to_string())?;

    let conn = open_conn(&db_path, &ext_path)?;
    drop_cloudsync_triggers(&conn)?;
    let columns_map = get_all_columns(&conn);
    drop(conn);
    let cloud_data = query_cloud_tables(stream, &columns_map).await?;
    drop(guard);
    let conn2 = open_conn(&db_path, &ext_path)?;
    let (total_rows, details) = write_cloud_data_to_local(&conn2, &cloud_data)?;
    let dv: i64 = conn2
        .query_row("PRAGMA data_version", [], |row| row.get(0))
        .unwrap_or(0);
    *state.last_data_version.lock().unwrap() = Some(dv);
    Ok(format!(
        "Downloaded {total_rows} rows across {} tables\n{}",
        details.len(),
        details.join("\n"),
    ))
}

#[tauri::command]
pub fn sync_has_unsent_changes(state: tauri::State<SyncState>) -> Result<bool, String> {
    // If not connected, no point checking
    if !state.config.lock().unwrap().is_some() {
        return Ok(false);
    }

    let db_path = state.db_path.lock().unwrap().clone();
    let ext_path = state.extension_path.lock().unwrap().clone();
    let conn = open_conn(&db_path, &ext_path)?;

    let last = *state.last_data_version.lock().unwrap();
    match last {
        None => {
            // Never synced — show pending if there's any local data
            for table in SYNC_TABLES {
                let count: i64 = conn
                    .query_row(&format!("SELECT COUNT(*) FROM [{table}]"), [], |row| row.get(0))
                    .unwrap_or(0);
                if count > 0 {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        Some(last_ver) => {
            let current: i64 = conn
                .query_row("PRAGMA data_version", [], |row| row.get(0))
                    .unwrap_or(0);
            Ok(current != last_ver)
        }
    }
}

#[tauri::command]
pub async fn sync_disconnect(state: tauri::State<'_, SyncState>) -> Result<SyncResult, String> {
    *state.stream.lock().await = None;
    *state.config.lock().unwrap() = None;
    Ok(SyncResult {
        success: true,
        message: "Disconnected".into(),
    })
}

#[tauri::command]
pub fn sync_get_version(_state: tauri::State<SyncState>) -> Result<String, String> {
    Ok("0.1.0 (SCSP)".into())
}

#[tauri::command]
pub fn sync_is_connected(state: tauri::State<SyncState>) -> bool {
    state.config.lock().unwrap().is_some()
}
