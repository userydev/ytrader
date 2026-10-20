import { Component, createElement, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import EditorialPage from './Editorial';
import { NewsUpdateProvider } from './NewsSources';
import './news.css';
import SecuritiesPage from './Securities';
import PanoramaEntry from './PanoramaEntry';
import { EvidenceProvider } from './evidence';
import { WatchProvider } from './watchlist';
import { Empty } from './components';

function LegacyEvent() {
  const { id } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (id) params.set('event', id);
  return <Navigate to={`/events?${params}`} replace />;
}
function LegacyTools() { return <Navigate to="/events" replace />; }
function Shell() {
  const location = useLocation();
  const active = location.pathname.startsWith('/securities') ? 'securities' : location.pathname.startsWith('/chain') ? 'chain' : 'news';
  useEffect(() => { document.title = `${({ news: '新闻', chain: '产业链', securities: '个股' })[active]} · 产业观察`; }, [active]);
  return <div className="app-shell core-product"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
    {createElement('core-navigation', { active })}
    <main id="main-content" tabIndex={-1}>
      <Routes><Route path="/" element={<Navigate to="/events" replace />} /><Route path="/events" element={<EditorialPage />} /><Route path="/events/:id" element={<LegacyEvent />} /><Route path="/sources" element={<LegacyTools />} /><Route path="/securities" element={<SecuritiesPage />} /><Route path="/securities/:symbol" element={<SecuritiesPage />} /><Route path="/chain" element={<PanoramaEntry />} /><Route path="/jobs" element={<Navigate to="/events" replace />} /><Route path="/settings" element={<LegacyTools />} /><Route path="*" element={<Empty title="找不到此页面"><Link to="/events">返回新闻</Link></Empty>} /></Routes>
    </main>
  </div>;
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log response payloads or configuration. */ }
  render() { return this.state.failed ? <div className="fatal-error" role="alert"><h1>页面暂时无法显示</h1><p>请重新载入，或稍后重试。</p><button type="button" onClick={() => window.location.reload()}>重新载入</button></div> : this.props.children; }
}
export default function App() { return <ErrorBoundary><BrowserRouter><WatchProvider><EvidenceProvider><NewsUpdateProvider><Shell /></NewsUpdateProvider></EvidenceProvider></WatchProvider></BrowserRouter></ErrorBoundary>; }
