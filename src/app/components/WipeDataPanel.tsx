import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Lock, ShieldAlert, User } from 'lucide-react';
import { getAppSetting } from '../../db/persistence';

const DANGER = '#F9624E';
const CONFIRM_PHRASE = 'WIPE';

export type WipeScope = 'history' | 'everything';

/**
 * Erasing data is guarded three ways: the username, the password, and typing a
 * word by hand. None of them is security against a determined person with the
 * machine — they are there so this cannot happen by accident, which is the
 * realistic failure mode for a button that destroys a year of trading.
 *
 * It exists because several analytics facts — line costs, stage timestamps,
 * oversells — start being recorded the day they ship and cannot be back-filled.
 * Drawing a clean line is sometimes the honest option.
 */
export function WipeDataPanel({ onWipe }: { onWipe: (scope: WipeScope) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<WipeScope>('history');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setUsername(''); setPassword(''); setPhrase(''); setError('');
  };

  const armed = username.length > 0 && password.length > 0 && phrase.trim().toUpperCase() === CONFIRM_PHRASE;

  const attempt = async () => {
    if (!armed || working) return;
    setError('');
    const savedUser = (await getAppSetting('login_username')) ?? 'hottestdad';
    const savedPass = (await getAppSetting('login_password')) ?? 'root';
    if (username !== savedUser || password !== savedPass) {
      setError('Those are not the sign-in details for this till.');
      return;
    }
    setWorking(true);
    await onWipe(scope);
    setWorking(false);
    setDone(true);
    reset();
    window.setTimeout(() => { setDone(false); setOpen(false); }, 1600);
  };

  return (
    <div
      className="rounded-[14px] p-[18px]"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 100%), var(--app-bg-darker)',
        border: `1px solid ${open ? DANGER : 'var(--app-border)'}`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.28), 0 4px 12px -6px rgba(0,0,0,0.45)',
      }}
      data-wipe-panel
    >
      <div className="flex items-center justify-between">
        <div className="pr-6">
          <h3 className="text-[17px] font-bold leading-[22px] flex items-center gap-[8px]" style={{ color: DANGER }}>
            <ShieldAlert size={19} /> Wipe data
          </h3>
          <p className="text-[var(--app-text-secondary)] text-[13px] leading-[19px] mt-[4px] max-w-[62ch]">
            Deletes your trading history for good and starts the figures again from nothing.
            There is no copy kept and no way back — not even with Ctrl+Z. Anything wiped is
            gone, and cannot be filled back in later.
          </p>
        </div>
        <button
          onClick={() => { setOpen(o => !o); reset(); }}
          data-wipe-toggle
          className="px-4 h-11 rounded-[10px] text-sm font-semibold border shrink-0 transition-colors"
          style={{
            borderColor: DANGER,
            background: open ? DANGER : 'transparent',
            color: open ? '#1B0805' : DANGER,
          }}
        >
          {open ? 'Cancel' : 'Wipe…'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="overflow-hidden"
          >
            <div className="pt-6 mt-6 border-t border-[var(--app-border)] flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    id: 'history' as const,
                    title: 'Trading history only',
                    detail: 'Orders, parked tickets, sessions and events, logged costs, the stock ledger, snapshots and oversells. Your menu, categories, stock items, recipes and packets stay.',
                  },
                  {
                    id: 'everything' as const,
                    title: 'Everything',
                    detail: 'Also removes the menu, categories, stock items and recipes. The till comes back empty.',
                  },
                ]).map(option => {
                  const active = scope === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setScope(option.id)}
                      data-wipe-scope={option.id}
                      className="text-left rounded-[12px] border p-4 transition-colors"
                      style={{
                        borderColor: active ? DANGER : 'var(--app-border)',
                        background: active ? `${DANGER}14` : 'var(--app-bg-darker)',
                      }}
                    >
                      <span className="block text-[var(--app-text)] text-[15px] font-semibold mb-1">
                        {option.title}
                      </span>
                      <span className="block text-[var(--app-text-muted)] text-[12px] leading-[16px]">
                        {option.detail}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field icon={<User size={14} />} label="Username">
                  <input
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    data-wipe-username
                    className="w-full bg-transparent text-[var(--app-text)] text-[14px] focus:outline-none"
                  />
                </Field>
                <Field icon={<Lock size={14} />} label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    data-wipe-password
                    className="w-full bg-transparent text-[var(--app-text)] text-[14px] focus:outline-none"
                  />
                </Field>
                <Field icon={<AlertTriangle size={14} />} label={`Type ${CONFIRM_PHRASE}`}>
                  <input
                    value={phrase}
                    onChange={e => setPhrase(e.target.value)}
                    data-wipe-phrase
                    className="w-full bg-transparent text-[var(--app-text)] text-[14px] tracking-[1px] focus:outline-none"
                  />
                </Field>
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-[13px] font-semibold"
                  style={{ color: DANGER }}
                  data-wipe-error
                >
                  {error}
                </motion.p>
              )}

              <motion.button
                onClick={attempt}
                disabled={!armed || working}
                whileTap={armed ? { scale: 0.98 } : undefined}
                data-wipe-confirm
                className="h-12 rounded-[10px] text-[15px] font-bold flex items-center justify-center gap-2 transition-opacity"
                style={{
                  background: DANGER,
                  color: '#1B0805',
                  opacity: armed && !working ? 1 : 0.35,
                  cursor: armed && !working ? 'pointer' : 'not-allowed',
                }}
              >
                {done
                  ? <><Check size={17} /> Wiped</>
                  : working
                    ? 'Wiping…'
                    : scope === 'everything' ? 'Wipe everything' : 'Wipe trading history'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px] font-semibold flex items-center gap-[6px]">
        {icon} {label}
      </span>
      <span className="flex items-center bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[10px] px-3 h-11">
        {children}
      </span>
    </label>
  );
}
