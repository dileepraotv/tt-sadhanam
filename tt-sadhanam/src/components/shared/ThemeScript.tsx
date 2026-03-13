/**
 * Injected before body renders to avoid flash of wrong theme.
 * Default is 'light' (orange palette with black text).
 */
export function ThemeScript() {
  const script = `
    (function() {
      try {
        var t = localStorage.getItem('tt-theme') || 'light';
        document.documentElement.className = t;
      } catch(e) {
        document.documentElement.className = 'light';
      }
    })();
  `
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
