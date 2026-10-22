"""Offline contract/regression tests. Host owns execution and real installation."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from backend.app import create_app
from backend import chain_monitor
from backend.config import UserError
from backend.curated_chains import PREFIX, digest, object_key
from backend.install_maintained import install

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'data/curated-chains/manifest.json'


class NoNetwork:
    def json(self, *args, **kwargs):
        raise AssertionError('No network/model call is allowed in these reads')


class MaintainedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / 'user-data'
        self.app = create_app(self.directory, network=NoNetwork(), start_worker=False)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.curated = self.app.state.curated_chains
        self.panorama = self.app.state.panorama

    def installed(self):
        result = install(self.directory, MANIFEST, self.root / 'installation-report.json')
        self.assertEqual(result['status'], 'ok', result)
        self.assertEqual(len(result['items']), 5)
        return result

    def database_snapshot(self):
        with self.app.state.db.connect() as c:
            return tuple(c.iterdump())

    def copied_manifest(self, mutate=None):
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
        project = self.root / 'project'
        path = project / 'data/curated-chains/manifest.json'
        path.parent.mkdir(parents=True)
        packages = {}
        for item in manifest['items']:
            packages[item['industry_id']] = json.loads((ROOT / item['project_file']).read_text(encoding='utf-8'))
        if mutate:
            mutate(manifest, packages)
        for item in manifest['items']:
            target = project / item['project_file']
            target.parent.mkdir(parents=True, exist_ok=True)
            raw = json.dumps(packages[item['industry_id']], ensure_ascii=False).encode()
            target.write_bytes(raw)
            item['project_sha256'] = hashlib.sha256(raw).hexdigest()
        path.write_text(json.dumps(manifest), encoding='utf-8')
        return path

    def test_monitor_preserves_canonical_metrics_periods_sources_and_exact_hrefs(self):
        self.installed()
        before = self.database_snapshot()
        response = self.client.get('/api/v1/chain-monitor')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        canonical = json.loads(chain_monitor.DATA_FILE.read_text(encoding='utf-8'))
        self.assertEqual(body['meta']['version'], '1')
        self.assertEqual(len(body['data']['sources']), 37)
        self.assertEqual(sum(len(c['metrics']) for c in body['data']['chains']), 72)
        for actual, expected in zip(body['data']['chains'], canonical['chains']):
            state = actual.pop('structure')
            self.assertEqual(actual, expected)  # period/units/series/provenance unchanged
            self.assertEqual(state['status'], 'draft')
            self.assertIsNone(state['current_release'])
            url = urlsplit(state['href'])
            self.assertEqual((url.scheme, url.netloc, url.path), ('', '', '/chain'))
            query = parse_qs(url.query)
            self.assertEqual(query, {'industry': [actual['id']], 'draft_package': [state['draft_package']]})
            graph = self.client.get('/api/v1/panorama/' + actual['id'], params={'draft_package': state['draft_package']})
            self.assertEqual(graph.status_code, 200, graph.text)
            self.assertEqual(graph.json()['data']['version'], 'draft:' + state['draft_package'])
        self.assertEqual(body['data'], canonical)
        self.assertEqual(self.database_snapshot(), before)

    def test_no_startup_or_get_installation(self):
        before = self.database_snapshot()
        response = self.client.get('/api/v1/chain-monitor')
        self.assertEqual(response.status_code, 200, response.text)
        for chain in response.json()['data']['chains']:
            self.assertEqual(chain['structure'], dict(status='not_maintained', current_release=None, draft_package=None, href=None))
        self.assertEqual(self.database_snapshot(), before)
        self.assertTrue(all(not i['drafts'] for i in self.curated.catalog()['items']))

    def test_monitor_missing_file_and_bad_values_are_explicit_errors(self):
        canonical = json.loads(chain_monitor.DATA_FILE.read_text(encoding='utf-8'))
        broken = self.root / 'snapshot.json'
        with patch.object(chain_monitor, 'DATA_FILE', broken):
            response = self.client.get('/api/v1/chain-monitor')
            self.assertEqual(response.status_code, 503)
            self.assertIn('不可用', response.json()['detail'])
        mutations = [
            lambda d: d['chains'][0]['metrics'][0].update(value=float('nan')),
            lambda d: d['chains'][0]['metrics'][0].update(value=float('inf')),
            lambda d: d['chains'][0]['metrics'][0].update(value='126.55'),
            lambda d: d['chains'][0]['metrics'][0].update(value=True),
            lambda d: d['chains'][0]['metrics'][0].update(period='最新'),
            lambda d: d['chains'][0]['metrics'][0].update(period='2026-02-30'),
            lambda d: d['chains'][0]['metrics'][0].update(source='not-a-source'),
            lambda d: d['chains'][0]['metrics'][1].update(id=d['chains'][0]['metrics'][0]['id']),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                data = copy.deepcopy(canonical)
                mutate(data)
                broken.write_text(json.dumps(data), encoding='utf-8')
                with patch.object(chain_monitor, 'DATA_FILE', broken):
                    self.assertEqual(self.client.get('/api/v1/chain-monitor').status_code, 503)

    def test_partial_values_are_not_synthesized(self):
        data = json.loads(chain_monitor.DATA_FILE.read_text(encoding='utf-8'))
        data['chains'][0]['metrics'][0]['value'] = None
        path = self.root / 'partial.json'
        path.write_text(json.dumps(data), encoding='utf-8')
        with patch.object(chain_monitor, 'DATA_FILE', path):
            response = self.client.get('/api/v1/chain-monitor')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['data']['chains'][0]['metrics'][0]['value'])
        self.assertEqual(response.json()['meta']['completeness'], 'partial')
        self.assertTrue(response.json()['meta']['warnings'])

    def test_ycore_never_reads_local_or_calls_remote(self):
        with patch.object(self.app.state.settings, 'get', return_value=SimpleNamespace(data_mode='ycore')):
            with patch.object(chain_monitor, 'snapshot', side_effect=AssertionError('local read')):
                response = self.client.get('/api/v1/chain-monitor')
        self.assertEqual(response.status_code, 501)
        with patch.object(chain_monitor, 'DATA_FILE', self.root / 'absent'):
            with self.assertRaises(UserError) as error:
                chain_monitor.snapshot(self.curated, 'ycore')
        self.assertEqual(error.exception.status, 501)
        for params in ({'draft_package': 'missing'}, {'published_release': 'missing'}):
            with patch.object(self.app.state.settings, 'get', return_value=SimpleNamespace(data_mode='ycore')):
                self.assertEqual(self.client.get('/api/v1/panorama/gold', params=params).status_code, 501)

    def test_install_idempotent_preserves_everything_and_never_publishes(self):
        self.app.state.db.put('user-test-marker', {'keep': True})
        first = self.installed()
        before = self.database_snapshot()
        second = self.installed()
        self.assertEqual(self.database_snapshot(), before)
        self.assertEqual([r['package_id'] for r in first['items']], [r['package_id'] for r in second['items']])
        self.assertTrue(all(r['status'] == 'unchanged' for r in second['items']))
        installed_ids = {item['industry_id'] for item in first['items']}
        for state in self.curated.catalog()['items']:
            self.assertEqual(len(state['drafts']), 1 if state['industry_id'] in installed_ids else 0)
            self.assertIsNone(state['current_release'])
            self.assertEqual(state['publications'], [])
            self.assertEqual(state['activations'], [])
        self.assertEqual(self.app.state.db.get('user-test-marker'), {'keep': True})
        self.assertFalse(first['published'])
        self.assertTrue(all(r['state'] == 'draft' for r in first['items']))

    def test_bad_hash_and_traversal_do_not_write_target(self):
        manifest = self.copied_manifest()
        for mutation in ('hash', 'path'):
            with self.subTest(mutation=mutation):
                data = json.loads(manifest.read_text(encoding='utf-8'))
                if mutation == 'hash':
                    data['items'][0]['project_sha256'] = '0' * 64
                else:
                    data['items'][0]['project_file'] = '../escape.json'
                manifest.write_text(json.dumps(data), encoding='utf-8')
                before = self.database_snapshot()
                result = install(self.directory, manifest, self.root / ('failed-' + mutation + '.json'))
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(self.database_snapshot(), before)
                self.assertTrue(all(r['package_id'] is None for r in result['items']))
                self.assertTrue(any(r['status'] == 'failed' for r in result['items']))

    def test_cross_package_shared_object_conflict_aborts_entire_install(self):
        def mutate(manifest, packages):
            shared = copy.deepcopy(packages['crude-oil']['sources'][0])
            shared['title'] += ' conflicting content with identical source version'
            packages['gold']['sources'].append(shared)
        manifest = self.copied_manifest(mutate)
        before = self.database_snapshot()
        result = install(self.directory, manifest, self.root / 'conflict-report.json')
        self.assertEqual(result['status'], 'failed', result)
        self.assertEqual(self.database_snapshot(), before)
        self.assertTrue(any(i.get('validation', {}).get('errors') for i in result['items']))

    def test_existing_immutable_object_conflict_is_not_deleted(self):
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
        package = json.loads((ROOT / manifest['items'][0]['project_file']).read_text(encoding='utf-8'))
        record = package['nodes'][0]
        key = PREFIX + 'object:' + digest(object_key('node', record))
        changed = dict(record, name=record['name'] + ' user revision content')
        with self.app.state.db.transaction() as c:
            c.execute('INSERT INTO kv VALUES (?,?)', (key, json.dumps(changed)))
        before = self.database_snapshot()
        result = install(self.directory, MANIFEST, self.root / 'existing-conflict.json')
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(self.database_snapshot(), before)

    def test_missing_target_is_not_created(self):
        directory = self.root / 'nonexistent-target'
        result = install(directory, MANIFEST, self.root / 'missing-target-report.json')
        self.assertEqual(result['status'], 'failed')
        self.assertFalse((directory / 'ytrader.sqlite3').exists())

    def test_default_latest_draft_and_explicit_versions_never_fall_back(self):
        self.installed()
        iid = 'gold'
        first = self.curated.detail(iid)['drafts'][-1]['package_id']
        package = copy.deepcopy(self.curated.package(iid, first)['package'])
        package.setdefault('extensions', {})['test_revision'] = 'new saved package'
        second = self.curated.save(iid, package)['package_id']
        default = self.client.get('/api/v1/panorama/' + iid)
        self.assertEqual(default.status_code, 200, default.text)
        self.assertEqual(default.json()['data']['draft']['package_id'], second)
        self.assertEqual(default.json()['meta']['source'], 'sqlite/curated-v02-draft')
        explicit = self.client.get('/api/v1/panorama/' + iid, params={'draft_package': first})
        self.assertEqual(explicit.json()['data']['draft']['package_id'], first)
        for params in ({'draft_package': 'missing'}, {'published_release': 'missing'}, {'result': 'missing-answer'}):
            response = self.client.get('/api/v1/panorama/' + iid, params=params)
            self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.client.get('/api/v1/panorama/' + iid, params={'draft_package': first, 'result': 'base'}).status_code, 422)
        legacy = self.client.get('/api/v1/panorama/' + iid, params={'result': 'base'})
        self.assertEqual(legacy.status_code, 200, legacy.text)
        self.assertNotEqual(legacy.json()['data'].get('status'), 'draft')
        wrong_chain = self.client.get('/api/v1/panorama/crude-oil', params={'draft_package': first})
        self.assertEqual(wrong_chain.status_code, 404)

    def test_current_publication_wins_over_latest_draft_without_publishing(self):
        # Pointer selection unit test: do not fake a reviewed real package or call publish.
        state = dict(industry_id='gold', current_release='exact-release', drafts=[{'package_id': 'later-draft'}],
                     publications=[{'release_id': 'exact-release'}])
        graph = {'industry': {'id': 'gold'}, 'version': 'exact-release'}
        with patch.object(self.curated, 'detail', return_value=state), \
             patch.object(self.curated, 'graph', return_value=graph) as read, \
             patch.object(self.panorama, '_validated', side_effect=lambda validate, value, *args: value), \
             patch.object(self.curated, 'draft_graph', side_effect=AssertionError('draft fallback')):
            actual = self.panorama.industry('gold')['data']
            self.assertEqual(actual['version'], 'exact-release')
            read.assert_called_once_with('gold', None)
            exact = chain_monitor.structure(self.curated, 'gold')
            self.assertEqual(parse_qs(urlsplit(exact['href']).query)['published_release'], ['exact-release'])

    def test_implicit_draft_cannot_be_used_for_news_impact(self):
        self.installed()
        with patch.object(self.app.state.editorial, 'detail', return_value={'current': {'id': 'synthetic-progress'}, 'progresses': []}):
            response = self.client.get('/api/v1/industry-research/gold/impact', params={'news': 'synthetic-news'})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('草稿', response.json()['detail'])

    def test_context_and_positions_match_default_draft_and_invalidate_on_new_package(self):
        self.installed()
        context = self.client.get('/api/v1/panorama/context')
        self.assertEqual(context.status_code, 200, context.text)
        for iid, identity in context.json()['data']['graph_identities'].items():
            graph = self.panorama.industry(iid)['data']
            self.assertEqual(identity['version'], graph['version'])
            self.assertEqual(identity['companies'], graph['companies'])
            self.assertEqual(identity['participations'], graph['participations'])
            self.assertEqual(identity['status'], 'draft')
        graph = self.panorama.industry('crude-oil')['data']
        symbols = [s['symbol'] for s in graph['securities']]
        # Existing context position lists cannot retain stale node IDs for a
        # replaced chain. Unrelated identities and historical profiles survive.
        old_context = {'items': [{'symbol': symbols[0], 'name': 'original master name', 'positions': [
            {'industry_id': 'crude-oil', 'node_id': 'old-static-node'},
            {'industry_id': 'unrelated', 'node_id': 'keep-node'}]}]}
        projected = self.panorama._security_context(old_context, {'crude-oil': graph})
        record = projected['items'][0]
        self.assertEqual(record['name'], 'original master name')
        self.assertIn({'industry_id': 'unrelated', 'node_id': 'keep-node'}, record['positions'])
        self.assertFalse(any(r['node_id'] == 'old-static-node' for r in record['positions']))
        self.assertTrue(all(r['draft_package'] == graph['draft']['package_id'] for r in record['positions'] if r['industry_id'] == 'crude-oil'))
        positions = self.panorama.company_positions(symbols)['data']
        matched = 0
        for item in positions['items']:
            for role in item['roles']:
                if role['industry_id'] != 'crude-oil':
                    continue
                matched += 1
                self.assertEqual(role['status'], 'draft')
                self.assertEqual(role['draft_package'], graph['draft']['package_id'])
                self.assertIn(role['node_id'], {n['id'] for n in graph['nodes']})
                self.assertFalse(role['verified_binding'])
                self.assertIsNone(role['graph_release_id'])
        self.assertGreater(matched, 0)
        key = self.panorama._curated_positions
        package = copy.deepcopy(self.curated.package('crude-oil', graph['draft']['package_id'])['package'])
        package.setdefault('extensions', {})['position_cache_test'] = True
        saved = self.curated.save('crude-oil', package)
        changed = self.panorama.company_positions(symbols)['data']
        self.assertNotEqual(self.panorama._curated_positions, key)
        for item in changed['items']:
            for role in item['roles']:
                if role['industry_id'] == 'crude-oil':
                    self.assertEqual(role['draft_package'], saved['package_id'])


if __name__ == '__main__':
    unittest.main()
