import test from 'node:test';
import assert from 'node:assert/strict';
import { inputFingerprint, modelRequest, sameEvent, validateDraft, PROMPT_VERSION } from '../server/content/editorial-schema.js';
import { buildInput, eligibleNews } from '../server/content/editorial-input.js';
import { parseBundle } from '../server/content/schema.js';
import { budgetGate, type Item } from '../server/ycore.js';
import type { EditorialDraft, EditorialInput } from '../src/content/editorial-types.js';
import type { ContentBundle, News } from '../src/content/types.js';
import { dateLabel, eventPeriod } from '../src/content/editorial-dates.js';
const quote='供应商报道：甲公司于2026年10月16日拟注销回购股份123456股，仍需股东大会审议，尚未完成注销手续。';
const business='甲公司主营光通信模块的研发、生产与销售，客户采购受项目验收与库存周期影响。';
const input:EditorialInput={prompt_version:PROMPT_VERSION,news_keys:['news-1@1'],sources:[
  {key:'news-1@1',item_id:'news-1',item_version:1,title:'供应商片段',provider:'私有供应商',url:null,published_at:null,discovered_at:'2026-10-16T08:00:00Z',text:quote,roles:['news'],company_codes:[],primary:false},
  {key:'profile-1@1',item_id:'profile-1',item_version:1,title:'公司资料',provider:'私有供应商',url:null,published_at:null,discovered_at:'2026-10-16T08:00:00Z',text:business,roles:['business'],company_codes:['000001.SZ'],primary:false},
],companies:[{code:'000001.SZ',name:'甲公司',source_keys:['profile-1@1']}],relationships:[]};
const statement={text:'供应商报道拟注销，尚未完成。',citations:[{source:'news-1@1',quote}]};
const draft:EditorialDraft={eligible:true,exclusion_reason:null,headline:'甲公司拟注销回购股份，完成仍待审议',change:statement,why:{...statement,text:'这是股本结构的潜在变化，不是光模块订单增长的证明。'},facts:[statement],transmission:[{stage:'股本结构',mechanism:statement}],companies:[{code:'000001.SZ',name:'甲公司',business:{text:'公司销售光通信模块。',citations:[{source:'profile-1@1',quote:business}]},impact:'仅若完成注销，才会改变股份总数；不推断主营需求。',counterforce:'审议尚未完成。',unknown_exposure:'注销后的实际股份数尚需公告。'}],next_signals:[{signal:'核对股东大会审议及注销完成公告',interpretation:'未通过则不能沿完成注销推断。',citations:statement.citations}],countercase:'若股东大会否决，股份注销机制不成立。',missing_evidence:['缺少原始董事会公告全文。'],priority:'watch',priority_reason:'回购用途的具体改变，值得跟进完成条件。',group:{subject:'甲公司',action:'拟注销回购股份',discriminator:'拟注销回购股份123456股',occurred_on:'2026-10-16'},revision_summary:'首次纳入拟注销具体股数及待审议条件。'};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
test('replayed observations/order do not change paid identity; source versions do',()=>{
  const replay=clone(input);replay.sources.reverse();replay.sources.forEach(s=>{s.discovered_at='2026-10-17T01:00:00Z';});
  assert.equal(inputFingerprint(input),inputFingerprint(replay));
  replay.sources[0].item_version=2;replay.sources[0].key='profile-1@2';
  assert.notEqual(inputFingerprint(input),inputFingerprint(replay));
  const context=clone(input);context.companies[0].name='乙公司';
  assert.notEqual(inputFingerprint(input),inputFingerprint(context));
});
test('exact canonical quote/ref and company business association are required',()=>{
  assert.equal(validateDraft(draft,input).companies[0].name,'甲公司');
  const changed=clone(draft);changed.change.citations[0].quote=quote.replace('拟注销','已完成注销');
  assert.throws(()=>validateDraft(changed,input),/QUOTE_OR_REF_INVALID/);
  const wrong=clone(draft);wrong.change.citations[0].source='news-1@2';
  assert.throws(()=>validateDraft(wrong,input),/QUOTE_OR_REF_INVALID/);
  const company=clone(draft);company.companies[0].business=statement;
  assert.throws(()=>validateDraft(company,input),/BUSINESS_REF_INVALID/);
  const date=clone(draft);date.group.occurred_on='2026-10-17';
  assert.throws(()=>validateDraft(date,input),/OCCURRENCE_DATE_NOT_QUOTED/);
  const claims=clone(draft);claims.missing_evidence=[];
  assert.throws(()=>validateDraft(claims,input),/PRIMARY_EVIDENCE_GAP_REQUIRED/);
});
test('same action can group across repeated coverage; industry demand remains separate',()=>{
  assert.equal(sameEvent(draft,clone(draft),['news-1@1'],['news-2@1']),true);
  assert.equal(sameEvent(draft,clone(draft),['news-1@1'],['news-1@2']),true);
  const unrelated=clone(draft);unrelated.group.action='光模块需求增长';
  assert.equal(sameEvent(draft,unrelated,['news-1@1'],['news-2@1']),false);
  assert.equal(sameEvent(draft,unrelated,['news-1@1'],['news-1@2']),false);
  const anotherDay=clone(draft);anotherDay.group.occurred_on='2026-10-15';
  assert.equal(sameEvent(draft,anotherDay,['news-1@1'],['news-2@1']),false);
  const undated=clone(draft);undated.group.occurred_on=null;
  const noSpecificObject=clone(undated);noSpecificObject.group.discriminator='公司业务';
  assert.equal(sameEvent(noSpecificObject,clone(noSpecificObject),['a@1'],['b@1']),false);
});
test('URL-less undated snippets are eligible; publication does not become discovery time',async()=>{
  const evidence={provider:'私有供应商',title:'董事会公告片段',url:null,observed_at:'2026-10-16T08:00:00Z',as_of:null,verification:'provider' as const,quote,source_item_id:'news-1',source_item_version:1};
  const news:News={id:'notice-1',title:'甲公司董事会决议',summary:quote,url:null,source:'私有供应商',published_at:null,observed_at:evidence.observed_at,verification:'provider',node_ids:[],company_codes:[],evidence:[evidence]};
  const bundle:ContentBundle={schema_version:1,observed_at:evidence.observed_at,source_run:{id:'run-1',provider:'私有供应商',status:'ok',started_at:evidence.observed_at,finished_at:evidence.observed_at},nodes:[],edges:[],companies:[],exposures:[],news:[news],observations:[]};
  assert.equal(parseBundle(bundle).news[0].url,null);assert.equal(eligibleNews(news),true);
  const item:Item={item_id:'news-1',version:1,source:'私有供应商',title:news.title,url:null,published_at:null,first_seen_at:evidence.observed_at,fetched_at:evidence.observed_at,content:quote,content_kind:'full',item_type:'news',language:'zh',license_scope:{store:true,display:true,model:true},availability:'available'};
  const built=await buildInput(bundle,news,{item:async()=>item});
  assert.ok(built);assert.equal(built.sources[0].published_at,null);assert.equal(built.sources[0].url,null);
  assert.equal(await buildInput(bundle,news,{item:async()=>({...item,license_scope:{...item.license_scope,model:false}})}),null);
  assert.equal(await buildInput(bundle,news,{item:async()=>({...item,version:2})}),null);
});
test('current/old/undated labels never use discovery as publication',()=>{
  const now=Date.parse('2026-10-16T12:00:00Z');
  const discovery='2026-10-16T08:00:00Z';
  assert.equal(eventPeriod({source_published_at:discovery,discovered_at:discovery},now),'recent');
  assert.equal(eventPeriod({source_published_at:'2026-09-28T08:00:00Z',discovered_at:discovery},now),'historical');
  const unknown={source_published_at:null,discovered_at:discovery};
  assert.equal(eventPeriod(unknown,now),'undated');assert.match(dateLabel(unknown,now),/发布时间未知.*发现于/);
  assert.equal(eventPeriod({...unknown,draft:{group:{subject:'政策主体',action:'政策发布',discriminator:'政策文件',occurred_on:'2026-09-30'}}},now),'historical');
});
test('gateway request remains bounded, source referenced, and hard cap keeps reservations',()=>{
  const gatewayInput=clone(input);
  gatewayInput.sources[0].item_id='11111111-1111-4111-8111-111111111111';
  gatewayInput.sources[1].item_id='22222222-2222-4222-8222-222222222222';
  const request=modelRequest(gatewayInput,'gemini-2.5-flash');
  assert.throws(()=>modelRequest(input,'gemini-2.5-flash'),/SOURCE_REF_INVALID/);
  assert.ok(request.max_output_tokens<=5000);assert.equal(request.input_item_refs.length,2);
  assert.equal(request.prompt_version,'first-loop-v1');assert.equal(request.input_item_refs[0].version,1);
  assert.equal(request.max_input_tokens,Buffer.byteLength(JSON.stringify(request.messages),'utf8')+8192+1024);
  assert.ok(Buffer.byteLength(JSON.stringify(request),'utf8')<=65536);
  assert.equal('prompt' in request,false);assert.equal('source_refs' in request,false);
  const b={enabled:true,currency:'USD' as const,unit:'micro_usd' as const,day:{limit:1000000,spent:50000,reserved:950000},month:{limit:10000000,spent:50000,reserved:950000},unknown_reserved:654146};
  assert.equal(budgetGate(b),'BUDGET_EXHAUSTED');assert.equal(b.unknown_reserved,654146);
});
