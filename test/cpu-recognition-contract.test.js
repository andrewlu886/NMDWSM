const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCpuRecognition, cpuModel, normalizeCpuRecognition, mergeCpuAnalysis } = require('../src/services/cpu-vision');
const { lookupCpuReferences, handleCpuReferenceRequest } = require('../src/services/cpu-library');
const { collaborateCpuAnalysis, withCpuBudget } = require('../src/services/cpu-vision');

test('Gemma and region OCR can corroborate a readable SKU without using appearance confidence', () => {
  const gemma='Category: CPU\nModel: i5-14400F\nEvidence: Intel Core i5-14400F\nConfidence: low';
  const region={model:'i5-14400F',regionId:'label-0',nativeTextHeight:24};
  const worker={accepted:false,textVerified:false,fusionEligible:true,fusionEvidence:[region],ocrModels:['i5-14400F'],
    evidence:['Intel Core i5-14400F'],readings:[{text:'i5-14400F',confidence:.72}]};
  const result=buildCpuRecognition(gemma,worker);
  assert.equal(result.status,'verified');assert.equal(result.requiresConfirmation,false);
  assert.equal(result.evidence.verificationMethod,'gemma_quote_and_region_ocr');
  assert.equal(normalizeCpuRecognition(result).status,'verified');
  for (const weaker of [{...worker,fusionEligible:false},{...worker,fusionEvidence:[{...region,nativeTextHeight:10}]},
    {...worker,fusionEvidence:[]},null]) assert.equal(buildCpuRecognition(gemma,weaker).requiresConfirmation,true);
  for(const evidence of ['Intel Core i5','i5-14400','i5-14400KF']) {
    assert.equal(buildCpuRecognition(gemma.replace('Intel Core i5-14400F',evidence),worker).requiresConfirmation,true);
  }
  assert.equal(buildCpuRecognition(gemma.replace('Model: i5-14400F','Model: i5-14400'),worker).status,'conflict');
  assert.equal(buildCpuRecognition(gemma,{...worker,ocrModels:['i5-14400','i5-14400F']}).status,'conflict');
  assert.equal(buildCpuRecognition(gemma,{...worker,evidence:[]}).requiresConfirmation,true);
  assert.equal(buildCpuRecognition(gemma,{...worker,readings:[...worker.readings,{text:'Intel Core i5-15400F',confidence:.98}]}).status,'conflict',
    'a complete unlisted SKU in the other photo region must still block automatic adoption');
});

test('fusion preserves PRO, Plus and X3D in the actual quoted label', () => {
  for(const model of ['Ryzen 3 4350G PRO','Ryzen 7 5800X3D','Ultra 5 250K Plus']) {
    const worker={accepted:false,fusionEligible:true,fusionEvidence:[{model,nativeTextHeight:30}],ocrModels:[model],evidence:[model]};
    assert.equal(buildCpuRecognition(`Category: CPU\nModel: ${model}\nEvidence: ${model}`,worker).status,'verified');
    assert.equal(buildCpuRecognition(`Category: CPU\nModel: ${model}\nEvidence: unreadable`,worker).requiresConfirmation,true);
  }
});

test('full suffixes and unknown variants never collapse to a neighbouring SKU', () => {
  for (const sku of ['i5-12400','i5-12400F','i5-12600K','i5-12600KF','i9-12900KS',
    'Ryzen 5 5600X','Ryzen 5 5600XT','Ryzen 7 5800X3D','Ryzen 5 5600GT',
    'Ryzen 3 4350G PRO','Ultra 5 250K Plus']) assert.equal(cpuModel(sku),sku);
  assert.equal(cpuModel('i5-124OOF'),null);
  assert.equal(cpuModel('i5-12400XYZ'),null);
  assert.equal(cpuModel('Intel(R) Core(TM) i3-14100'),'i3-14100');
  assert.equal(cpuModel('Intel® Core™ i7-13700KF'),'i7-13700KF');
  assert.equal(cpuModel('AMD Ryzen(TM) 7 5800X3D'),'Ryzen 7 5800X3D');
  assert.equal(cpuModel('AMD Ryzen 3 PRO 4350G'),'Ryzen 3 4350G PRO');
});

test('only physical worker evidence verifies; clear text is adopted and ambiguity is held', () => {
  const photo='Category: CPU\nModel: i5-12400F\nConfidence: high';
  const offline=buildCpuRecognition(photo);
  assert.equal(offline.status,'candidate'); assert.equal(offline.degraded,true);
  const weak=buildCpuRecognition(photo,{accepted:false,evidence:[],candidates:[{model:'i5-13400',score:.99}]});
  assert.deepEqual(weak.candidates,['i5-12400F']);
  const reading={text:'i5-12400F',box:[[1,2],[3,2],[3,4],[1,4]],coordinateSpace:'resized-upload'};
  const verified=buildCpuRecognition(photo,{accepted:true,textVerified:true,model:'i5-12400F',evidence:['i5-12400F'],readings:[reading],version:'test'});
  assert.equal(verified.status,'verified');assert.equal(verified.requiresConfirmation,false);
  assert.equal(verified.automaticAdoptionEnabled,true);assert.deepEqual(verified.evidence.readings,[reading]);
  const conflict=buildCpuRecognition(photo,{accepted:true,textVerified:true,model:'i5-12400',evidence:['i5-12400']});
  assert.equal(conflict.status,'conflict'); assert.equal(conflict.model,null);
  assert.equal(buildCpuRecognition('Category: CPU\nModel: unknown').status,'unreadable');
  assert.equal(buildCpuRecognition('Category: graphics card\nModel: RTX 4060'),null);
  const multiple=buildCpuRecognition('Category: CPU\nModel: i5-12400 / i5-12400F',
    {accepted:true,textVerified:true,model:'i5-12400',evidence:['i5-12400']});
  assert.equal(multiple.status,'conflict');assert.equal(multiple.requiresConfirmation,true);
});

test('reference metadata cannot establish a model and lookup never substitutes a similar model', () => {
  const r=buildCpuRecognition('Category: CPU\nModel: unknown',{accepted:false,evidence:[],references:[{model:'i5-12400F'}]});
  assert.equal(r.status,'unreadable');assert.deepEqual(r.candidates,[]);
  assert.deepEqual(lookupCpuReferences('i5-12400FAKE').images,[]);
  const correct=buildCpuRecognition('Category: CPU\nModel: i5-12400F',
    {accepted:true,textVerified:true,model:'i5-12400F',evidence:['i5-12400F'],references:[{model:'i5-12400'}]});
  assert.equal(correct.model,'i5-12400F');assert.equal(correct.status,'verified');
  const unsupported=buildCpuRecognition('Category: CPU\nModel: unknown',
    {accepted:false,readings:[{text:'i9-99999KS',confidence:.99}],evidence:['i9-99999KS']});
  assert.equal(unsupported.status,'candidate');assert.deepEqual(unsupported.candidates,['i9-99999KS']);
  assert.equal(unsupported.requiresConfirmation,true);
});

test('private reference routes reject external hosts, tunnel headers and arbitrary paths', () => {
  for(const pathname of ['/api/cpu/references/../../secret/reference','/api/cpu/references/00000000000000000000/reference']) {
    let status; const res={writeHead:code=>{status=code;},end:()=>{}};
    assert.equal(handleCpuReferenceRequest({method:'GET',headers:{host:'public.example'},socket:{remoteAddress:'127.0.0.1'}},res,new URL('http://localhost'+pathname)),pathname.startsWith('/api/cpu/references/') && !pathname.includes('..'));
    if(!pathname.includes('..')) assert.equal(status,404);
  }
});

test('fast pipeline makes no extra LLM calls and bounded OCR cannot block forever', async () => {
  let calls=0, result;
  await collaborateCpuAnalysis('Category: CPU\nModel: i5-12400F',
    {accepted:true,textVerified:true,model:'i5-12400F',evidence:['i5-12400F']},
    async()=>{calls++;throw Error('must not call reviewer');}, {onRecognition:r=>{result=r;}});
  assert.equal(calls,0);assert.equal(result.requiresConfirmation,false);
  await assert.rejects(withCpuBudget(()=>new Promise(()=>{}),undefined,20),/逾時/);
  const legacy=buildCpuRecognition('Category: CPU\nModel: i5-12400F',
    {accepted:true,model:'i5-12400F',evidence:['i5-12400F']});
  assert.equal(legacy.requiresConfirmation,true,'old workers have not applied the clear-text policy');
});

test('all-image library stays private even behind loopback tunnels', () => {
  for(const headers of [{host:'public.example'},{host:'localhost','x-forwarded-for':'1.2.3.4'},{host:'localhost','cf-connecting-ip':'1.2.3.4'}]) {
    let status,body;
    handleCpuReferenceRequest({method:'GET',headers,socket:{remoteAddress:'127.0.0.1'}},
      {writeHead:c=>{status=c;},end:b=>{body=JSON.parse(b);}},new URL('http://localhost/api/cpu/library'));
    assert.equal(status,404);assert.equal(body.error,'Private library');
  }
});

test('unreadable scene exclusions disappear from retrieval but remain traceable in the private catalog', () => {
  const catalog=require('../data/cpu-library/catalog.json');
  const excluded=catalog.images.filter(row=>row.review.status==='excluded');
  assert.ok(excluded.some(row=>row.review.exclusionCode==='scene_sku_unreadable'));
  const request={method:'GET',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}};
  let status,body;
  const response={writeHead:code=>{status=code;},end:value=>{body=JSON.parse(value);}};
  handleCpuReferenceRequest(request,response,new URL('http://localhost/api/cpu/library'));
  assert.equal(status,200);assert.equal(body.total,catalog.images.length-excluded.length);
  assert.ok(body.images.every(row=>row.review.status!=='excluded'));
  handleCpuReferenceRequest(request,response,new URL(`http://localhost/api/cpu/library/${excluded[0].id}/reference`));
  assert.equal(status,404);
  const kept=catalog.images.find(row=>row.relative==='i5-13500\\盒裝\\i5-13500_盒裝_003.jpg');
  assert.equal(kept.review.sceneReview.readablePart,'box');assert.notEqual(kept.review.status,'excluded');
});

test('a missing digit is not a second SKU when separate clear upload OCR establishes the full model', () => {
  const analysis='Category: CPU\nModel: i5-1440F\nConfidence: high';
  const worker={accepted:true,textVerified:true,model:'i5-14400F',evidence:['i5-14400F'],
    readings:[{text:'i5-14400F',confidence:.96}]};
  const clear=buildCpuRecognition(analysis,worker);
  assert.equal(clear.status,'verified');assert.equal(clear.model,'i5-14400F');assert.equal(clear.requiresConfirmation,false);
  assert.deepEqual(clear.candidates,['i5-14400F']);
  assert.equal(clear.evidence.anomalies[0].value,'i5-1440F');
  assert.equal(clear.evidence.gemma.model,'i5-1440F','preserve original observation without repairing its digits');
  assert.match(mergeCpuAnalysis(analysis,worker),/^Candidate: i5-14400F$/m);
  const unavailable=buildCpuRecognition(analysis);
  assert.equal(unavailable.requiresConfirmation,true);assert.deepEqual(unavailable.candidates,['i5-1440F']);
  const highConflict=buildCpuRecognition(analysis,{...worker,readings:[...worker.readings,{text:'i5-1440F',confidence:.97}]});
  assert.equal(highConflict.status,'conflict');
});

test('legacy incomplete-reading conflicts recover only with recorded worker verification and clear pixels', () => {
  const value={schemaVersion:1,status:'conflict',model:null,candidates:['i5-1440F','i5-14400F'],requiresConfirmation:true,
    evidence:{source:'uploaded_image',readings:[{text:'i5-1440F',confidence:.3},{text:'i5-14400F',confidence:.96}]}};
  const analysis='Category: CPU\nModel: unknown\nCPU model observation: {"model":"i5-14400F","textVerified":true}';
  const clear=normalizeCpuRecognition(value,analysis);
  assert.equal(clear.status,'verified');assert.equal(clear.model,'i5-14400F');assert.equal(clear.requiresConfirmation,false);
  assert.equal(normalizeCpuRecognition(value).requiresConfirmation,true,'library membership alone cannot verify a model');
  const suffix=normalizeCpuRecognition({...value,candidates:['i5-14400','i5-14400F']},analysis);
  assert.equal(suffix.status,'conflict');assert.equal(suffix.requiresConfirmation,true);
  const unknown=normalizeCpuRecognition({...value,candidates:['i5-15400F','i5-14400F']},analysis);
  assert.equal(unknown.status,'conflict','unlisted but complete model must not be replaced by a known neighbour');
});
