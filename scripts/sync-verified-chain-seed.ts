import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Reproducible script to refresh EastMoney F10 BusinessAnalysis (zygcfx)
 * mainbz breakdown items in server/content/verified-chain-seed.json
 * without rounding raw MBI_RATIO or GROSS_RPOFIT_RATIO values.
 */

const MOUNTED_COMPANIES = [
  '002466.SZ',
  '300750.SZ',
  '300274.SZ',
  '002594.SZ',
  '300308.SZ',
  '300394.SZ',
  '300502.SZ',
  '002371.SZ',
  '688012.SH',
  '688981.SH',
];

async function main() {
  const seedPath = path.resolve(process.cwd(), 'server/content/verified-chain-seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const observedAt = new Date().toISOString();
  const mainbzByCompany: Record<string, unknown> = {};

  for (const code of MOUNTED_COMPANIES) {
    const [sym, suf] = code.split('.');
    const emCode = `${suf}${sym}`;
    const url = `https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=${emCode}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const json: any = await res.json();
    const rawZygcfx: any[] = Array.isArray(json?.zygcfx) ? json.zygcfx : [];
    const dates = Array.from(
      new Set(rawZygcfx.map(r => String(r?.REPORT_DATE || '').slice(0, 10)).filter(Boolean))
    )
      .sort()
      .reverse();
    const latestDate = dates[0];
    if (!latestDate) {
      throw new Error(`No zygcfx report dates found for ${code}`);
    }
    const latestRows = rawZygcfx.filter(r => String(r?.REPORT_DATE || '').startsWith(latestDate));
    const items = latestRows
      .filter(r => r?.ITEM_NAME && !['合计', '其中:关联交易'].includes(String(r.ITEM_NAME).trim()))
      .map(r => {
        const mType = String(r.MAINOP_TYPE || '');
        const mainopType = mType === '2' ? 'product' : mType === '1' ? 'industry' : 'region';
        const itemName = String(r.ITEM_NAME).trim();
        const revYuan =
          r.MAIN_BUSINESS_INCOME !== null && r.MAIN_BUSINESS_INCOME !== undefined
            ? Number(r.MAIN_BUSINESS_INCOME)
            : null;
        const share =
          r.MBI_RATIO !== null && r.MBI_RATIO !== undefined ? Number(r.MBI_RATIO) : null;
        const gm =
          r.GROSS_RPOFIT_RATIO !== null && r.GROSS_RPOFIT_RATIO !== undefined
            ? Number(r.GROSS_RPOFIT_RATIO)
            : null;
        return {
          item_name: itemName,
          mainop_type: mainopType,
          revenue_yuan: Number.isFinite(revYuan) ? revYuan : null,
          revenue_share: Number.isFinite(share) ? share : null,
          gross_margin: Number.isFinite(gm) ? gm : null,
          report_date: latestDate,
          source_item_id: createHash('sha256')
            .update(`${code}:${latestDate}:${mainopType}:${itemName}`)
            .digest('hex'),
        };
      });

    mainbzByCompany[code] = {
      report_period: latestDate,
      source_url: url,
      observed_at: observedAt,
      items,
    };
  }

  seed.eastmoney_mainbz = mainbzByCompany;
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  console.log(`Updated ${seedPath} with unrounded mainbz for ${MOUNTED_COMPANIES.length} companies.`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
