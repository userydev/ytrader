#!/usr/bin/env python3
"""Read-only, exact-match queries over existing ChainKnowledgeGraph JSONL files."""
import argparse
import json
from pathlib import Path
import sys


class DatasetError(Exception):
    pass


def reject_constant(value):
    raise ValueError("non-standard JSON constant: " + value)


def rows(directory, filename, required):
    """Stream one fixed file; line numbers include blank lines."""
    path = directory / filename
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, text in enumerate(handle, 1):
                if not text.strip():
                    continue
                try:
                    row = json.loads(text, parse_constant=reject_constant)
                except ValueError as exc:
                    raise DatasetError(f"{filename}:{line_number}: invalid JSON: {exc}") from exc
                if not isinstance(row, dict):
                    raise DatasetError(f"{filename}:{line_number}: expected a JSON object")
                for field in required:
                    if not isinstance(row.get(field), str) or not row[field]:
                        raise DatasetError(
                            f"{filename}:{line_number}: {field} must be a nonempty string"
                        )
                yield row, {"file": filename, "line": line_number,
                            "raw_relation": row.get("rel")}
    except (OSError, UnicodeError) as exc:
        raise DatasetError(f"cannot read {path}: {exc}") from exc


def query(directory, product, company_code, snapshot):
    edges = {}
    for row, source in rows(directory, "product_product.json",
                            ("from_entity", "rel", "to_entity")):
        if row["rel"] == "下游产品":
            upstream, downstream = row["from_entity"], row["to_entity"]
        elif row["rel"] == "上游材料":
            upstream, downstream = row["to_entity"], row["from_entity"]
        else:
            continue  # Do not interpret category or unknown relations as supply-chain edges.
        if product not in (upstream, downstream):
            continue
        edge = edges.setdefault((upstream, downstream), {
            "upstream_product": upstream, "downstream_product": downstream,
            "provenance": [],
        })
        edge["provenance"].append(source)

    associations = {}
    for row, source in rows(directory, "company_product.json",
                            ("company_code", "product_name", "rel")):
        if row["product_name"] != product:
            continue
        code = row["company_code"]
        if company_code is not None and code != company_code:
            continue
        associations.setdefault(code, []).append((row, source))

    companies = []
    matched_codes = set()

    def add_company(code, metadata=None, metadata_source=None):
        for association, source in associations[code]:
            provenance = [source]
            if metadata_source is not None:
                provenance.append(metadata_source)
            companies.append({
                "code": code,
                "name": metadata["name"] if metadata is not None else None,
                "full_name": metadata["fullname"] if metadata is not None else None,
                "product": association["product_name"],
                "raw_weight": association.get("rel_weight"),
                "weight_period": None,
                "provenance": provenance,
            })

    for row, source in rows(directory, "company.json", ("code", "name", "fullname")):
        code = row["code"]
        if code in associations:
            matched_codes.add(code)
            add_company(code, row, source)
    unmatched_codes = sorted(set(associations) - matched_codes)
    for code in unmatched_codes:
        add_company(code)  # Preserve the association, but never guess a name from it.

    normalized = list(edges.values())
    gaps = [
        "无逐条外部出处：provenance仅为本地文件行号，不是外部核验。",
        "无关系日期：company.time不作为关系日期。",
        "无当前权重或权重期间：raw_weight不代表当前营收占比。",
    ]
    if unmatched_codes:
        gaps.append("部分公司代码未在company.json中匹配，名称保留为null。")
    return {
        "query": {"product": product, "company_code": company_code},
        "source_dataset": str(directory),
        "source_snapshot": snapshot,
        "target_product": product,
        "upstream": [edge for edge in normalized if edge["downstream_product"] == product],
        "downstream": [edge for edge in normalized if edge["upstream_product"] == product],
        "companies": companies,
        "unmatched_company_codes": unmatched_codes,
        "status": "candidate" if edges or associations else "not_found",
        "gaps": gaps,
    }


def nonempty(value):
    if not value:
        raise argparse.ArgumentTypeError("must not be empty")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, type=Path,
                        help="directory containing the three existing JSONL .json files")
    parser.add_argument("--product", required=True, type=nonempty,
                        help="exact product name (no normalization or fuzzy matching)")
    parser.add_argument("--company-code", type=nonempty,
                        help="optional exact code filter for companies only")
    parser.add_argument("--snapshot", type=nonempty,
                        help="caller-supplied snapshot/commit label; not verified")
    args = parser.parse_args()
    try:
        result = query(args.dataset, args.product, args.company_code, args.snapshot)
        # Serialize before writing so errors never leave partial JSON on stdout.
        output = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    except (DatasetError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
