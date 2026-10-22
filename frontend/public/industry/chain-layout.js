// Shared entry point. Keep the reviewed AI preset and its mature interaction
// implementation; supply chain-specific presentation rather than copying it.
import { createAiLayout, renderAiCompanies, aiCompanyLabel, aiReadingGroups, reviewedAiPresentation } from './ai-layout.js?v=five-chain-20261021';
import { usesChainLayout, structureLayout, structureReadingGroups } from './chain-layout-config.js?v=all-curated-20261021';
export { usesChainLayout };

export function chainCompanyLabel(company, graph) {
  // Only the previously reviewed AI aliases are retained. Never derive an
  // abbreviation or ticker for another chain; full original names remain titles.
  return graph?.industry?.id === 'ai-compute' ? aiCompanyLabel(company) : company.name;
}
export function createChainLayout(options) {
  const { graph } = options;
  if (!usesChainLayout(graph)) throw new Error('此图暂无可用的 curated 节点布局。');
  return createAiLayout({ ...options,
    presentation: graph.industry.id === 'ai-compute' ? reviewedAiPresentation(graph) : structureLayout(graph),
    companyLabel: company => chainCompanyLabel(company, graph)
  });
}
export function renderChainCompanies(options) {
  const { graph } = options;
  return renderAiCompanies({ ...options,
    readingGroups: graph.industry.id === 'ai-compute' ? aiReadingGroups(graph) : structureReadingGroups(graph),
    companyLabel: company => chainCompanyLabel(company, graph)
  });
}
