import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, User, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { getAppSetting, setAppSetting } from '../../db/persistence';
import {
  Button, DANGER, ELEVATION, GLASS, PRIMARY, SECTION_COLOR, SectionTheme, TextInput,
  alpha, shade, DURATION, EASE, SETTLE,
} from '../ui';

const FALLBACK_USERNAME = 'hottestdad';
const FALLBACK_PASSWORD = 'root';

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validCredentials, setValidCredentials] = useState<{ username: string; password: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let user = await getAppSetting('login_username');
        let pass = await getAppSetting('login_password');
        if (!user || !pass) {
          user = FALLBACK_USERNAME;
          pass = FALLBACK_PASSWORD;
          await setAppSetting('login_username', user);
          await setAppSetting('login_password', pass);
        }
        setValidCredentials({ username: user, password: pass });
      } catch {
        setValidCredentials({ username: FALLBACK_USERNAME, password: FALLBACK_PASSWORD });
      }
      setLoading(false);
    })();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validCredentials) return;

    if (username !== validCredentials.username || password !== validCredentials.password) {
      setError('That username and password do not match. Check for a stray capital letter.');
      return;
    }

    onLogin();
  };

  if (loading) {
    return <div className="screen-h screen-w bg-[var(--app-bg)]" />;
  }

  return (
    <SectionTheme
      section="order"
      className="screen-h screen-w bg-[var(--app-bg)] flex items-center justify-center p-4 relative overflow-hidden"
    >
      {/* A single soft wash behind the card, in the app's own teal. The sign-in
          screen is the first thing anyone sees, and a flat black rectangle with
          a box on it says nothing about the program it opens. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(60% 50% at 50% 38%, ${alpha(SECTION_COLOR.order, 0.14)} 0%, rgba(0,0,0,0) 70%)`,
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={SETTLE}
        className="w-full max-w-sm relative"
      >
        <div
          className="rounded-[20px] border p-[30px]"
          style={{
            background: `${GLASS.panel.background}, var(--app-bg-darker)`,
            borderColor: 'var(--app-border)',
            boxShadow: ELEVATION.high,
          }}
        >
          <div className="flex justify-center mb-[20px]">
            <span
              className="w-[62px] h-[62px] rounded-[18px] flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${shade(SECTION_COLOR.order, 0.2)} 0%, ${SECTION_COLOR.order} 100%)`,
                boxShadow: `0 8px 26px -8px ${alpha(SECTION_COLOR.order, 0.9)}`,
              }}
            >
              <Lock size={26} color="#052E2B" strokeWidth={2.4} />
            </span>
          </div>

          <div className="text-center mb-[24px]">
            <h1 className="text-[var(--app-text)] text-[24px] font-bold leading-[30px]">Hot Dads POS</h1>
            <p className="text-[var(--app-text-secondary)] text-[14px] mt-[3px]">
              Sign in to open the till.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
            <TextInput
              label="Username"
              autoFocus
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              placeholder="Your username"
              capitalize={false}
              icon={<User size={16} />}
            />

            <div className="relative">
              <TextInput
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Your password"
                capitalize={false}
                icon={<Lock size={16} />}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                className="absolute right-[10px] bottom-[11px] p-[6px] rounded-[8px] text-[var(--app-text-muted)] hover:text-[var(--app-text)] transition-colors"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: DURATION.fast, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-center gap-[9px] rounded-[11px] px-[13px] py-[10px]"
                    style={{ background: alpha(DANGER, 0.12), border: `1px solid ${alpha(DANGER, 0.36)}` }}
                  >
                    <AlertCircle size={16} style={{ color: DANGER }} className="shrink-0" />
                    <p className="text-[13px]" style={{ color: DANGER }}>{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" variant="primary" size="lg" block icon={<LogIn size={18} />}>
              Sign in
            </Button>
          </form>
        </div>
      </motion.div>
    </SectionTheme>
  );
}
