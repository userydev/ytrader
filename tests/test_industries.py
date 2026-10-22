"""Industry library and AI boundaries. Synthetic model responses only; no live calls."""
import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import Network
from backend.app import create_app, envelope
from backend.industries import IndustryError, graph_fields, validate_graph
from backend.models import ConfigUpdate


def configured(app, **changes):
    app.state.settings.update(ConfigUpdate(model_base_url='https://model.example/v1', model_name='industry-test',
                                           model_api_key='synthetic-test-key', **changes))


def candidate(snapshot):
    if snapshot.get('base'):
        graph = copy.deepcopy(snapshot['base'])
        for company in graph['companies']:
            company.pop('symbol', None)
            company.pop('identity_note', None)
        return graph
    return dict(industry=dict(id=snapshot['industry_id'], name=snapshot['name'], demand='满足低空运输与作业需求',
                              boundary='只解释典型分工，不代表全覆盖或市场准入结论', summary='装备和服务共同支撑作业'),
                nodes=[dict(id='aircraft', name='飞行器', kind='product', description='执行飞行任务', sources=[]),
                       dict(id='operations', name='飞行运营', kind='activity', description='组织具体作业', sources=[]),
                       dict(id='infrastructure', name='起降与运行配套', kind='service', description='支撑运行', sources=[])],
                relations=[dict(id='r1', from_id='aircraft', to_id='operations', kind='used_for', explanation='装备服务作业任务', sources=[]),
                           dict(id='r2', from_id='infrastructure', to_id='operations', kind='supports', explanation='配套提供运行条件', sources=[])],
                companies=[], participations=[], sources=[],
                structure=dict(version=1, organization='mixed',
                               thesis='飞行器支撑飞行运营，起降与运行配套提供作业条件。',
                               groups=[dict(id='equipment', title='飞行装备', role='core',
                                            purpose='提供执行低空运输与作业任务的飞行器。', node_ids=['aircraft']),
                                       dict(id='service', title='组织运营', role='core',
                                            purpose='组织飞行器执行具体运输与作业任务。', node_ids=['operations']),
                                       dict(id='facilities', title='运行配套', role='support',
                                            purpose='提供飞行运营所需的起降与运行条件。', node_ids=['infrastructure'])],
                               primary_relation_ids=['r1'], reading_order=['equipment', 'service', 'facilities']),
                explanation=dict(overview='低空作业需要装备、运营与配套协作，而不是公司之间依次传递物料。',
                                 steps=[dict(title='组织作业', text='飞行器与设施共同支撑运营。', node_ids=['aircraft', 'operations', 'infrastructure'], sources=[])],
                                 distinctions=[dict(title='装备不等于运营', text='生产产品与组织作业是不同角色。', sources=[])],
                                 questions=['飞控如何连接？'], gaps=['未穷举技术路线和监管要求']))


def ai_capabilities():
    return dict(contract_version='1', transport='sync', configured=True,
                chat_endpoint='/api/v1/ai/chat', purposes=['industry_structure'], response_formats=['json'],
                max_input_bytes=500000, max_output_tokens=8000, models=['remote-industry-model'])


def model_handler(state, calls):
    def handler(request):
        calls.append(request)
        assert request.url.host == 'model.example' and request.url.path == '/v1/chat/completions'
        payload = json.loads(request.content)
        assert payload['max_tokens'] == 6000
        assert '一般知识' in payload['messages'][0]['content']
        snapshot = json.loads(payload['messages'][1]['content'])
        graph = candidate(snapshot)
        if state.get('mutate'):
            state['mutate'](graph)
        return httpx.Response(200, json={'id': 'chatcmpl-industry', 'object': 'chat.completion', 'created': 1700000000,
            'model': 'actual-industry-model', 'choices': [{'index': 0, 'finish_reason': state.get('finish', 'stop'),
            'message': {'role': 'assistant', 'content': json.dumps(graph, ensure_ascii=False)}}],
            'usage': {'prompt_tokens': 120, 'completion_tokens': 60, 'total_tokens': 180}})
    return handler


def test_public_library_is_readable_without_model_and_does_not_inject_securities(app, client):
    items = client.get('/api/v1/industries').json()['data']['items']
    assert {x['id'] for x in items} == {'ai-compute', 'crude-oil', 'innovative-drugs'}
    for item in items:
        data = client.get('/api/v1/industries/' + item['id']).json()['data']
        base = data['base']
        assert base['origin'] == 'public_reference'
        assert data['results'] == [] and data['job'] is None
        assert validate_graph(graph_fields(base))
        assert base['explanation']['overview'] and base['explanation']['steps']
        assert all(p['sources'] for p in base['participations'])
    oil = client.get('/api/v1/industries/crude-oil').json()['data']['base']
    assert len([r for r in oil['relations'] if r['from_id'] == 'refining' and r['kind'] == 'produces']) == 2
    drugs = client.get('/api/v1/industries/innovative-drugs').json()['data']['base']
    assert {'precedes', 'supports'} <= {r['kind'] for r in drugs['relations']}
    assert 'FDA' in drugs['industry']['boundary'] and '中国' in drugs['industry']['boundary']
    roles = client.get('/api/v1/securities/SZ:000977/industries').json()['data']['items']
    assert roles[0]['id'] == 'ai-compute' and {r['node'] for r in roles[0]['roles']} == {'AI服务器', '集群管理与调度软件'}
    with app.state.db.connect() as c:
        assert c.execute('SELECT count(*) FROM securities').fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM jobs').fetchone()[0] == 0
    assert client.get('/api/v1/chain/topics').json()['data']['items'] == []


@pytest.mark.parametrize('questions,expected', [
    ([], []),
    (['原有字符串问题？'], ['原有字符串问题？']),
    ([dict(title='标题')], ['标题']),
    ([dict(title=' 网络如何支撑集群？ ')], ['网络如何支撑集群？']),
    ([dict(title='网络配套', text='网络如何支撑集群？')], ['网络配套：网络如何支撑集群？']),
    (['原有字符串问题？', dict(title=' 网络配套 ', text=' 网络如何支撑集群？ '),
      dict(title='哪些配套可以并行建设？')],
     ['原有字符串问题？', '网络配套：网络如何支撑集群？', '哪些配套可以并行建设？']),
])
def test_ai_question_formats_preserve_content_without_mutating_input(questions, expected):
    graph = candidate(dict(industry_id='ai-test', name='低空经济'))
    graph['explanation']['questions'] = copy.deepcopy(questions)
    before = copy.deepcopy(graph)
    output = validate_graph(graph, ai=True, industry_id='ai-test')
    assert output['explanation']['questions'] == expected
    assert graph == before
    assert output['nodes'] == graph['nodes'] and output['relations'] == graph['relations']


def test_original_title_only_ai_questions_preserve_exact_content():
    graph = candidate(dict(industry_id='ai-test', name='低空经济'))
    graph['explanation']['questions'] = [
        {'title': '先进制程中EDA工具与半导体设备处于什么链路？'},
        {'title': 'CoWoS等2.5D封装与传统引线键合封装有何本质差异？'},
    ]
    before = copy.deepcopy(graph)
    output = validate_graph(graph, ai=True, industry_id='ai-test')
    assert output['explanation']['questions'] == [
        '先进制程中EDA工具与半导体设备处于什么链路？',
        'CoWoS等2.5D封装与传统引线键合封装有何本质差异？',
    ]
    assert graph == before


@pytest.mark.parametrize('questions', [
    None, '问题？', dict(title='标题', text='问题？'),
    [''], [' \n '], [None], [1], [True], [[]], [{}],
    [dict(text='问题？')],
    [dict(title='')], [dict(title=' \n ')], [dict(title=None)],
    [dict(title=1)], [dict(title=False)], [dict(title=['标题'])],
    [dict(title='标题', unknown='不能丢弃')], [dict(title='标题', sources=[])],
    [dict(title='问' * 4001)], [dict(title='问题？')] * 13,
    [dict(title='', text='问题？')], [dict(title=' \n ', text='问题？')],
    [dict(title='标题', text='')], [dict(title='标题', text=' \n ')],
    [dict(title=None, text='问题？')], [dict(title='标题', text=None)],
    [dict(title=1, text='问题？')], [dict(title='标题', text=False)],
    [dict(title=['标题'], text='问题？')], [dict(title='标题', text=dict(value='问题？'))],
    [dict(title='标题', text='问题？', sources=[])],
    [dict(title='标题', text='问题？', unknown='不能丢弃')],
    [dict(title='标题', text='问题？'), dict(title='标题', body='未知格式')],
    [dict(title='标题', text='问' * 4000)],
    [dict(title='标题', text='问题？')] * 13,
])
def test_invalid_ai_questions_are_not_repaired(questions):
    graph = candidate(dict(industry_id='ai-test', name='低空经济'))
    graph['explanation']['questions'] = questions
    with pytest.raises(IndustryError):
        validate_graph(graph, ai=True, industry_id='ai-test')


def test_question_object_compatibility_is_not_applied_to_public_graphs(app):
    graph = graph_fields(app.state.industries.base('ai-compute'))
    assert validate_graph(graph)
    graph['explanation']['questions'] = [dict(title='网络配套', text='网络如何支撑集群？')]
    with pytest.raises(IndustryError):
        validate_graph(graph)


@pytest.mark.parametrize('question_objects', [False, True])
@pytest.mark.parametrize('mutation', [
    lambda g: g['relations'][0].update(to_id='unknown'),
    lambda g: g['nodes'].append(copy.deepcopy(g['nodes'][0])),
    lambda g: g['nodes'][0].update(kind='company'),
    lambda g: g['relations'][0].update(kind='upstream'),
    lambda g: g['relations'][0].update(sources=['made-up']),
    lambda g: g['explanation']['steps'][0].update(node_ids=['unknown']),
    lambda g: g['participations'].append(dict(company_id='nobody', node_id='aircraft', role='测试', sources=[])),
    lambda g: g.update(origin='public_reference'),
    lambda g: g.update(companies=[dict(id='fake', name='测试', symbol='SZ:000977')],
                       participations=[dict(company_id='fake', node_id='aircraft', role='提供装备', sources=[])]),
    lambda g: g['sources'].append(dict(id='invented', title='虚构', publisher='模型', url='https://example.org/fake', locator='虚构', checked_at='2026-01-01', access='page_text')),
])
def test_malformed_ai_graph_rejected(mutation, question_objects):
    graph = candidate(dict(industry_id='ai-test', name='低空经济'))
    if question_objects:
        graph['explanation']['questions'] = [dict(title='网络配套', text='网络如何支撑集群？')]
    mutation(graph)
    with pytest.raises(IndustryError):
        validate_graph(graph, ai=True, industry_id='ai-test')


@pytest.mark.parametrize('question_objects', [False, True])
@pytest.mark.parametrize('field,value', [('url', 'https://example.org/invented'), ('title', '伪造来源标题')])
def test_given_source_ids_allowed_but_source_text_and_url_cannot_be_rewritten(app, question_objects, field, value):
    base = app.state.industries.base('ai-compute')
    graph = candidate(dict(base=graph_fields(base)))
    if question_objects:
        graph['explanation']['questions'] = [dict(title='网络配套', text='网络如何支撑集群？')]
    output = validate_graph(graph, ai=True, supplied=base['sources'], industry_id='ai-compute')
    assert output['industry']['basis'] == 'ai_knowledge'
    assert all(c['symbol'] is None for c in output['companies'])
    graph['sources'][0][field] = value
    with pytest.raises(IndustryError):
        validate_graph(graph, ai=True, supplied=base['sources'], industry_id='ai-compute')


def test_generation_is_opt_in_deduplicated_persistent_and_keeps_actual_model(tmp_path):
    calls, state = [], {}
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler(state, calls))))
    configured(app)
    with TestClient(app) as client:
        assert client.get('/api/v1/industries').status_code == 200 and not calls
        first = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        duplicate = client.post('/api/v1/industries/generate', json={'name': '低空 经济'}).json()['data']
        other = client.post('/api/v1/industries/generate', json={'name': '机器人'}).json()['data']
        assert first['id'] == duplicate['id'] and other['id'] != first['id']
        assert not calls and 'payload' not in first
        assert first['target_url'].startswith('/chain?industry_id=')
        iid = first['target_url'].split('industry_id=')[1]
        pending = client.get('/api/v1/industries/' + iid).json()['data']
        assert pending['base'] is None and pending['job']['status'] == 'queued'
        assert app.state.jobs.run_one()
        assert app.state.db.job(first['id'])['status'] == 'succeeded'
        detail = client.get('/api/v1/industries/' + iid).json()['data']
        assert detail['base']['origin'] == 'ai'
        assert detail['base']['model'] == 'actual-industry-model'
        assert detail['base']['sources'] == [] and detail['base']['relations']
        assert detail['results'][0]['input_version'] == 'new'
        assert client.post('/api/v1/industries/generate', json={'name': '低空 经济'}).status_code == 409
    restarted = create_app(tmp_path, start_worker=False)
    with TestClient(restarted) as client:
        assert client.get('/api/v1/industries/' + iid).json()['data']['base'] == detail['base']
        assert any(x['id'] == iid for x in client.get('/api/v1/industries').json()['data']['items'])


def test_supplement_dedup_failure_preserves_result_and_base_changes_mark_stale(tmp_path, monkeypatch):
    calls, state = [], {}
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler(state, calls))))
    configured(app)
    path = '/api/v1/industries/ai-compute'
    with TestClient(app) as client:
        base = client.get(path).json()['data']['base']
        request = {'question': '请解释网络与集群'}
        first = client.post(path + '/supplement', json=request).json()['data']
        assert client.post(path + '/supplement', json=request).json()['data']['id'] == first['id']
        different = client.post(path + '/supplement', json={'question': '请展开芯片制造与封装'}).json()['data']
        assert different['id'] != first['id']
        app.state.jobs.run_one()
        old = client.get(path).json()['data']['results'][0]
        assert old['origin'] == 'ai' and not old['stale']
        state['mutate'] = lambda graph: graph['relations'][0].update(to_id='missing')
        app.state.jobs.run_one()
        assert app.state.db.job(different['id'])['status'] == 'failed'
        detail = client.get(path).json()['data']
        assert detail['base'] == base and detail['results'] == [old]
        refs = app.state.industries.references()
        refs['ai-compute']['input_version'] = 'new-public-version'
        monkeypatch.setattr(app.state.industries, 'references', lambda: copy.deepcopy(refs))
        stale = client.get(path).json()['data']['results'][0]
        assert stale['id'] == old['id'] and stale['stale']
        state.clear()
        changed = client.post(path + '/supplement', json=request).json()['data']
        refs['ai-compute']['input_version'] = 'changed-again'
        before = len(calls)
        app.state.jobs.run_one()
        assert app.state.db.job(changed['id'])['status'] == 'failed' and len(calls) == before


def test_supplement_question_objects_save_without_overwriting_prior_content(tmp_path):
    calls, state = [], {}
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler(state, calls))))
    configured(app)
    path = '/api/v1/industries/ai-compute'
    with TestClient(app) as client:
        base = client.get(path).json()['data']['base']
        client.post(path + '/supplement', json={'question': '先解释网络'})
        assert app.state.jobs.run_one()
        old = client.get(path).json()['data']['results'][0]

        questions = [dict(title='网络配套', text='网络如何支撑集群？'),
                     dict(title='并行配套', text='哪些配套可以并行建设？')]
        state['mutate'] = lambda graph: graph['explanation'].update(questions=copy.deepcopy(questions))
        job = client.post(path + '/supplement', json={'question': '再解释并行配套'}).json()['data']
        assert app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'succeeded'
        detail = client.get(path).json()['data']
        assert detail['base'] == base and detail['results'][1:] == [old]
        assert detail['results'][0]['graph']['explanation']['questions'] == [
            '网络配套：网络如何支撑集群？', '并行配套：哪些配套可以并行建设？']

        questions[1]['unknown'] = '不能静默丢弃'
        failed = client.post(path + '/supplement', json={'question': '坏格式不得覆盖'}).json()['data']
        assert app.state.jobs.run_one()
        assert app.state.db.job(failed['id'])['status'] == 'failed'
        after = client.get(path).json()['data']
        assert after['base'] == base and after['results'] == detail['results']
        assert len(calls) == 3


def test_exact_master_matching_only_and_ai_role_stays_ai(tmp_path):
    state, calls = {}, []
    def companies(graph):
        graph['companies'] = [dict(id='exact', name='测试公司'), dict(id='similar', name='测试公司集团')]
        graph['participations'] = [dict(company_id='exact', node_id='aircraft', role='提供装备', sources=[]),
                                   dict(company_id='similar', node_id='operations', role='运营建议', sources=[])]
    state['mutate'] = companies
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler(state, calls))))
    configured(app)
    with app.state.db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)', ('SZ:000001', '000001', '测试公司', 'SZ', None, 'listed', None, '测试主表'))
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        app.state.jobs.run_one()
        iid = job['target_url'].split('industry_id=')[1]
        graph = client.get('/api/v1/industries/' + iid).json()['data']['base']
        assert graph['companies'][0]['symbol'] == 'SZ:000001'
        assert graph['companies'][1]['symbol'] is None
        roles = client.get('/api/v1/securities/SZ:000001/industries').json()['data']['items'][0]['roles']
        assert len(roles) == 1 and roles[0]['origin'] == 'ai'


@pytest.mark.parametrize('has_master', [False, True])
def test_known_public_alias_links_only_with_current_master_and_keeps_ai_role(tmp_path, has_master):
    calls = []
    def rename_model_id(graph):
        # The model may keep the trusted name but choose a different local ID.
        company = next(c for c in graph['companies'] if c['name'] == '浪潮信息（IEIT Systems）')
        old_id = company['id']
        company['id'] = 'model-server-vendor'
        for participation in graph['participations']:
            if participation['company_id'] == old_id:
                participation['company_id'] = company['id']
    app = create_app(tmp_path, start_worker=False,
                     network=Network(httpx.MockTransport(model_handler({'mutate': rename_model_id}, calls))))
    configured(app)
    if has_master:
        with app.state.db.transaction() as c:
            c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                      ('SZ:000977', '000977', '浪潮信息', 'SZ', None, 'listed', None, '测试主表'))
    with TestClient(app) as client:
        path = '/api/v1/industries/ai-compute'
        base = client.get(path).json()['data']['base']
        job = client.post(path + '/supplement', json={'question': '请展开算力公司角色'}).json()['data']
        assert app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'succeeded'
        detail = client.get(path).json()['data']
        assert detail['base'] == base
        result = detail['results'][0]
        assert result['origin'] == 'ai' and result['graph']['industry']['basis'] == 'ai_knowledge'
        companies = {c['name']: c for c in result['graph']['companies']}
        alias = companies['浪潮信息（IEIT Systems）']
        assert alias['id'] == 'model-server-vendor'
        assert alias['symbol'] == ('SZ:000977' if has_master else None)
        assert 'AI' in alias['identity_note']
        if has_master:
            assert '公共参考精确匹配' in alias['identity_note']
        assert companies['NVIDIA']['symbol'] is None
        items = client.get('/api/v1/securities/SZ:000977/industries').json()['data']['items']
        ai_roles = [r for item in items for r in item['roles'] if r['origin'] == 'ai']
        assert bool(ai_roles) == has_master
        with app.state.db.connect() as c:
            assert c.execute('SELECT count(*) FROM securities').fetchone()[0] == int(has_master)


@pytest.mark.parametrize('name,expected', [
    ('浪潮信息', 'SZ:000977'),
    ('浪潮信息（IEIT Systems）', 'SZ:000977'),
    ('浪潮信息（IEIT Systems）集团', None),
    ('浪潮信息(IEIT Systems)', None),
    ('浪潮信息（IEIT）', None),
    ('浪潮信息（其他主体）', None),
    ('IEIT Systems', None),
    ('浪潮', None),
    ('NVIDIA', None),
])
def test_company_matching_never_guesses_from_model_id_or_parentheses(app, name, expected):
    with app.state.db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                  ('SZ:000977', '000977', '浪潮信息', 'SZ', None, 'listed', None, '测试主表'))
    # Even an existing code and the public company's ID cannot identify a different name.
    graph = dict(companies=[dict(id='ieit', name=name, symbol='SZ:000977')])
    app.state.industries.match_companies(graph)
    assert graph['companies'][0]['symbol'] == expected


@pytest.mark.parametrize('other_symbol,expected', [
    ('SZ:000001', None), (None, None), ('SZ:000977', 'SZ:000977'),
])
def test_public_alias_requires_unique_reference_mapping(app, monkeypatch, other_symbol, expected):
    with app.state.db.transaction() as c:
        for symbol, code, name in [('SZ:000977', '000977', '浪潮信息'), ('SZ:000001', '000001', '其他公司')]:
            c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                      (symbol, code, name, 'SZ', None, 'listed', None, '测试主表'))
    refs = app.state.industries.references()
    refs['crude-oil']['companies'][0].update(name='浪潮信息（IEIT Systems）', symbol=other_symbol)
    monkeypatch.setattr(app.state.industries, 'references', lambda: copy.deepcopy(refs))
    graph = dict(companies=[dict(id='model-vendor', name='浪潮信息（IEIT Systems）')])
    app.state.industries.match_companies(graph)
    assert graph['companies'][0]['symbol'] == expected


@pytest.mark.parametrize('ambiguous', [False, True])
def test_master_exact_name_takes_precedence_without_resolving_ambiguity(app, ambiguous):
    alias = '浪潮信息（IEIT Systems）'
    with app.state.db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                  ('SZ:000001', '000001', alias, 'SZ', None, 'listed', None, '测试主表'))
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                  ('SZ:000977', '000977', alias if ambiguous else '浪潮信息',
                   'SZ', None, 'listed', None, '测试主表'))
    graph = dict(companies=[dict(id='model-vendor', name=alias)])
    app.state.industries.match_companies(graph)
    assert graph['companies'][0]['symbol'] == (None if ambiguous else 'SZ:000001')


def test_stored_ai_graph_is_not_a_trusted_company_alias_source(app, monkeypatch):
    with app.state.db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                  ('SZ:000977', '000977', '浪潮信息', 'SZ', None, 'listed', None, '测试主表'))
    historical = dict(companies=[dict(id='ieit', name='历史模型别名', symbol='SZ:000977')])
    monkeypatch.setattr(app.state.industries, 'stored', lambda iid: [dict(kind='industry_generate', graph=historical)])
    graph = copy.deepcopy(historical)
    app.state.industries.match_companies(graph)
    assert graph['companies'][0]['symbol'] is None


@pytest.mark.parametrize('change', [dict(model_name='changed'), dict(model_base_url='https://other.example/v1'),
                                    dict(ai_mode='ycore', ycore_url='https://core.example')])
def test_destination_changes_fail_queued_jobs_without_calling_old_model(tmp_path, change):
    calls = []
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler({}, calls))))
    configured(app)
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        app.state.settings.update(ConfigUpdate(**change))
        app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'failed' and not calls


@pytest.mark.parametrize('remote_name,expected', [
    ('浪潮信息', None), ('浪潮信息（IEIT Systems）', 'SZ:000977'),
])
def test_ycore_company_matching_retains_exact_master_name_only(app, monkeypatch, remote_name, expected):
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example'))
    alias = '浪潮信息（IEIT Systems）'
    calls = []
    def remote_call(method, path, *, params):
        calls.append((method, path, params))
        return dict(data=[dict(name=remote_name, symbol='SZ:000977')])
    monkeypatch.setattr(app.state.industries.remote, 'call', remote_call)
    monkeypatch.setattr(app.state.industries, 'references',
                        lambda: pytest.fail('ycore must not use the local reference alias fallback'))
    graph = dict(companies=[dict(id='ieit', name=alias, symbol='SZ:000977')])
    app.state.industries.match_companies(graph)
    assert graph['companies'][0]['symbol'] == expected
    assert calls == [('GET', '/securities', dict(q=alias, limit=100))]


def test_ycore_missing_capability_never_falls_back_and_public_reading_still_works(tmp_path):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.host == 'core.example'
        assert request.url.path == '/api/v1/ai/capabilities'
        return httpx.Response(404)
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    app.state.settings.update(ConfigUpdate(ai_mode='ycore', data_mode='ycore', ycore_url='https://core.example'))
    with TestClient(app) as client:
        assert len(client.get('/api/v1/industries').json()['data']['items']) == 3
        response = client.post('/api/v1/industries/generate', json={'name': '低空经济'})
        assert response.status_code == 501
        assert '未读取或写入本地替代数据' in response.json()['detail']
        assert calls == []
        assert client.get('/api/v1/jobs').json()['data'] == []
        assert client.get('/api/v1/industries/ai-compute').json()['data']['base']['origin'] == 'public_reference'


def test_ycore_snapshot_uses_own_prompt_and_keeps_remote_model_identity(tmp_path):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.host == 'core.example'
        assert request.headers['authorization'] == 'Bearer remote-test-key'
        assert b'local-test-key' not in request.content
        if request.url.path == '/api/v1/ai/capabilities':
            assert request.method == 'GET'
            return httpx.Response(200, json=envelope(ai_capabilities()))
        assert request.url.path == '/api/v1/ai/chat' and request.method == 'POST'
        body = json.loads(request.content)
        assert body['contract_version'] == '1' and body['purpose'] == 'industry_structure'
        assert body['request_id'] == request.headers['Idempotency-Key']
        assert body['max_output_tokens'] == 6000 and body['response_format'] == 'json'
        assert body['messages'][0]['role'] == 'system' and '一般知识' in body['messages'][0]['content']
        assert body['messages'][1]['role'] == 'user'
        snapshot = json.loads(body['messages'][1]['content'])
        assert snapshot['name'] == '低空经济' and snapshot['input_version'] == 'new' and snapshot['base'] is None
        return httpx.Response(200, json=envelope(dict(contract_version='1', request_id=body['request_id'],
            provider='synthetic-ycore', model='remote-industry-model', content=json.dumps(candidate(snapshot)),
            finish_reason='stop', usage=dict(input_tokens=120, output_tokens=60))))
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    app.state.settings.update(ConfigUpdate(ai_mode='ycore', ycore_url='https://core.example',
                                           ycore_api_key='remote-test-key', model_api_key='local-test-key'))
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'succeeded'
        iid = job['target_url'].split('industry_id=')[1]
        assert client.get('/api/v1/industries/' + iid).json()['data']['base']['model'] == 'remote-industry-model'
    assert [(r.method, r.url.path) for r in calls] == [
        ('GET', '/api/v1/ai/capabilities'), ('POST', '/api/v1/ai/chat')]


@pytest.mark.parametrize('body', [{'name': ''}, {'name': '  \n '}, {'name': 'a' * 101}])
def test_generation_name_validation(client, body):
    assert client.post('/api/v1/industries/generate', json=body).status_code == 422


def test_name_whitespace_search_and_existing_public_duplicate(app, client):
    configured(app)
    matches = client.get('/api/v1/industries', params={'q': '  ai 算力 '}).json()['data']['items']
    assert len(matches) == 1 and matches[0]['id'] == 'ai-compute'
    assert client.post('/api/v1/industries/generate', json={'name': 'AI 算力'}).status_code == 409
    assert client.post('/api/v1/industries/ai-compute/supplement', json={'question': '  '}).status_code == 422


def test_truncated_response_cannot_save_partial_draft(tmp_path):
    calls = []
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(model_handler({'finish': 'length'}, calls))))
    configured(app)
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'failed'
        iid = job['target_url'].split('industry_id=')[1]
        detail = client.get('/api/v1/industries/' + iid).json()['data']
        assert detail['base'] is None and detail['results'] == []


@pytest.mark.parametrize('status', ['queued', 'running'])
def test_running_industry_job_recovers_without_creating_duplicate_results(tmp_path, status):
    calls = []
    network = Network(httpx.MockTransport(model_handler({}, calls)))
    app = create_app(tmp_path, start_worker=False, network=network)
    configured(app)
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        with app.state.db.transaction() as c:
            c.execute('UPDATE jobs SET status=?,attempts=? WHERE id=?', (status, int(status == 'running'), job['id']))
    restarted = create_app(tmp_path, start_worker=False, network=network)
    restarted.state.jobs.recover()
    if status == 'running':
        # The interrupted call may have been billed. Recovery requires new consent.
        assert restarted.state.db.job(job['id'])['status'] == 'failed'
        assert '未自动重试' in restarted.state.db.job(job['id'])['message']
        assert not restarted.state.jobs.run_one() and calls == []
        with restarted.state.db.connect() as c:
            assert c.execute('SELECT count(*) FROM industry_results').fetchone()[0] == 0
        with TestClient(restarted) as client:
            replacement = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
            assert replacement['id'] != job['id']
            job = replacement
    assert restarted.state.db.job(job['id'])['status'] == 'queued'
    assert restarted.state.jobs.run_one()
    assert restarted.state.db.job(job['id'])['status'] == 'succeeded'
    assert not restarted.state.jobs.run_one()
    with restarted.state.db.connect() as c:
        assert c.execute('SELECT count(*) FROM industry_results').fetchone()[0] == 1
    assert len(calls) == 1


@pytest.mark.parametrize('field,value', [('contract_version', 'wrong-version'),
                                       ('request_id', '00000000-0000-0000-0000-000000000000'), ('model', '')])
def test_invalid_remote_identity_or_version_cannot_persist(tmp_path, field, value):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.host == 'core.example'
        if request.url.path == '/api/v1/ai/capabilities':
            assert request.method == 'GET'
            return httpx.Response(200, json=envelope(ai_capabilities()))
        assert request.url.path == '/api/v1/ai/chat' and request.method == 'POST'
        body = json.loads(request.content)
        assert body['contract_version'] == '1' and body['purpose'] == 'industry_structure'
        assert body['request_id'] == request.headers['Idempotency-Key']
        snapshot = json.loads(body['messages'][1]['content'])
        response = dict(contract_version='1', request_id=body['request_id'], provider='synthetic-ycore',
                        model='remote-industry-model', content=json.dumps(candidate(snapshot)),
                        finish_reason='stop', usage=dict(input_tokens=120, output_tokens=60))
        response[field] = value
        return httpx.Response(200, json=envelope(response))
    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    app.state.settings.update(ConfigUpdate(ai_mode='ycore', ycore_url='https://core.example'))
    with TestClient(app) as client:
        job = client.post('/api/v1/industries/generate', json={'name': '低空经济'}).json()['data']
        app.state.jobs.run_one()
        failed = app.state.db.job(job['id'])
        assert failed['status'] == 'failed' and 'AI 响应身份或完整性无效' in failed['message']
        assert len(calls) == 2
        with app.state.db.connect() as c:
            assert c.execute('SELECT count(*) FROM industry_results').fetchone()[0] == 0
