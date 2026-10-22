from copy import deepcopy

import pytest

from backend.official import ExchangeData, SSE


@pytest.fixture
def sse_pages():
    # Real SSE probe row: CSRC_CODE is a code, CSRC_CODE_DESC is the industry.
    bank = {
        'COMPANY_ABBR_EN': 'SPD BANK',
        'STOCK_TYPE': '1',
        'LIST_BOARD': '1',
        'COMPANY_ABBR': '浦发银行',
        'A_STOCK_CODE': '600000',
        'AREA_NAME': '310000',
        'DELIST_DATE': '-',
        'NUM': '1',
        'SEC_NAME_CN': '浦发银行',
        'AREA_NAME_DESC': '上海市',
        'FULL_NAME_IN_ENGLISH': 'Shanghai Pudong Development Bank Co.,Ltd.',
        'SEC_NAME_FULL': '浦发银行',
        'STATE_CODE': '2',
        'B_STOCK_CODE': '-',
        'STATE_CODE_STOCK': '4',
        'LIST_DATE': '19991110',
        'CSRC_CODE': 'J',
        'PRODUCT_STATUS': '   D  F  N          ',
        'CSRC_CODE_DESC': '金融业',
        'COMPANY_CODE': '600000',
        'FULL_NAME': '上海浦东发展银行股份有限公司',
    }
    airport = {
        'STOCK_TYPE': '1', 'LIST_BOARD': '1', 'COMPANY_ABBR': '白云机场',
        'A_STOCK_CODE': '600004', 'SEC_NAME_CN': '白云机场', 'LIST_DATE': '20030428',
        'CSRC_CODE': 'G', 'CSRC_CODE_DESC': '交通运输、仓储和邮政业',
    }
    # Synthetic STAR row exercises the second stock type and code/name aliases.
    star = {
        'STOCK_TYPE': '8', 'SEC_CODE': '688001', 'SEC_NAME_CN': '华兴源创',
        'CSRC_CODE': 'C', 'CSRC_CODE_DESC': '制造业',
    }

    def payload(row, total, page):
        # Match the probe's duplicated result/pageHelp.data envelope, but split
        # the small fixture across pages to detect premature pagination stops.
        data = [row]
        return {
            'isPagination': 'true', 'jsonCallBack': 'jsonpCallback',
            'sqlId': 'COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L', 'type': 'inParams',
            'pageHelp': {'data': data, 'total': total, 'pageNo': page,
                         'pageSize': 1, 'pageCount': total},
            'result': data,
            'queryDate': '',
        }

    return {
        ('1', 1): payload(bank, 2, 1),
        ('1', 2): payload(airport, 2, 2),
        ('8', 1): payload(star, 1, 1),
    }


class SSENetwork:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def json(self, method, url, *, public, headers, params):
        assert (method, url, public) == ('GET', SSE, True)
        assert headers['Referer'] == 'https://www.sse.com.cn/assortment/stock/list/share/'
        assert params['sqlId'] == 'COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L'
        assert params['COMPANY_STATUS'] == '2,4,5,7,8'
        assert params['pageHelp.pageSize'] == 10000
        assert params['CSRC_CODE'] == ''
        key = (params['STOCK_TYPE'], params['pageHelp.pageNo'])
        self.calls.append(key)
        return deepcopy(self.pages[key])


@pytest.mark.parametrize('nested_only', [False, True], ids=['result', 'pageHelp-data'])
def test_sh_preserves_reported_industry_and_paginates(sse_pages, nested_only):
    if nested_only:
        for payload in sse_pages.values():
            payload.pop('result')
    network = SSENetwork(sse_pages)
    official = ExchangeData(network)

    rows = official.sh()

    assert network.calls == [('1', 1), ('1', 2), ('8', 1)]
    assert official.reported['SH'] == 3
    assert [(row['symbol'], row['code'], row['name'], row['industry']) for row in rows] == [
        ('SH:600000', '600000', '浦发银行', '金融业'),
        ('SH:600004', '600004', '白云机场', '交通运输、仓储和邮政业'),
        ('SH:688001', '688001', '华兴源创', '制造业'),
    ]
    for row in rows:
        assert row['exchange'] == 'SH'
        assert row['as_of'] is None  # LIST_DATE is not a source publication date.
        assert row['source'] == '上海证券交易所公开 A 股列表（源发布时间未知）'
        assert row['_source_url'] == 'https://www.sse.com.cn/assortment/stock/list/share/'


@pytest.mark.parametrize('industry_fields', [
    {}, {'CSRC_CODE_DESC': None}, {'CSRC_CODE_DESC': ''},
    {'CSRC_CODE_DESC': '   '}, {'CSRC_CODE_DESC': '-'}, {'CSRC_CODE_DESC': ' - '},
], ids=['missing', 'null', 'empty', 'whitespace', 'dash', 'padded-dash'])
def test_sh_unknown_industry_is_not_inferred(sse_pages, industry_fields):
    bank = sse_pages[('1', 1)]['result'][0]
    bank.pop('CSRC_CODE_DESC')
    bank.update(industry_fields)
    # Both the explicit code J and the bank name remain available, but neither
    # may be used to infer an absent industry description.
    assert bank['CSRC_CODE'] == 'J'
    assert bank['COMPANY_ABBR'] == '浦发银行'

    rows = ExchangeData(SSENetwork(sse_pages)).sh()

    assert rows[0]['industry'] is None
    assert rows[0]['as_of'] is None
    assert rows[1]['industry'] == '交通运输、仓储和邮政业'
