import { Link } from 'react-router-dom';

export default function ResearchStart({ firstEvent }: { firstEvent?: string }) {
  return <section className="reading-welcome"><h1>资讯</h1><p className="quiet-empty">阅读新闻，再按需了解相关产业与公司。</p>{firstEvent ? <Link to={`/events/${encodeURIComponent(firstEvent)}`}>阅读首条新闻 →</Link> : <Link to="/settings#data">更新新闻与管理来源</Link>}</section>;
}
