// Deterministic, auditable keyword extraction. Never calls itself AI.
export const TERMS = [
  ['javascript',['javascript','js']],['typescript',['typescript','ts']],['python',['python']],['react',['react','react.js','reactjs']],['node.js',['node.js','nodejs']],['sql',['sql','postgresql','mysql']],['postgresql',['postgresql','postgres']],['mongodb',['mongodb']],['html',['html']],['css',['css']],['tailwind css',['tailwind css','tailwindcss']],['git',['git','version control']],['github',['github']],['docker',['docker']],['kubernetes',['kubernetes','k8s']],['aws',['aws','amazon web services']],['azure',['azure']],['google cloud',['gcp','google cloud']],['api design',['api design','rest api','restful api']],['graphql',['graphql']],['testing',['automated testing','unit testing','software testing','test automation','testing']],['playwright',['playwright']],['vitest',['vitest']],['jest',['jest']],['ci/cd',['ci/cd','continuous integration','continuous deployment']],['linux',['linux']],['java',['java']],['c++',['c++']],['c#',['c#','c sharp']],['go',['golang','go programming','go language']],['rust',['rust']],['swift',['swift']],['flutter',['flutter']],['react native',['react native']],['figma',['figma']],['ui/ux',['ui/ux','user experience','user interface design']],['accessibility',['accessibility','wcag']],
  ['excel',['excel','microsoft excel']],['power bi',['power bi','powerbi']],['tableau',['tableau']],['data analysis',['data analysis','data analytics','analytical skills']],['data visualization',['data visualization','dashboards']],['statistics',['statistics','statistical analysis']],['machine learning',['machine learning']],['artificial intelligence',['artificial intelligence','ai systems','ai development']],['llm evaluation',['llm evaluation','llm evaluator','model evaluation','ai evaluation']],['prompt engineering',['prompt engineering']],['data engineering',['data engineering']],['etl',['etl','extract transform load']],['spark',['apache spark','pyspark']],['pandas',['pandas']],
  ['customer support',['customer support','technical support','customer service']],['troubleshooting',['troubleshooting','diagnostics','diagnostic skills']],['networking',['networking','tcp/ip','network operations']],['wifi',['wi-fi','wifi','wireless networking']],['ticketing',['ticketing system','ticket management','incident tickets']],['incident management',['incident management']],['hardware testing',['hardware testing','hardware validation']],['electrical testing',['electrical testing','continuity testing','hi-pot','hipot']],['multimeter',['multimeter','digital multimeter']],['schematics',['schematics','electrical diagrams']],['electronics',['electronics','circuit boards','pcb']],['cad',['cad','computer-aided design']],['solidworks',['solidworks']],['autocad',['autocad']],['freecad',['freecad']],['mechanical assembly',['mechanical assembly','equipment assembly']],['quality assurance',['quality assurance','quality control','qa testing']],['manufacturing',['manufacturing','production line']],['hvac',['hvac']],['ups systems',['uninterruptible power supply','ups systems']],['generators',['backup generators','generator maintenance']],['data centers',['data center','datacenter']],['safety procedures',['safety procedures','lockout tagout','loto']],
  ['project management',['project management','project manager']],['agile',['agile','scrum']],['leadership',['leadership','team lead']],['communication',['communication','communicate effectively']],['teamwork',['teamwork','collaboration','cross-functional']],['problem solving',['problem solving','problem-solving']],['documentation',['documentation','technical writing']],['time management',['time management']],['stakeholder management',['stakeholder management']],['product design',['product design']],['game development',['game development','game design']],['websockets',['websocket','websockets']],['cloudflare',['cloudflare']],['replit',['replit']],['flask',['flask']],['django',['django']],['fastapi',['fastapi']],['terraform',['terraform']],['security',['cybersecurity','information security','application security']]
];
const boundary = c => /[a-z0-9]/i.test(c||'');
export function containsTerm(haystack, term){
  const h = String(haystack||'').toLowerCase(), needle = term.toLowerCase();
  let pos = -1;
  while ((pos=h.indexOf(needle,pos+1))!==-1){
    if (!boundary(h[pos-1]) && !boundary(h[pos+needle.length])) return true;
  }
  return false;
}
export function skillsFromText(text){
  const t=String(text||''); const found = TERMS.filter(([canonical,aliases])=>aliases.some(a=>containsTerm(t,a))).map(([c])=>c);
  return [...new Set(found)];
}
export function parseSkills(raw){
  return [...new Set(String(raw||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))].slice(0,80);
}
export function extractRequirements(description){
  const lines=String(description||'').split(/\n|\.\s+/).map(x=>x.replace(/[•\-]/g,' ').trim()).filter(Boolean);
  return TERMS.flatMap(([name,aliases])=>{
    const evidence=lines.find(line=>aliases.some(a=>containsTerm(line,a)));
    return evidence ? [{name,evidence:evidence.slice(0,230)}] : [];
  });
}
export function compare(skills, requirements){
  const given = parseSkills(skills);
  const own = new Set([...given.map(s=>s.toLowerCase()),...skillsFromText(given.join('\n'))]);
  const matches=requirements.filter(r=>own.has(r.name)||given.some(s=>s.toLowerCase()===r.name));
  const missing=requirements.filter(r=>!matches.includes(r));
  return {score:requirements.length?Math.round(100*matches.length/requirements.length):0, matches, missing, total:requirements.length, matched:matches.length,skills:given};
}
export function concise(text,len=100){return String(text||'').replace(/\s+/g,' ').trim().slice(0,len)};
