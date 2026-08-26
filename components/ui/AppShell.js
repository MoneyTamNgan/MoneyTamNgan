export default function AppShell({ title, children }) {
  return <main className="app-shell"><div className="page-container"><p className="page-label">{title}</p>{children}</div></main>;
}
