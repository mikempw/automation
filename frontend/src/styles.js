export const colors = {
  bg: '#f3f4f6',
  surface: '#ffffff',
  surfaceAlt: '#f9fafb',
  surfaceHover: '#f0f4ff',
  border: '#e5e7eb',
  borderActive: '#2563eb',
  text: '#1f2937',
  textMuted: '#6b7280',
  textDim: '#9ca3af',
  accent: '#2563eb',
  accentLight: '#dbeafe',
  accentDark: '#1d4ed8',
  green: '#16a34a',
  greenLight: '#dcfce7',
  greenBg: '#f0fdf4',
  red: '#dc2626',
  redLight: '#fee2e2',
  redBg: '#fef2f2',
  amber: '#d97706',
  amberLight: '#fef3c7',
  amberBg: '#fffbeb',
  cyan: '#0891b2',
  sidebar: '#1e3a5f',
  sidebarHover: '#264a73',
  sidebarActive: '#2d5a8e',
  sidebarText: '#cbd5e1',
  sidebarTextActive: '#ffffff',
  headerBg: '#1e3a5f',
  chatBubbleUser: '#2563eb',
  chatBubbleAssistant: '#ffffff',
};

export const fonts = {
  sans: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  mono: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
};

export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${colors.bg}; color: ${colors.text}; font-family: ${fonts.sans}; font-size: 14px; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
  input, textarea, select {
    background: #fff;
    border: 1px solid ${colors.border};
    color: ${colors.text};
    padding: 9px 12px;
    border-radius: 8px;
    font-family: ${fonts.sans};
    font-size: 14px;
    width: 100%;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  input:focus, textarea:focus, select:focus {
    border-color: ${colors.accent};
    box-shadow: 0 0 0 3px ${colors.accentLight};
  }
  select { cursor: pointer; }
  button {
    cursor: pointer;
    border: none;
    font-family: ${fonts.sans};
    font-size: 14px;
    border-radius: 8px;
    padding: 9px 18px;
    transition: all 0.15s;
    font-weight: 500;
  }
  button:hover { opacity: 0.9; }
  button:active { transform: scale(0.98); }
`;
