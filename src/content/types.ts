// Content-domain compatibility types. The root shared file is outside this task's
// writable scope; nullable URL evidence must nevertheless remain honest on the wire.
import type * as Base from '../content-types';
export * from '../content-types';
export interface News extends Omit<Base.News,'url'> { url: string | null }
export interface NewsItem extends Omit<Base.NewsItem,'url'> { url: string | null }
export interface ContentBundle extends Omit<Base.ContentBundle,'news'> { news: News[] }
export interface NewsPage extends Omit<Base.NewsPage,'items'> { items: NewsItem[] }
export interface Overview extends Omit<Base.Overview,'recent_news'> { recent_news: NewsItem[] }
export interface NewsDetail extends Omit<Base.NewsDetail,'news'> { news: NewsItem }
export interface IndustryDetail extends Omit<Base.IndustryDetail,'news'> { news: NewsItem[] }
export interface CompanyDetail extends Omit<Base.CompanyDetail,'news'> { news: NewsItem[] }
