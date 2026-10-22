from fastapi.testclient import TestClient

from backend.app import create_app
from conftest import security


class ConflictingSnapshots:
    observations = {'SH': {'official_reported': 2320, 'official_observed': 2320, 'cross_reported': 2467, 'reconciliation': 'conflict'}}

    def __init__(self):
        self.calls = []

    def securities(self, exchange):
        self.calls.append(exchange)
        code = {'SH': '600000', 'SZ': '000001', 'BJ': '920000'}[exchange]
        return [security(code, exchange + '原创测试公司', '原创行业', exchange)], exchange != 'SH', 1


def test_coverage_conflict_is_partial_not_missing_or_retry(tmp_path):
    public = ConflictingSnapshots()
    app = create_app(tmp_path, start_worker=False, public=public)
    with TestClient(app) as c:
        job = c.post('/api/v1/sync', json={'kind': 'securities'}).json()['data']
        assert app.state.jobs.run_one()
        assert not app.state.jobs.run_one()
        assert public.calls == ['SH', 'SZ', 'BJ']
        assert app.state.db.job(job['id'])['status'] == 'succeeded'
        coverage = c.get('/api/v1/coverage').json()
        assert coverage['data']['status'] == 'partial'
        assert coverage['data']['missing_exchanges'] == []
        assert coverage['data']['counts'] == {'SH': 1, 'SZ': 1, 'BJ': 1}
        assert any('2467' in w and 'conflict' in w for w in coverage['data']['warnings'])
        assert coverage['meta']['completeness'] == 'partial'
