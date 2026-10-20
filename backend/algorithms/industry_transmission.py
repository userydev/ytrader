"""Locally co-occurring evidence gates; conditional mechanisms, never price forecasts."""
import re
from .common import hits, matches, snippet
from .registry import VERSIONS

VERSION = VERSIONS['industry_transmission']


def industry_links(article, feature, rules):
    value = article['title'] + '\n' + article['content']
    links = []

    def add(iid, name, variable, mechanism, condition, nodes, relation, groups, contexts=None):
        if contexts is None:
            contexts = [value[start:start + 480] for start in range(0, max(1, len(value)), 240)]
        context = next((part for part in contexts if all(hits(part, group) for group in groups)), None)
        if context is None:
            return
        triggers = [hits(context, group)[0] for group in groups]
        links.append(dict(industry_id=iid, name=name, industry_name=name, variable=variable,
                          mechanism=mechanism, condition=condition, node_ids=nodes, relation=relation,
                          evidence=[dict(article_id=article['id'], trigger=term, quote=snippet(context, term)) for term in triggers],
                          basis='rule_inference', rule_version=rules['version']))

    oil = ['oil', 'crude', 'petroleum', 'OPEC', '原油', '石油', '欧佩克']
    shipping = ['Hormuz', 'Red Sea', 'tanker', 'tankers', 'shipping', '霍尔木兹', '红海', '油轮', '航运']
    disruption = ['blockade', 'closure', 'closes', 'disruption', 'reroute', 'attack', 'attacks', '封锁', '关闭', '中断', '绕行', '袭击']
    # Inventory policy is not production. In particular, deciding who chooses a
    # release date does not establish that any barrels have reached the market.
    oil_clauses = [article['title']] + re.split(r'[\n。;；!?！？]|(?<=[a-z])\.\s+', article['content'])
    reserve_terms = ['strategic reserve', 'strategic reserves', 'emergency reserve', 'emergency reserves', 'oil reserves', 'petroleum reserve', 'stockpile', 'stockpiles', '石油储备', '原油储备', '战略储备', '应急储备', '紧急储备']
    release_terms = ['release', 'releases', 'releasing', 'released', 'drawdown', '释放', '投放', '动用']
    reserve_products = oil + ['diesel', '柴油', '成品油']
    reserve_contexts = [clause for clause in oil_clauses if hits(clause, reserve_terms) and hits(clause, release_terms) and hits(clause, reserve_products)]
    if reserve_contexts:
        # Diesel is a finished fuel, not refinery crude feedstock. A mixed
        # announcement can mention both, so preserve the distinction in text.
        crude_release = any(hits(clause, oil) for clause in reserve_contexts)
        diesel_release = any(hits(clause, ['diesel', '柴油', '成品油']) for clause in reserve_contexts)
        reserve_nodes = ['logistics'] + (['crude', 'refining'] if crude_release else []) + (['fuels'] if diesel_release else [])
        add('crude-oil', '原油', '储备释放安排与库存投放节奏',
            '储备释放安排可能改变可动用库存与市场投放节奏；仅在实际投放后才可能改变原油及炼厂原料可得性。柴油投放对应燃料产品，不是新增开采产能。',
            '须确认实际投放品种、数量、时间及到达市场；成员国自行决定时机不等于已释放。',
            reserve_nodes, 'conditional', [reserve_terms, release_terms, reserve_products], contexts=reserve_contexts)
        links[-1]['mechanism_summary'] = '释放安排 → 可动用库存/投放节奏；实际投放后才可能改变原料或燃料可得性。'
        links[-1]['condition_summary'] = '以实际投放的品种、数量及时间为条件；安排不等于已释放，库存不等于产能。'
    production_terms = ['production cut', 'production cuts', 'output cut', 'output cuts', 'production increase', 'increase production', 'raise output', 'cuts output', 'cut output', 'raises output', 'production capacity', '减产', '增产', '提高产量', '削减产量', '产能扩张', '产能投产', '停产']
    production_contexts = [clause for clause in oil_clauses if not hits(clause, reserve_terms)]
    # Capture normal verb/object order, retaining the exact phrase as evidence.
    # The add() gate still requires an oil/OPEC subject in this same clause;
    # neither a generic supply change nor an inventory-release clause qualifies.
    production_action = re.compile(
        r'\b(?:cuts?|cutting|reduc(?:e[sd]?|ing)|lower(?:s|ed|ing)?|'
        r'rais(?:e[sd]?|ing)|increas(?:e[sd]?|ing)|boost(?:s|ed|ing)?)\s+'
        r'(?:(?:its|their)\s+)?(?:(?:crude(?:\s+oil)?|oil|petroleum)\s+)?'
        r'(?:production|output)\b', re.I)
    production_terms.extend(match.group(0) for clause in production_contexts
                            for match in production_action.finditer(clause))
    add('crude-oil', '原油', '实物生产与炼厂原料可得性', '生产调整可能改变原油可得性与炼厂投入；供给方与使用方角色不同。',
        '需核实实际生产调整规模、执行时间、库存与替代供给；不从标题判断油价方向。', ['extraction', 'crude', 'refining'], 'conditional', [oil, production_terms], contexts=production_contexts)
    add('crude-oil', '原油', '运输可用性与运费', '航道或船运扰动可能改变原油运输时间、保险与到岸成本。',
        '需确认原油船运实际受阻及持续时间；地缘冲突本身不等于断供。', ['logistics', 'crude', 'transport'], 'conditional', [shipping, disruption])
    important_routes = ['Hormuz', 'Strait of Hormuz', 'Red Sea', 'Suez Canal', 'Bab el-Mandeb', '霍尔木兹', '红海', '苏伊士运河', '曼德海峡']
    add('gold', '黄金', '地缘经济风险与投资配置需求',
        '关键航道的明确袭击/封锁可能提高运输与供给不确定性，经风险偏好影响黄金投资配置；这是条件推断，非原文对黄金的结论。',
        '仅在扰动实际影响航运/供给、并引起避险配置变化时成立；需同时核对美元、实际利率、资金流及冲击持续性，不推断金价上涨。',
        ['bullion', 'investment'], 'conditional', [important_routes, disruption])
    for link in links:
        if link['industry_id'] == 'gold' and link['variable'] == '地缘经济风险与投资配置需求':
            link['mechanism_summary'] = '航道扰动增加不确定性，可能改变黄金配置需求。'
            link['condition_summary'] = '须出现实际航运影响及避险资金流；美元、实际利率可能抵消。'
    bank_terms = [term for key in ('fed', 'ecb', 'boj', 'pboc') for term in rules['entities'][key]] + ['central bank', '央行']
    rate_terms = ['interest rate', 'interest rates', 'rates', 'policy rate', '降息', '加息', '利率']
    decision_terms = ['cuts', 'cut', 'raises', 'raised', 'holds', 'held', 'keeps', 'kept', 'maintains', 'maintained', '降息', '加息', '下调', '上调', '维持']
    decision = re.search(
        r'(?<![A-Za-z])(?:Fed|Federal Reserve|ECB|European Central Bank|Bank of Japan|People\'s Bank of China|central bank)'
        r'\s+(?:has\s+)?(?:cuts?|raises?|raised|holds?|held|keeps?|kept|maintains?|maintained)\b[^.\n]{0,70}?\brates?\b'
        r'|(?:美联储|欧洲央行|日本央行|中国央行|中国人民银行|央行)[^。\n]{0,25}?(?:宣布降息|宣布加息|降息|加息|(?:下调|上调|维持)[^。\n]{0,15}?利率)', value, re.I)
    if decision and not hits(decision[0], ['may', 'might', 'could', 'expected', '预计', '可能', '计划', '或将', '建议', '呼吁']):
        add('gold', '黄金', '央行利率决策与持有机会成本',
            '明确利率决策可经实际利率预期和美元影响持有非生息黄金的机会成本；这是跨产业条件推断，不是原文已经报告黄金反应。',
            '需核对通胀预期、实际收益率和美元是否同向变化；名义降息不等于实际利率下降，也不保证黄金上涨。',
            ['bullion', 'investment'], 'conditional', [bank_terms, rate_terms, decision_terms])
        if links and links[-1]['industry_id'] == 'gold' and links[-1]['variable'] == '央行利率决策与持有机会成本':
            links[-1]['evidence'].append(dict(article_id=article['id'], trigger='explicit_rate_decision', quote=decision[0]))
    for link in links:
        if link['industry_id'] == 'gold':
            link['mechanism_reference'] = dict(name='World Gold Council · Gold Outlook 2026 · risk and opportunity cost framework',
                url='https://www.gold.org/goldhub/research/gold-outlook-2026', role='mechanism_reference_not_news_evidence')
    gold = ['gold', 'bullion', '黄金', '金条']
    add('gold', '黄金', '避险配置需求', '报道明确涉及黄金与风险偏好，可能经投资配置需求传至金条及投资环节。',
        '需验证实际资金流、美元与实际利率是否抵消；不推断必然上涨。', ['bullion', 'investment'], 'conditional',
        [gold, ['safe haven', 'safe-haven', 'risk aversion', '避险', '避险需求']])
    add('gold', '黄金', '实际利率与美元机会成本', '利率/美元变化影响非生息黄金的持有机会成本。',
        '需同时观察通胀预期与美元，不把名义降息等同实际利率下降。', ['bullion', 'investment'], 'conditional',
        [gold, ['interest rate', 'interest rates', 'real yields', 'dollar', '利率', '美元', '实际收益率']])
    add('gold', '黄金', '矿产供给与终端需求', '报道的矿山或实物需求变化对应黄金供需环节，而非统一的资产价格结论。',
        '核实产量/采购量、库存和回收替代，区别珠宝与投资用途。', ['mining', 'refining', 'jewellery', 'recycling'], 'direct',
        [gold, ['mine output', 'production', 'jewellery demand', 'jewelry demand', '矿山', '产量', '珠宝需求']])
    add('gold', '黄金', '实物黄金跨境流量与流通库存', '黄金进出口量变化对应精炼、金条和流通环节的实物流量，不能直接等同矿产供给或新增终端需求。',
        '需核对数量与金额口径、目的地、转口及库存变化；贸易量上升不代表金价或矿山产量上升。', ['refining', 'bullion'], 'direct',
        [gold, ['exports', 'imports', 'export volume', 'import volume', '出口', '进口', '贸易量']])
    ai = ['AI', 'GPU', 'artificial intelligence', 'data center', 'data centre', 'data-center', 'data-centre', '人工智能', '算力', '数据中心']
    compute_subjects = ['AI server', 'AI servers', 'AI chip', 'AI chips', 'AI CPU', 'GPU', 'AI infrastructure',
        'artificial intelligence infrastructure', 'AI computing', 'AI基础设施', 'data center', 'data centers', 'data centre', 'data centres', 'data-center',
        'AI服务器', 'AI芯片', '算力', '数据中心', '人工智能基础设施']
    investment = rules['actions']['capex'] + rules['actions']['orders']
    clauses = [article['title']] + re.split(r'[\n。;；!?！？]|(?<=[a-z])\.\s+', article['content'])
    ai_contexts = []
    if (hits(article['title'], ai) and hits(article['title'], ['CPU', 'GPU', 'server', 'servers', 'processor', 'processors', '服务器', '处理器']) and hits(article['title'], investment)):
        ai_contexts.append(article['title'])
    for clause in clauses:
        for subject in hits(clause, compute_subjects):
            match = matches(clause, subject)
            local = clause[max(0, match.start() - 90):match.end() + 90]
            if hits(local, investment) and not hits(local, ['applications include', 'applications including', 'including AI', '应用包括', '应用领域', '可用于']):
                ai_contexts.append(local)
    add('ai-compute', 'AI算力', '资本开支与服务器部署需求', '算力投资计划关联计算部件、服务器与集群部署；计划金额不等于已确认订单。',
        '需有预算落地、采购时间及设备交付证据；不同环节受益取决于订单与供给约束。', ['server', 'cluster'], 'conditional', [ai, investment], contexts=ai_contexts)
    add('ai-compute', 'AI算力', '计算部件可得性与贸易准入', '芯片出口限制可改变计算部件采购与集群部署条件。',
        '需核实受限型号、目的地、生效日期、许可与替代方案。', ['accelerator', 'server', 'cluster'], 'direct',
        [['chip', 'chips', 'GPU', '芯片', '加速器'], ['export controls', 'export restrictions', 'export ban', '出口管制', '出口限制', '禁运']])
    add('ai-compute', 'AI算力', '电力与散热部署约束', '机房电力/冷却能力为集群投运提供约束条件，不代表所有设备同时增加订单。',
        '需核实并网、用电协议与散热建设时间是否匹配投运。', ['power', 'cooling', 'cluster'], 'conditional',
        [ai, ['power supply', 'electricity', 'power grid', 'cooling', '供电', '用电', '电网', '散热']])
    add('grid', '电网', '数据中心新增负荷与接入能力', '数据中心负荷可能转化为电网接入及扩容需求。',
        '须核实负荷规模、接入位置、并网计划和投资责任；无通用节点映射。', [], 'conditional',
        [['data center', 'data centre', '数据中心'], ['power grid', 'grid connection', '电网', '并网']])
    add('innovative-drugs', '创新药', '产品准入与临床转化', '审批或临床结果可能改变特定药物的可销售范围和研发路径。',
        '需核对药品、适应症、试验终点及审批范围；未推断销量或估值。', [], 'conditional',
        [['drug', 'medicine', '药物', '新药'], ['FDA', 'clinical trial', 'approval', '临床试验', '获批']])
    return links
