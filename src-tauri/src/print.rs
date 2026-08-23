use std::process::Command;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub fn print_ticket(printer_name: String, ticket_text: String) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let ticket_path = temp_dir.join(format!("hotdads_ticket_{}.txt", timestamp));

    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(ticket_text.as_bytes());

    fs::write(&ticket_path, &bytes)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    let printer_arg = if printer_name.is_empty() {
        "Out-Printer".to_string()
    } else {
        format!("Out-Printer -Name '{}'", printer_name.replace('\'', "''"))
    };

    let ps_script = format!(
        "Get-Content -Encoding UTF8 '{}' | {}",
        ticket_path.to_string_lossy(),
        printer_arg
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to execute print command: {}", e))?;

    let _ = fs::remove_file(&ticket_path);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Print failed: {}", stderr))
    }
}
