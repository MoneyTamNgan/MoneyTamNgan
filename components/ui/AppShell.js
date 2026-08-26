export default function AppShell({ title, children, hideTitle = false }) {
  return <main className="app-shell"><div className="page-container">{!hideTitle && <p className="page-label">{title}</p>}{children}</div></main>;
}
