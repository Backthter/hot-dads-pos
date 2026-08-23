import { invoke } from "@tauri-apps/api/core";

export interface SyncResult {
  success: boolean;
  message: string;
}

// --- OLD API (used by App.tsx auto-sync) ---

export async function initSyncTables(): Promise<SyncResult> {
  return invoke<SyncResult>("sync_init_tables");
}

export async function sendChanges(): Promise<string> {
  return invoke<string>("sync_send_changes");
}

export async function checkChanges(): Promise<string> {
  return invoke<string>("sync_check_changes");
}

export async function getSyncVersion(): Promise<string> {
  return invoke<string>("sync_get_version");
}

// --- NEW API (used by SyncSettings.tsx) ---

export async function syncConnect(connectionString: string): Promise<SyncResult> {
  await initSyncTables();
  return invoke<SyncResult>("sync_connect", { connectionString });
}

export async function syncNow(): Promise<string> {
  return invoke<string>("sync_now");
}

export async function hasUnsentChanges(): Promise<boolean> {
  return invoke<boolean>("sync_has_unsent_changes");
}

export async function syncDisconnect(): Promise<SyncResult> {
  return invoke<SyncResult>("sync_disconnect");
}

export async function isConnected(): Promise<boolean> {
  return invoke<boolean>("sync_is_connected");
}

export interface DiagReport {
  db_path: string;
  app_data_dir: string;
  cwd: string;
  file_exists: boolean;
  file_size: number;
  file_readonly: boolean;
  menu_items: number;
  app_categories: number;
  orders: number;
  order_items: number;
  app_state_rows: number;
  db_version: string;
  can_open_with_rusqlite: boolean;
  can_write_with_rusqlite: boolean;
  errors: string[];
}

export async function diagnoseStorage(): Promise<DiagReport> {
  return invoke<DiagReport>("diagnose_storage");
}
