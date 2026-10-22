from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone

from .adapters import UpstreamError
from .analysis import AnalysisError, validate_result
from .config import UserError
from .db import dump, public_job
from .models import utcnow


class JobFailure(RuntimeError):
    pass


class RetryLater(RuntimeError):
    pass


class Jobs:
    MAX_ATTEMPTS = 3

    def __init__(self, db, settings, research, public, remote, analyzer, companies=None, industries=None):
        self.db, self.settings, self.research = db, settings, research
        self.public, self.remote, self.analyzer = public, remote, analyzer
        self.companies = companies
        self.industries = industries
        self.industry_research = None
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.thread = None

    def recover(self):
        now = utcnow()
        with self.db.transaction() as c:
            c.execute("UPDATE jobs SET status='failed',message='重启后已达重试上限',active_key=NULL,updated_at=? WHERE status IN ('queued','running') AND attempts>=?", (now, self.MAX_ATTEMPTS))
            c.execute("UPDATE jobs SET status='failed',message='进程中断，模型调用结果未知；未自动重试可能计费请求',active_key=NULL,updated_at=? WHERE status='running' AND kind IN ('analyze','company_analyze','industry_generate','industry_supplement','industry_associate','industry_impact','curated_candidate')", (now,))
            c.execute("UPDATE jobs SET status='queued',message='进程重启，恢复待执行任务',updated_at=? WHERE status='running'", (now,))

    def start(self):
        self.recover()
        self.stop.clear()
        self.thread = threading.Thread(target=self.run, name='ytrader-jobs', daemon=True)
        self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=3)

    def enqueue(self, kind, payload=None):
        payload = dict(payload or {})
        with self.settings.lock:
            config = self.settings.get()
            # Persist connection identity only, never credentials or credential hashes.
            for field in ('data_mode', 'ai_mode', 'ycore_url', 'model_base_url', 'model_name',
                          'ai_gateway_url', 'ai_gateway_model', 'ai_config_revision'):
                payload.setdefault(field, getattr(config, field))
        target = payload.get('symbol', '') if kind == 'company_analyze' else payload.get('event_id', '')
        if kind in ('industry_generate', 'industry_supplement'):
            from .industries import fingerprint
            payload['kind'] = kind
            target = fingerprint({key: payload[key] for key in ('industry_id', 'question', 'input_version',
                                                               'model_base_url', 'model_name', 'ycore_url')})
        if kind in ('industry_associate', 'industry_impact', 'curated_candidate'):
            target = payload['input_version']
        revision = str(payload['ai_config_revision']) + ':' if kind in ('analyze', 'company_analyze', 'industry_generate', 'industry_supplement', 'industry_associate', 'industry_impact', 'curated_candidate') else ''
        active = kind + ':' + payload['data_mode'] + ':' + payload['ai_mode'] + ':' + revision + target
        now, jid = utcnow(), str(uuid.uuid4())
        payload['ai_job_id'] = jid
        with self.db.transaction() as c:
            old = c.execute('SELECT * FROM jobs WHERE active_key=?', (active,)).fetchone()
            if old:
                return public_job(old)
            c.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                      (jid, kind, 'queued', 0, '已排队', now, now, dump(payload), 0, active))
            job = public_job(c.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone())
        self.wake.set()
        return job

    def list(self):
        with self.db.connect() as c:
            return [public_job(r) for r in c.execute('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200')]

    def update(self, jid, *, progress=None, message=None, payload=None):
        fields, args = ['updated_at=?'], [utcnow()]
        if progress is not None:
            fields.append('progress=?')
            args.append(progress)
        if message is not None:
            fields.append('message=?')
            args.append(message[:1000])
        if payload is not None:
            fields.append('payload=?')
            args.append(dump(payload))
        with self.db.transaction() as c:
            c.execute('UPDATE jobs SET ' + ','.join(fields) + ' WHERE id=?', args + [jid])

    def run(self):
        while not self.stop.is_set():
            try:
                self.schedule()
                if self.run_one():
                    continue
            except Exception:
                # Worker stays alive, but no raw exception (which could contain a credential/URL).
                self.db.put('worker_warning', '后台调度暂时失败；任务将在下一轮恢复')
            self.wake.wait(1)
            self.wake.clear()

    def schedule(self):
        config = self.settings.get()
        # Never trigger a remote service's global scheduled sync implicitly.
        if config.data_mode != 'local' or config.sync_interval_minutes == 0:
            return
        last = self.db.get('last_scheduled_sync')
        if last:
            seconds = (datetime.now(timezone.utc) - datetime.fromisoformat(last.replace('Z', '+00:00'))).total_seconds()
            if seconds < config.sync_interval_minutes * 60:
                return
        else:
            # First startup is an honest empty state; the first periodic sync is one interval later.
            self.db.put('last_scheduled_sync', utcnow())
            return
        self.enqueue('news' if os.environ.get('YTRADER_NEWS_ONLY') == '1' else 'all')
        self.db.put('last_scheduled_sync', utcnow())

    def run_one(self):
        with self.db.transaction() as c:
            row = c.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if not row:
                return False
            jid, kind, payload = row['id'], row['kind'], json.loads(row['payload'])
            attempt = row['attempts'] + 1
            c.execute("UPDATE jobs SET status='running',attempts=?,updated_at=?,message='执行中' WHERE id=?", (attempt, utcnow(), jid))
        analysis_job = kind in ('analyze', 'company_analyze', 'industry_generate', 'industry_supplement', 'industry_associate', 'industry_impact', 'curated_candidate')
        try:
            config = self.settings.get()
            # Data and AI selection are independent, but an in-flight task must not silently switch hosts.
            if payload['data_mode'] != config.data_mode or (analysis_job and payload['ai_mode'] != config.ai_mode):
                raise JobFailure('服务模式已更改，请重新提交任务')
            if analysis_job:
                with self.settings.lock:
                    self.settings.check_ai_destination(payload)
                payload.setdefault('ai_job_id', jid)
            needs_remote = payload['data_mode'] == 'ycore' or (analysis_job and payload['ai_mode'] == 'ycore' and not config.ai_gateway_url)
            if needs_remote and payload['ycore_url'] != config.ycore_url:
                raise JobFailure('ycore 地址已更改，请重新提交任务')
            if analysis_job and payload['ai_mode'] == 'local' and (payload['model_base_url'] != config.model_base_url or payload['model_name'] != config.model_name):
                raise JobFailure('模型配置已更改，请重新提交任务')
            if kind == 'curated_candidate':
                message = self.curated.run_candidate(jid, payload, self.industries, self.update)
            elif kind == 'industry_impact':
                message = self.industry_research.run_impact(jid, payload, self.update)
            elif kind == 'industry_associate':
                message = self.industry_research.run_association(jid, payload, self.update)
            elif kind in ('industry_generate', 'industry_supplement'):
                message = self.industries.run(jid, payload, self.update)
            elif kind == 'analyze':
                message = self.analyze(jid, payload)
            elif kind == 'company_analyze':
                message = self.companies.run(jid, payload, self.update)
            elif payload['data_mode'] == 'ycore':
                message = self.remote_sync(jid, kind, payload)
            else:
                messages, failures = [], []
                if kind in ('news', 'all'):
                    try:
                        messages.append(self.sync_news(jid))
                    except JobFailure as exc:
                        failures.append(str(exc))
                if kind in ('securities', 'all'):
                    try:
                        messages.append(self.sync_securities(jid))
                    except JobFailure as exc:
                        failures.append(str(exc))
                if failures:
                    # News source backoff is durable and independently scheduled;
                    # do not immediately rerun all feeds for one failed source.
                    if kind == 'news':
                        raise JobFailure('；'.join(failures))
                    raise RetryLater('；'.join(failures))
                message = '；'.join(messages)
        except (UpstreamError, RetryLater) as exc:
            # Do not automatically repeat potentially billable model calls.
            if not analysis_job and attempt < self.MAX_ATTEMPTS:
                status, active_message = 'queued', f'可恢复失败，等待第 {attempt + 1} 次尝试：{str(exc)[:600]}'
            else:
                status, active_message = 'failed', str(exc)[:800]
        except (UserError, JobFailure) as exc:
            status, active_message = 'failed', str(exc)[:800]
        except Exception:
            status, active_message = 'failed', '任务处理失败（响应结构或内部错误）；未生成虚构数据'
        else:
            status, active_message = 'succeeded', message
        with self.db.transaction() as c:
            c.execute('UPDATE jobs SET status=?,progress=?,message=?,updated_at=?,active_key=CASE WHEN ?=\'queued\' THEN active_key ELSE NULL END WHERE id=?',
                      (status, 100 if status == 'succeeded' else self.db.job(jid)['progress'], active_message, utcnow(), status, jid))
        if status == 'queued' and self.thread and not self.stop.is_set():
            self.stop.wait(min(2 ** attempt, 8))
        return True

    def sync_news(self, jid):
        from .news import NewsCollector, latest_publication
        collector = NewsCollector(self.db, self.research, self.public)
        successes, failures, partial, deferred, added = 0, [], [], 0, 0
        for source in self.db.sources():
            if not source.get('enabled') or source.get('paid') or 'news' not in source.get('capabilities', []):
                continue
            outcome = collector.collect(source)
            added += outcome['statistics']['added'] + outcome['statistics']['revisions']
            if outcome['status'] == 'deferred':
                deferred += 1
                if source.get('status') == 'error':
                    failures.append(source['name'])
                elif source.get('status') == 'partial':
                    partial.append(source['name'])
                elif source.get('last_success'):
                    successes += 1
            elif outcome['status'] == 'error':
                failures.append(source['name'])
            else:
                successes += 1
                if outcome['status'] == 'partial':
                    partial.append(source['name'])
            self.update(jid, progress=40, message=f'新闻：新增/修订 {added} 条；失败 {len(failures)} 源；冷却 {deferred} 源')
        with self.db.connect() as c:
            published_as_of = latest_publication(c)
        warnings = ['来源抓取失败或退避中：' + name for name in failures]
        warnings.extend('来源部分条目被拒绝：' + name for name in partial)
        if deferred:
            warnings.append(f'{deferred} 个来源处于有界刷新冷却/失败退避；未重复请求')
        self.db.put('news_sync', dict(as_of=published_as_of, fetched_at=utcnow(),
                    completeness='partial' if failures or partial else ('complete' if successes else 'unavailable'), warnings=warnings))
        # The projection reads immutable versions, never calls AI, and runs even
        # when some feeds failed so successful sources remain usable.
        if os.environ.get('YTRADER_EDITORIAL') == '1':
            from .editorial import Editorial
            Editorial(self.db, self.industry_research).project()
        # A news-only refresh never calls/enqueues AI or refreshes securities.
        if failures:
            raise JobFailure('新闻部分来源失败，已保留成功数据：' + '、'.join(failures))
        return f'新闻同步完成，新增/修订 {added} 条；冷却跳过 {deferred} 源' if successes or deferred else '没有启用的新闻源'

    def sync_securities(self, jid):
        observations, failures, partial, warnings = {}, [], [], []
        for index, exchange in enumerate(('SH', 'SZ', 'BJ')):
            try:
                rows, complete, expected = self.public.securities(exchange)
                with self.db.connect() as c:
                    previous = c.execute('SELECT count(*) FROM securities WHERE exchange=?', (exchange,)).fetchone()[0]
                if previous and len(rows) < previous * .95:
                    complete = False
                    warnings.append(f'{exchange} 本次计数显著小于已有主表，保留未出现证券，不推断退市')
                self.research.store_securities(exchange, rows, complete)
                sources = sorted({r['source'] for r in rows})
                observations[exchange] = dict(observed=len(rows), reported=expected, complete=complete, sources=sources)
                reconciliation = getattr(self.public, 'observations', {}).get(exchange, {})
                observations[exchange].update(reconciliation)
                if reconciliation.get('source_report_dates'):
                    warnings.append(f'{exchange} 源报告日期（原始日粒度，非UTC时刻）={",".join(reconciliation["source_report_dates"])}')
                if reconciliation:
                    warnings.append(f'{exchange} 官方报告={reconciliation.get("official_reported")}；官方观测={reconciliation.get("official_observed")}；交叉源报告={reconciliation.get("cross_reported")}；对账={reconciliation.get("reconciliation")}；不按差额补数或推断退市')
                warnings.append(f'{exchange} 来源={" / ".join(sources)}；源报告总数={expected}；本次观测={len(rows)}；主表为观测快照，不代表独立全市场对账')
                if any('备用源' in s for s in sources):
                    complete = False
                    observations[exchange]['complete'] = False
                    warnings.append(f'{exchange} 官方源不可用，备用源覆盖未经官方对账')
                if not complete:
                    partial.append(exchange)
            except Exception:
                failures.append(exchange)
                observations[exchange] = dict(observed=0, reported=None, complete=False, sources=[])
                warnings.append(exchange + ' 同步失败/超时，保留上次数据，未将缺失证券标记为退市')
            self.update(jid, progress=50 + (index + 1) * 15, message=f'证券：已处理 {exchange}')
        with self.db.connect() as c:
            counts = {e: c.execute('SELECT count(*) FROM securities WHERE exchange=?', (e,)).fetchone()[0] for e in ('SH', 'SZ', 'BJ')}
        warnings.append('as_of 为源发布时间；公开列表未提供统一UTC发布时间，故为 null。抓取时间单独保存在后台观测记录。')
        coverage = dict(as_of=None, counts=counts, status='partial' if failures or partial else 'complete',
                        source='；'.join(e + ': ' + ' / '.join(o['sources']) for e, o in observations.items()),
                        missing_exchanges=[e for e in ('SH', 'SZ', 'BJ') if counts[e] == 0], warnings=warnings)
        self.db.put('coverage', coverage)
        self.db.put('coverage_observations', observations)
        if failures:
            raise JobFailure('证券覆盖不完整：' + ','.join(sorted(set(failures))) + '；已保留各交易所成功数据')
        return '沪深北公开证券快照同步完成，覆盖待核对' if partial else '沪深北公开证券快照同步完成（仅计数一致，未作独立逐代码全市场对账）'

    def remote_sync(self, jid, kind, payload):
        remote_id = payload.get('remote_job_id')
        if not remote_id:
            remote_job = self.remote.call('POST', '/sync', body={'kind': kind})['data']
            remote_id = remote_job['id']
            payload['remote_job_id'] = remote_id
            self.update(jid, payload=payload)
        for _ in range(15):
            jobs = self.remote.call('GET', '/jobs')['data']
            job = next((j for j in jobs if j['id'] == remote_id), None)
            if not job:
                raise UpstreamError('ycore 任务暂时不可见')
            if job['status'] == 'succeeded':
                return 'ycore 数据同步完成'
            if job['status'] == 'failed':
                raise JobFailure('ycore 同步失败，请查看远程服务来源状态')
            self.update(jid, progress=job['progress'], message='等待 ycore 同步')
            if self.stop.wait(1):
                raise RetryLater('服务停止，远程任务将在重启后继续查询')
        raise RetryLater('ycore 同步尚未结束，将继续查询已有任务（不会重复创建）')

    def analyze(self, jid, payload):
        eid, data_mode = payload['event_id'], payload['data_mode']
        self.settings.analysis_ready()
        context, version = self.analyzer.context(eid, data_mode)
        if not context['articles'] and not context['evidence']:
            raise JobFailure('当前事件没有可用于分析的证据')
        self.update(jid, progress=15, message='已读取真实证据，正在请求分析')
        result, model = self.analyzer.local(context, payload)
        association = None
        try:
            if not self.industry_research:
                raise UserError('产业关联服务不可用，保留待核查', 501)
            self.update(jid, progress=75, message='正在核对同新闻版本的具体产业身份与原文证据')
            association = self.industry_research.completion_association(eid, context['articles'], version, payload, jid, self.update)
        except (UserError, UpstreamError):
            with self.settings.lock:
                self.settings.check_ai_destination(payload)
            self.analyzer.save(eid, result, model, version, data_mode)
            raise JobFailure('分析内容已保存，但具体产业身份关联失败或无可靠关联，待核查；未标记整项完成') from None
        with self.settings.lock:
            self.settings.check_ai_destination(payload)
        saved = self.analyzer.save(eid, result, model, version, data_mode, association)
        if saved['status'] != 'complete':
            raise JobFailure('分析期间新闻证据已变化；保留陈旧内容，请按新版本重新分析')
        return '分析与具体产业关联已共同保存；同稿件/证据版本已核对'
