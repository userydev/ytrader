"""Independent algorithm releases; the legacy editorial projection version is retained."""
VERSIONS = {
    'recommendation': '1.2.0',
    'event_grouping': '1.1.0',
    'industry_transmission': '1.2.1',
    'industry_association': '1.1.0',
    'industry_impact': '1.0.0',
    'security_matching': '1.0.0',
}


def algorithm_versions():
    return dict(VERSIONS)


def registry():
    return {'schema_version': '1', 'algorithms': [
        {'id': key, 'version': version, 'documentation': 'docs/PRODUCT.md#algorithm-' + key}
        for key, version in VERSIONS.items()
    ]}
