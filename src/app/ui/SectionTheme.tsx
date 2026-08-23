import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  alpha, readableOn, sectionTheme, sectionVars, shade,
  type SectionId, type SectionPalette as Theme,
} from './tokens';

/**
 * Puts a section's colour into the tree, both as a value and as CSS variables.
 *
 * Threading a `tone` prop down through every panel and button is what let the
 * old Analytics screens drift amber: the prop was optional, so anything that
 * forgot it silently fell back to the default accent and nobody noticed. A
 * wrapper cannot be forgotten by a child.
 */

const Ctx = createContext<Theme>(sectionTheme('home'));

export function useSection(): Theme {
  return useContext(Ctx);
}

export function SectionTheme({
  section, children, className = '', style,
}: {
  section: SectionId;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const theme = useMemo(() => sectionTheme(section), [section]);
  const vars = useMemo(() => sectionVars(section), [section]);
  return (
    <Ctx.Provider value={theme}>
      <div className={className} style={{ ...vars, ...style } as CSSProperties} data-section-theme={section}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

/**
 * Overrides the section colour for one subtree without a wrapping element's
 * layout getting in the way — used by the few places that are deliberately not
 * their section's colour, such as the manage-items mode inside Inventory.
 */
export function ToneOverride({ color, children }: { color: string; children: ReactNode }) {
  const base = useSection();
  const value = useMemo<Theme>(() => ({
    ...base,
    color,
    on: readableOn(color),
    soft: alpha(color, 0.13),
    softer: alpha(color, 0.22),
    line: alpha(color, 0.42),
    glow: alpha(color, 0.3),
    gradient: `linear-gradient(135deg, ${shade(color, 0.22)} 0%, ${color} 55%, ${shade(color, -0.14)} 100%)`,
    gradientSoft: `linear-gradient(135deg, ${alpha(shade(color, 0.22), 0.24)} 0%, ${alpha(color, 0.1)} 100%)`,
  }), [base, color]);

  // `display: contents` keeps the override out of the layout entirely while
  // still carrying the custom properties down by inheritance.
  const vars: CSSProperties = {
    display: 'contents',
    '--sec': value.color,
    '--sec-on': value.on,
    '--sec-soft': value.soft,
    '--sec-softer': value.softer,
    '--sec-line': value.line,
    '--sec-glow': value.glow,
    '--sec-gradient': value.gradient,
    '--sec-gradient-soft': value.gradientSoft,
  } as CSSProperties;

  return (
    <Ctx.Provider value={value}>
      <span style={vars}>{children}</span>
    </Ctx.Provider>
  );
}
