import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import {createRun,logEvent,finishRun,saveDraft,beginReview,getRun,getEvents,listRuns,recoverInterruptedRuns,recentCount,closeStore} from './store.js';
import {parseSkills,extractRequirements,compare,concise} from './engine.js';
import {extractCareerRequirements,normalizeExperiences,buildEvidenceLinks,classifyRequirements,applyCareerReview,generateTransitionBrief} from './evidence-engine.js';
import {processCareerDraft,processCareerReview} from './workflow.js';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const HOST=process.env.HOST||'0.0.0.0'; const PORT=Number(process.env.PORT)||3000;
await recoverInterruptedRuns();
const clients=new Map();
const flows=[['receive','Receive experience evidence'],['validate','Validate submitted inputs'],['retrieve','Retrieve the job posting'],['extract','Extract role requirements'],['normalize','Normalize experience evidence'],['link','Build source-backed evidence links'],['classify','Classify evidence support'],['brief','Generate the transition brief'],['save','Save the reviewed result']];
function cookie(req,res){const raw=(req.headers.cookie||'').match(/(?:^|;\s*)mm_session=([0-9a-f]{48})/);if(raw)return raw[1];const token=crypto.randomBytes(24).toString('hex');res.setHeader('Set-Cookie',`mm_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);return token}
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function outEvent(id,event){for(const client of clients.get(id)||[])try{client.write('event: step\ndata: '+JSON.stringify(event)+'\n\n')}catch{}}
async function stage(id,phase,status,message,detail='',duration_ms=null){const persisted=await logEvent(id,phase,status,message,detail,duration_ms);const ev={id:persisted.id,run_id:id,phase,status,message,detail,duration_ms,at:persisted.at};outEvent(id,ev);return ev}
async function timed(id,phase,action){const started=performance.now();await stage(id,phase,'running',action.title+' started');try{const result=await action.work();await stage(id,phase,'completed',action.title+' completed',result.detail||'',Math.max(0,Math.round(performance.now()-started)));return result.value}catch(e){await stage(id,phase,'failed',action.title+' failed',e.message,Math.max(0,Math.round(performance.now()-started)));throw e}}
function finishSSE(id){for(const client of clients.get(id)||[])try{client.write('event: done\ndata: {}\n\n')}catch{}}
function launchWorkflow(id,work){setTimeout(()=>Promise.resolve().then(work).catch(async(error)=>{const message=String(error.message||'Unknown error');try{await finishRun(id,'failed',{error:message});await stage(id,'overall','failed','Run stopped safely',message)}catch{}}).finally(()=>finishSSE(id)),60)}
async function body(req){let total=0,chunks=[];for await(const c of req){total+=c.length;if(total>50000)throw Error('Input too large (50 KB maximum).');chunks.push(c)};try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw Error('Please submit valid JSON.')}}
function blockedIP(ip){const family=net.isIP(ip);if(family===4){const a=ip.split('.').map(Number);return a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===192&&a[1]===0||a[0]===192&&a[1]===88&&a[2]===99||a[0]===198&&([18,19].includes(a[1])||a[1]===51&&a[2]===100)||a[0]===203&&a[1]===0&&a[2]===113;}const address=ip.toLowerCase();return family!==6||address==='::1'||address==='::'||/^f[cd]/.test(address)||/^fe[89ab]/.test(address)||/^ff/.test(address)||address.startsWith('2001:db8')||address.startsWith('::ffff:')||address.startsWith('64:ff9b:1:')||address.startsWith('100:')}
async function validateURL(input){let url;try{url=new URL(input)}catch{throw Error('Enter a valid HTTPS job posting URL.')};if(url.protocol!=='https:'||url.username||url.password||url.port||net.isIP(url.hostname)||!url.hostname.includes('.')||/\.(local|internal|localhost)$/i.test(url.hostname))throw Error('Please use a public HTTPS job posting link, or paste the description.');const addresses=await dns.lookup(url.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>blockedIP(a.address)))throw Error('This address cannot be fetched safely. Paste the job description instead.');return {url,addresses}}
function stripHTML(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#39;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim()}
async function readURL(address){const {url,addresses}=await validateURL(address);return new Promise((resolve,reject)=>{let settled=false;const done=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value)};const pinnedLookup=(host,options,callback)=>{if(host!==url.hostname)return callback(new Error('Unexpected DNS lookup.'));if(options?.all)return callback(null,addresses);const address=addresses[0];callback(null,address.address,address.family)};const agent=new https.Agent({keepAlive:false,lookup:pinnedLookup});const request=https.request(url,{method:'GET',agent,servername:url.hostname,headers:{'user-agent':'RIVET/1.0 public job-description reader','accept':'text/html,text/plain'}},response=>{const status=response.statusCode||0;if([301,302,303,307,308].includes(status)){response.resume();agent.destroy();return done(Error('This job page redirected. Open the final posting and paste its description instead.'))}if(status<200||status>=300){response.resume();agent.destroy();return done(Error(`Job website returned HTTP ${status}. Paste its description instead.`))}const type=String(response.headers['content-type']||'');if(!/text\/(html|plain)/i.test(type)){response.resume();agent.destroy();return done(Error('The link did not return a readable job page.'))}if(Number(response.headers['content-length'])>250000){response.resume();agent.destroy();return done(Error('Job page is too large. Paste the description instead.'))}const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>250000){request.destroy();agent.destroy();done(Error('Job page is too large. Paste the description instead.'));return}chunks.push(chunk)});response.on('end',()=>{if(settled)return;const contents=Buffer.concat(chunks).toString('utf8');const text=type.toLowerCase().includes('text/html')?stripHTML(contents):contents;agent.destroy();if(text.length<100)return done(Error('Could not extract enough job text. Paste the description instead.'));done(null,text.slice(0,30000))});response.on('error',error=>{agent.destroy();done(Error(error.message||'Job website could not be read. Paste its description instead.'))})});request.setTimeout(9000,()=>request.destroy(Error('The job website timed out. Paste its description instead.')));request.on('error',error=>{agent.destroy();done(Error(error.message||'Job website could not be read. Paste its description instead.'))});request.end()})}
const wait=t=>new Promise(r=>setTimeout(r,t));
async function processRun(id,data){let jobText='',requirements=[],result=null;try{
 await timed(id,'validate',{title:'Validate input',work:async()=>{if(data.source==='paste'&&data.description.trim().length<100)throw Error('Paste at least 100 characters from a real job description.');if(data.source==='url'&&!data.url.trim())throw Error('Enter a job posting URL.');if(parseSkills(data.skills).length===0)throw Error('Add at least one real skill first.');return {value:true,detail:'Checked submitted skills, source type and size limits.'}}});
 jobText=await timed(id,'source',{title:'Read job description',work:async()=>{const text=data.source==='url'?await readURL(data.url):data.description;return {value:text,detail:data.source==='url'?`Retrieved ${text.length} readable characters from the public job page.`:`Received ${text.length} pasted characters; external fetch not needed.`}}});
 requirements=await timed(id,'extract',{title:'Extract requirements',work:async()=>{if(data.fault==='extract')throw Error('Simulated extraction failure for resilience testing. Your inputs are preserved.');const found=extractRequirements(jobText);if(!found.length)throw Error('No recognized technical skills found. Try a fuller job description with specific requirements.');return {value:found,detail:`Identified ${found.length} recognizable skill terms; each includes an excerpt from the posting.`}}});
 result=await timed(id,'compare',{title:'Compare skills',work:async()=>{const computed=compare(data.skills,requirements);return {value:{...computed,source:data.source,jobTitle:concise(jobText,75),method:'Exact and alias-based keyword overlap, not an employability prediction.'},detail:`Matched ${computed.matched} of ${computed.total} extracted terms. No hiring prediction is made.`}}});
 await timed(id,'save',{title:'Save result',work:async()=>{finishRun(id,'completed',{job_title:result.jobTitle,result});return {value:true,detail:'Saved run and measured workflow events to the server database.'}}});
  await stage(id,'overall','completed','Analysis complete',`${result.matched}/${result.total} terms matched.`);
  }catch(err){const msg=String(err.message||'Unknown error');await finishRun(id,'failed',{error:msg});await stage(id,'overall','failed','Run stopped safely',msg)}finally{for(const c of clients.get(id)||[])try{c.write('event: done\ndata: {}\n\n')}catch{}}}
async function rateLimit(owner){return (await recentCount(owner))<5}
async function route(req,res){const owner=cookie(req,res);const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
if(pathname==='/api/health')return send(res,200,{ok:true,service:'MatchMap',version:'1.0.0'});
 if(pathname==='/api/runs'&&req.method==='GET')return send(res,200,{runs:await listRuns(owner)});
if(pathname==='/api/runs'&&req.method==='POST'){
  const data=await body(req);if(!['url','paste'].includes(data.source))return send(res,400,{error:'Choose link or pasted description.'});
  if(typeof data.skills!=='string'||typeof data.description!=='string'||typeof data.url!=='string'||data.skills.length>6000||data.description.length>30000||data.url.length>2000)return send(res,400,{error:'Invalid or oversized input.'});
   if(!await rateLimit(owner))return send(res,429,{error:'Limit reached: five analyses per hour. You can still replay prior runs.'});
   const id=crypto.randomUUID();await createRun({id,owner,created_at:new Date().toISOString(),source:data.source,input_url:data.source==='url'?data.url:null,input_text:data.source==='paste'?data.description:null,skills:data.skills});
  send(res,202,{id});setTimeout(()=>processRun(id,{source:data.source,url:data.url,description:data.description,skills:data.skills,fault:data.fault==='extract'?'extract':null}),60);return;
}
 const match=pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(events))?$/);
 if(match){const id=match[1],run=await getRun(id,owner);if(!run)return send(res,404,{error:'Run not found in this browser session.'});
 if(match[2]==='events'){
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  for(const event of await getEvents(id)){res.write('event: step\ndata: '+JSON.stringify(event)+'\n\n')}
  if(run.status!=='running'){res.write('event: done\ndata: {}\n\n');res.end();return}
  if(!clients.has(id))clients.set(id,new Set());clients.get(id).add(res);const ping=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(ping);clients.get(id)?.delete(res)});return;
 }
  return send(res,200,{...run,events:await getEvents(id)});
}
if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
let file=pathname==='/'?'/index.html':pathname; if(!['/index.html','/app.js','/style.css','/favicon.svg'].includes(file))return send(res,404,{error:'Not found'});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
try{const content=await fs.readFile(path.join(__dirname,'public',file));res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'public,max-age=180'});res.end(content)}catch{send(res,404,{error:'Not found'})}
}
async function routeV2(req,res){
  const owner=cookie(req,res);
  const url=new URL(req.url,'http://localhost');
  const pathname=url.pathname;
  if(pathname==='/api/health')return send(res,200,{ok:true,service:'RIVET',version:'2.0.0'});
  if(pathname==='/api/runs'&&req.method==='GET')return send(res,200,{runs:await listRuns(owner)});

  if(pathname==='/api/runs'&&req.method==='POST'){
    const data=await body(req);
    if(!['url','paste'].includes(data.source))return send(res,400,{error:'Choose a job link or pasted description.'});
    if(typeof data.skills!=='string'||typeof data.description!=='string'||typeof data.url!=='string'||data.skills.length>6000||data.description.length>30000||data.url.length>2000)return send(res,400,{error:'Invalid or oversized input.'});
    if(typeof data.targetRole!=='string'||data.targetRole.length>140)return send(res,400,{error:'Target role must be 140 characters or fewer.'});
    if(!Array.isArray(data.experiences)||data.experiences.length<1||data.experiences.length>20)return send(res,400,{error:'Add one to twenty real work experiences or projects.'});
    if(data.experiences.some(item=>!item||typeof item.text!=='string'||item.text.trim().length<8||item.text.length>8000||typeof item.title!=='string'||item.title.length>120))return send(res,400,{error:'Each experience needs a title and at least eight characters of text.'});
    if(data.experiences.reduce((sum,item)=>sum+item.text.length,0)>30000)return send(res,400,{error:'Experience text is limited to 30,000 characters per analysis.'});
    let recovery = null;
    if(data.retryOf){
      const started=performance.now();
      if(typeof data.retryOf!=='string'||!(/^[0-9a-f-]{36}$/).test(data.retryOf))return send(res,400,{error:'Invalid recovery reference.'});
      const prior=await getRun(data.retryOf,owner);
      if(!prior||prior.status!=='failed')return send(res,400,{error:'Recovery requires a failed run from this browser session.'});
      recovery={priorId:prior.id,duration:Math.max(0,Math.round(performance.now()-started))};
    }
    if(!await rateLimit(owner))return send(res,429,{error:'Limit reached: five analyses per hour. You can still replay prior runs.'});
    const id=crypto.randomUUID();
    const experienceEntries=data.experiences.map((item,index)=>({id:String(item.id||`experience-${index+1}`).slice(0,80),title:item.title.trim(),text:item.text.trim()}));
    await createRun({id,owner,created_at:new Date().toISOString(),source:data.source,target_role:data.targetRole||null,input_url:data.source==='url'?data.url:null,input_text:data.source==='paste'?data.description:null,experience_text:JSON.stringify(experienceEntries),skills:data.skills});
    if(recovery)await stage(id,'recovery','completed','Retry requested after a failed run',`Verified ownership of failed run ${recovery.priorId}. A new execution will run; the prior failure is preserved.`,recovery.duration);
    send(res,202,{id});
    launchWorkflow(id,()=>processCareerDraft(id,{...data,experiences:experienceEntries,fault:data.fault==='extract'?'extract':null},{stage,saveDraft,finishRun,readURL}));
    return;
  }

  const match=pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(events|review))?$/);
  if(match){
    const id=match[1],run=await getRun(id,owner);
    if(!run)return send(res,404,{error:'Run not found in this browser session.'});
    if(match[2]==='review'){
      if(req.method!=='POST')return send(res,405,{error:'Method not allowed.'});
      const submission=await body(req);
      if(submission.acknowledgeReview!==true)return send(res,400,{error:'Confirm that you reviewed the evidence classifications before generating the brief.'});
      if(run.status!=='awaiting_review'||!run.result)return send(res,409,{error:'This run is not waiting for review.'});
      let reviewedDraft;
      try{
        reviewedDraft=applyCareerReview(run.result,submission.corrections||[]);
      }catch(error){
        return send(res,400,{error:error.message||'Review correction is invalid.'});
      }
      const savedEvents=await getEvents(id);
      const reviewGate=savedEvents.filter(event=>event.phase==='review_gate'&&event.status==='skipped').at(-1);
      const elapsed=reviewGate?Math.max(0,Date.now()-Date.parse(reviewGate.at)):0;
      const reviewEvent=await beginReview(id,Math.min(elapsed,2147483647),(submission.corrections||[]).length);
      if(!reviewEvent)return send(res,409,{error:'This review has already been submitted.'});
      outEvent(id,reviewEvent);
      send(res,202,{id});
      launchWorkflow(id,()=>processCareerReview(id,reviewedDraft,{stage,finishRun}));
      return;
    }
    if(match[2]==='events'){
      if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      for(const event of await getEvents(id))res.write('event: step\ndata: '+JSON.stringify(event)+'\n\n');
      if(run.status!=='running'){res.write('event: done\ndata: {}\n\n');res.end();return}
      if(!clients.has(id))clients.set(id,new Set());
      clients.get(id).add(res);
      const ping=setInterval(()=>res.write(': heartbeat\n\n'),15000);
      req.on('close',()=>{clearInterval(ping);clients.get(id)?.delete(res)});
      return;
    }
    if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
    return send(res,200,{...run,events:await getEvents(id)});
  }

  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  let file=pathname==='/'||pathname==='/index.html'?'/rivet.html':pathname;
  if(!['/rivet.html','/rivet.js','/rivet-diagrams.js','/rivet.css','/rivet.svg'].includes(file))return send(res,404,{error:'Not found'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  try{
    const content=await fs.readFile(path.join(__dirname,'public',file));
    res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'public,max-age=180'});
    res.end(content);
  }catch{
    send(res,404,{error:'Not found'});
  }
}
const server=http.createServer((req,res)=>routeV2(req,res).catch(e=>send(res,400,{error:e.message||'Unexpected request error.'})));
server.listen(PORT,HOST,()=>console.log(`MatchMap running at http://${HOST}:${PORT}`));
process.on('SIGTERM',()=>server.close(()=>closeStore().then(()=>process.exit(0))));
process.on('SIGINT',()=>server.close(()=>closeStore().then(()=>process.exit(0))));
