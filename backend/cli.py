from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(prog='ytrader')
    commands = parser.add_subparsers(dest='command', required=True)
    serve = commands.add_parser('serve', help='Single-process local API and optional built Web')
    serve.add_argument('--host', default='127.0.0.1')
    serve.add_argument('--port', type=int, default=8000)
    serve.add_argument('--data-dir')
    evaluate = commands.add_parser('evaluate', help='Offline decision evaluation; no claims about unrun models')
    evaluate.add_argument('--provider', choices=['rules', 'openai-compatible', 'jev'], default='rules')
    evaluate.add_argument('--samples', type=Path, default=Path(__file__).parent / 'fixtures/decision_samples.json')
    evaluate.add_argument('--split', choices=['all', 'train', 'validation', 'test'], default='test')
    evaluate.add_argument('--allow-network', action='store_true')
    args = parser.parse_args()
    if args.command == 'serve':
        import uvicorn
        if args.data_dir:
            os.environ['YTRADER_DATA_DIR'] = args.data_dir
        uvicorn.run('backend.app:create_app', factory=True, host=args.host, port=args.port, workers=1)
    else:
        from .decisions import RulesProvider, OpenAIDecisionProvider, evaluate as run_eval, CAPABILITIES
        if args.provider == 'jev':
            print(json.dumps({'provider': 'jev', 'verified': False, 'status': 'unavailable', 'capability': CAPABILITIES['jev']}, ensure_ascii=False))
            return
        if args.provider == 'openai-compatible':
            if not args.allow_network:
                parser.error('model evaluation requires explicit --allow-network; rules is fully offline')
            from .app import create_app
            application = create_app(start_worker=False)
            provider = OpenAIDecisionProvider(application.state.settings, application.state.network)
        else:
            provider = RulesProvider()
        samples = json.loads(args.samples.read_text(encoding='utf-8'))
        if args.split != 'all':
            samples = [s for s in samples if s['split'] == args.split]
        print(json.dumps(run_eval(provider, samples), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
