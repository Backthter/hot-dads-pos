import React, { useState, useEffect, useRef } from "react";
import { syncConnect, syncNow, hasUnsentChanges, syncDisconnect, isConnected, resendEverything, diagnoseStorage, type DiagReport } from "./sync-client";
import { ChevronDown, Save, Trash2, Plus, X, BookmarkCheck, Database, CloudOff, Bug, UploadCloud } from "lucide-react";

type SyncStatus = "disconnected" | "connecting" | "connected" | "error";

const PRESETS_KEY = "sync_connection_presets";

interface Preset {
  name: string;
  connectionString: string;
}

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function extractHostname(cs: string): string {
  try {
    const u = new URL(cs.replace("sqlitecloud://", "https://"));
    return u.hostname;
  } catch {
    return "server";
  }
}

export function SyncSettings() {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(-1);
  const [connectionString, setConnectionString] = useState("");
  const [presetName, setPresetName] = useState("");
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  /** Armed but not yet confirmed. A backfill is deliberate or it is nothing. */
  const [confirmingResend, setConfirmingResend] = useState(false);
  const [resending, setResending] = useState(false);
  const presetsInitialized = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const connected = await isConnected();
        if (connected) {
          setStatus("connected");
        }
      } catch {
        // not ready
      }
    };
    check();
  }, []);

  useEffect(() => {
    if (presetsInitialized.current) return;
    presetsInitialized.current = true;
    if (presets.length > 0) {
      setConnectionString(presets[0].connectionString);
      setSelectedPresetIndex(0);
      setPresetName(presets[0].name);
    }
  }, [presets]);

  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(async () => {
      try {
        const has = await hasUnsentChanges();
        setPendingChanges(has);
      } catch {
        // ignore polling errors
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (selectedPresetIndex >= 0 && selectedPresetIndex < presets.length) {
      setPresetName(presets[selectedPresetIndex].name);
    } else {
      setPresetName("");
    }
  }, [selectedPresetIndex, presets]);

  const handleSelectPreset = (index: number) => {
    setSelectedPresetIndex(index);
    if (index >= 0 && index < presets.length) {
      setConnectionString(presets[index].connectionString);
    }
    setDropdownOpen(false);
  };

  const handleSavePreset = () => {
    const trimmed = connectionString.trim();
    if (!trimmed) return;
    const name = presetName.trim() || extractHostname(trimmed);
    const existing = presets.findIndex((p) => p.connectionString === trimmed);
    if (existing >= 0) {
      const updated = presets.map((p, i) =>
        i === existing ? { ...p, name } : p
      );
      setPresets(updated);
      setSelectedPresetIndex(existing);
      savePresets(updated);
      return;
    }
    const updated = [...presets, { name, connectionString: trimmed }];
    setPresets(updated);
    setSelectedPresetIndex(updated.length - 1);
    savePresets(updated);
  };

  const handleUpdatePresetName = () => {
    if (selectedPresetIndex < 0 || selectedPresetIndex >= presets.length) return;
    const name = presetName.trim() || extractHostname(connectionString);
    const updated = presets.map((p, i) =>
      i === selectedPresetIndex ? { ...p, name } : p
    );
    setPresets(updated);
    savePresets(updated);
  };

  const handleDeletePreset = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const updated = presets.filter((_, i) => i !== index);
    setPresets(updated);
    if (index === selectedPresetIndex) {
      setSelectedPresetIndex(-1);
      setPresetName("");
      if (updated.length > 0) {
        setConnectionString(updated[0].connectionString);
        setSelectedPresetIndex(0);
      } else {
        setConnectionString("");
      }
    } else if (index < selectedPresetIndex) {
      setSelectedPresetIndex(selectedPresetIndex - 1);
    }
    savePresets(updated);
  };

  const handleConnect = async () => {
    if (!connectionString.trim()) return;
    setStatus("connecting");
    try {
      await syncConnect(connectionString.trim());
      setStatus("connected");
      setLastSyncResult("Connected");
    } catch (e: unknown) {
      setStatus("error");
      setLastSyncResult(String(e));
    }
  };

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncNow();
      setLastSyncResult(result);
      setPendingChanges(false);
    } catch (e: unknown) {
      setLastSyncResult(String(e));
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Uploads the whole database rather than what has changed.
   *
   * The stock ledger, the daily snapshots and the oversell log only started
   * replicating in Phase 0. Everything recorded before that is on this device
   * and nowhere else, and because those three tables merge by union rather than
   * being replaced, nothing will ever push them on its own. Without one
   * backfill a second till holds movements from today forward and nothing
   * before — which is worse than an empty ledger, because the figures it
   * produces look plausible.
   */
  const handleResendEverything = async () => {
    if (resending) return;
    setConfirmingResend(false);
    setResending(true);
    try {
      const result = await resendEverything();
      setLastSyncResult(`Resent everything:\n${result}`);
      setPendingChanges(false);
    } catch (e: unknown) {
      setLastSyncResult(String(e));
    } finally {
      setResending(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await syncDisconnect();
    } catch {
      // ignore
    }
    setStatus("disconnected");
    setLastSyncResult(null);
    setPendingChanges(false);
    setConfirmingResend(false);
  };

  const statusColor =
    status === "connected"
      ? "text-green-400"
      : status === "error"
        ? "text-red-400"
        : status === "connecting"
          ? "text-yellow-400"
          : "text-zinc-400";

  const statusIcon =
    status === "connected"
      ? <Database size={14} className="text-green-400" />
      : status === "error"
        ? <CloudOff size={14} className="text-red-400" />
        : <CloudOff size={14} className="text-zinc-400" />;

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Connection Error"
        : status === "connecting"
          ? "Connecting..."
          : "Disconnected";

  const selectedPreset = selectedPresetIndex >= 0 ? presets[selectedPresetIndex] : null;

  return (
    <div className="bg-[var(--app-surface)] p-6 rounded-lg">
      <h3 className="text-lg font-semibold text-[var(--app-text)] mb-4 flex items-center gap-2">
        <Database size={18} className="text-[#5BBFB6]" />
        Cloud Sync
      </h3>

      <div className="flex items-center gap-2 mb-4 px-1">
        <div className={`w-2 h-2 rounded-full ${status === "connected" ? "bg-green-400" : status === "error" ? "bg-red-400" : status === "connecting" ? "bg-yellow-400" : "bg-zinc-500"}`} />
        <span className={`text-xs font-medium ${statusColor}`}>
          {statusLabel}
        </span>
        {pendingChanges && status === "connected" && (
          <span className="text-yellow-400 text-[10px] ml-auto bg-yellow-400/10 px-2 py-0.5 rounded-full border border-yellow-400/20">
            pending data
          </span>
        )}
      </div>

      {status !== "connected" ? (
        <div className="space-y-3">
          {/* Preset selector with dropdown */}
          <div ref={dropdownRef} className="relative">
            <div
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 w-full bg-[var(--app-bg-tertiary)] rounded-lg border border-[#52525b] px-3 py-2 cursor-pointer hover:border-[#5BBFB6]/50 transition-colors"
            >
              <BookmarkCheck size={14} className="text-[var(--app-text-secondary)] shrink-0" />
              <span className={`flex-1 text-sm truncate ${selectedPreset ? "text-[var(--app-text)]" : "text-zinc-500"}`}>
                {selectedPreset ? selectedPreset.name : "Select a preset..."}
              </span>
              {selectedPreset && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePreset(e as unknown as React.MouseEvent, selectedPresetIndex);
                  }}
                  className="p-0.5 rounded hover:bg-[#52525b] text-zinc-400 hover:text-[#F9624E] transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <ChevronDown size={14} className={`text-zinc-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </div>

            {dropdownOpen && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-[#2a2a30] border border-[#52525b] rounded-lg shadow-xl overflow-hidden">
                {presets.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-zinc-500 text-center">
                    No saved presets yet
                  </div>
                ) : (
                  presets.map((p, i) => (
                    <div
                      key={i}
                      onClick={() => handleSelectPreset(i)}
                      className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors text-sm ${
                        i === selectedPresetIndex
                          ? "bg-[#5BBFB6]/10 text-[var(--app-text)]"
                          : "text-[var(--app-text)] hover:bg-[#33333a]"
                      }`}
                    >
                      <Database size={12} className="text-[#5BBFB6] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{p.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{p.connectionString}</div>
                      </div>
                      <button
                        onClick={(e) => handleDeletePreset(e, i)}
                        className="p-1 rounded hover:bg-[#52525b] text-zinc-400 hover:text-[#F9624E] transition-colors opacity-0 hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Connection string input */}
          <div className="relative">
            <input
              type="text"
              value={connectionString}
              onChange={(e) => {
                setConnectionString(e.target.value);
                if (selectedPresetIndex >= 0) {
                  setSelectedPresetIndex(-1);
                }
              }}
              placeholder="sqlitecloud://host:port/database?apikey=..."
              className="w-full bg-[var(--app-bg-tertiary)] text-[var(--app-text)] rounded-lg pl-9 pr-3 py-2.5 border border-[#52525b] focus:outline-none focus:border-[#5BBFB6] text-sm placeholder:text-zinc-500"
            />
            <Database size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>

          {/* Preset name + save row */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name..."
                className="w-full bg-[var(--app-bg-tertiary)] text-[var(--app-text)] rounded-lg pl-3 pr-8 py-2 border border-[#52525b] focus:outline-none focus:border-[#5BBFB6] text-sm placeholder:text-zinc-500"
              />
              <button
                onClick={handleSavePreset}
                disabled={!connectionString.trim()}
                title="Save as preset"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-400 hover:text-[#5BBFB6] hover:bg-[#5BBFB6]/10 transition-colors disabled:opacity-30"
              >
                <Save size={14} />
              </button>
            </div>
            {selectedPreset && (
              <button
                onClick={handleUpdatePresetName}
                title="Rename preset"
                className="p-2 rounded text-zinc-400 hover:text-[var(--app-text)] hover:bg-[#52525b] transition-colors"
              >
                <BookmarkCheck size={14} />
              </button>
            )}
          </div>

          <button
            onClick={handleConnect}
            disabled={status === "connecting" || !connectionString.trim()}
            className="w-full bg-[#5BBFB6] text-black px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#4AAFA6] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {status === "connecting" ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <Database size={16} />
                Connect
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-[var(--app-bg-tertiary)] rounded-lg p-3 border border-[#52525b]">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <BookmarkCheck size={14} className="text-[#5BBFB6]" />
              <span className="text-[var(--app-text)] font-medium">{selectedPreset?.name || extractHostname(connectionString)}</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 truncate pl-5">{connectionString}</div>
          </div>

          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="w-full bg-[#5BBFB6] text-black px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#4AAFA6] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Syncing...
              </>
            ) : (
              <>
                <Database size={16} />
                Sync Now
              </>
            )}
          </button>

          {/*
            Resend everything.

            Not automatic, and not folded into Sync Now. Sync Now is the
            everyday action; this one re-uploads the entire history, which over
            a market's phone connection is a decision somebody should make on
            purpose. It is armed first and states what it is for, because the
            reason to press it — a device that has been syncing for months and
            still holds no stock ledger in the cloud — is not something the
            button's name can convey on its own.
          */}
          {confirmingResend ? (
            <div className="bg-[var(--app-bg-tertiary)] rounded-lg p-3 border border-[#FE9A00]/40 space-y-2.5">
              <p className="text-[11px] text-[var(--app-text-secondary)] leading-relaxed">
                This uploads every row this till holds, not just what has changed.
                Use it once after an update that adds tables to sync — the stock
                ledger, the daily snapshots and the oversell log only started
                replicating recently, so anything recorded before that is on this
                device and nowhere else.
              </p>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Nothing is deleted either end. It can take a while on a slow
                connection.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingResend(false)}
                  className="flex-1 text-zinc-400 hover:text-[var(--app-text)] text-xs py-2 rounded-lg border border-[#52525b] transition-colors"
                >
                  Not now
                </button>
                <button
                  onClick={handleResendEverything}
                  className="flex-1 bg-[#FE9A00] text-black text-xs font-semibold py-2 rounded-lg hover:bg-[#E58A00] transition-colors"
                >
                  Resend everything
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingResend(true)}
              disabled={resending || syncing}
              className="w-full text-zinc-400 hover:text-[var(--app-text)] text-xs transition-colors py-2 rounded-lg border border-[#52525b] flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <UploadCloud size={12} />
              {resending ? "Resending everything..." : "Resend everything"}
            </button>
          )}

          <button
            onClick={handleDisconnect}
            className="w-full text-zinc-400 hover:text-[#F9624E] text-xs transition-colors py-1 flex items-center justify-center gap-1"
          >
            <X size={12} />
            Disconnect
          </button>
        </div>
      )}

      {lastSyncResult && (
        <div className="mt-3 relative group">
          <pre className="p-3 bg-[var(--app-bg-tertiary)] rounded-lg text-xs text-[var(--app-text-secondary)] max-h-24 overflow-auto whitespace-pre-wrap select-none">
            {lastSyncResult}
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(lastSyncResult)}
            className="absolute top-1.5 right-1.5 text-[10px] px-2 py-1 bg-[#52525b] text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#63636e]"
          >
            Copy
          </button>
        </div>
      )}

      <Diagnostics />
    </div>
  );
}

function Diagnostics() {
  const [report, setReport] = useState<DiagReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await diagnoseStorage();
      setReport(r);
    } catch (e) {
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-[#52525b]/50">
      <button
        onClick={() => { setOpen(!open); if (!report) run(); }}
        className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        <Bug size={10} />
        Diagnostics
      </button>
      {open && (
        <div className="mt-2 p-2 bg-[var(--app-bg-tertiary)] rounded text-[10px] font-mono text-zinc-400 leading-relaxed max-h-48 overflow-auto">
          {loading ? (
            <span className="text-zinc-500">Checking...</span>
          ) : report ? (
            <>
              <div>DB path: {report.db_path}</div>
              <div>Exists: {String(report.file_exists)} | Size: {report.file_size} bytes | Read-only: {String(report.file_readonly)}</div>
              <div>Open OK: {String(report.can_open_with_rusqlite)} | Write OK: {String(report.can_write_with_rusqlite)}</div>
              <div>menu_items: {report.menu_items} | categories: {report.app_categories} | orders: {report.orders}</div>
              <div>app_state rows: {report.app_state_rows} | db_version: {report.db_version}</div>
              <div>CWD: {report.cwd}</div>
              {report.errors.length > 0 && (
                <div className="text-red-400">Errors: {report.errors.join("; ")}</div>
              )}
            </>
          ) : (
            <span className="text-red-400">Error running diagnostic</span>
          )}
        </div>
      )}
    </div>
  );
}
