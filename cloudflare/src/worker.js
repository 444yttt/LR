// Garage Monitor / Cloudflare Worker (read-only vehicle telemetry).
// No credentials or location data in code, logs, or public responses.
const PROVIDER='jlr';
const ORIGIN='https://data.jlr-vcdp.com';
const TOKEN_URL='https://auth.jlr-vcdp.com/realms/public/protocol/openid-connect/token';
const encoder=new TextEncoder();
const now=()=>new Date().toISOString();
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64json=obj=>b64url(encoder.encode(JSON.stringify(obj)));
const base64bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function assertConfigured(env){
  for(const field of ['JLR_CLIENT_ID','JLR_VIN','JLR_PRIVATE_KEY','JLR_REFRESH_TOKEN','JLR_VAULT_KEY'])
    if(!env[field])throw new Error('not_configured:'+field);
}
async function importPrivate(pem){
  const der=base64bytes(pem.replace(/-----[^-]+-----/g,'').replace(/\s+/g,''));
  return crypto.subtle.importKey('pkcs8',der,{name:'RSA-PSS',hash:'SHA-256'},true,['sign']);
}
async function sign(key,head,body){
  const input=b64json(head)+'.'+b64json(body);
  const sig=await crypto.subtle.sign({name:'RSA-PSS',saltLength:32},key,encoder.encode(input));
  return input+'.'+b64url(sig);
}
async function assertion(key,id){
  const t=Math.floor(Date.now()/1000);
  return sign(key,{typ:'JWT',alg:'PS256'},{iss:id,sub:id,aud:TOKEN_URL,jti:crypto.randomUUID(),iat:t,exp:t+300});
}
async function dpop(key,method,url,nonce){
  const jwk=await crypto.subtle.exportKey('jwk',key);
  const {kty,n,e}=jwk;
  const u=new URL(url);
  const payload={htm:method,htu:u.origin+u.pathname,jti:crypto.randomUUID(),iat:Math.floor(Date.now()/1000)};
  if(nonce)payload.nonce=nonce;
  return sign(key,{typ:'dpop+jwt',alg:'PS256',jwk:{kty,n,e}},payload);
}
async function vaultKey(raw){
  return crypto.subtle.importKey('raw',base64bytes(raw),'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptToken(key,token){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(token));
  return {iv:b64url(iv),ciphertext:b64url(ct)};
}
async function decryptToken(key,item){
  const iv=base64bytes(item.iv.replace(/-/g,'+').replace(/_/g,'/'));
  const ct=base64bytes(item.ciphertext.replace(/-/g,'+').replace(/_/g,'/'));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct));
}
async function getRefresh(env,key){
  const row=await env.DB.prepare('SELECT ciphertext,iv FROM credential_vault WHERE provider=?').bind(PROVIDER).first();
  return row?decryptToken(key,row):env.JLR_REFRESH_TOKEN;
}
async function putRefresh(env,key,token){
  const x=await encryptToken(key,token);
  await env.DB.prepare('INSERT INTO credential_vault(provider,ciphertext,iv,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at').bind(PROVIDER,x.ciphertext,x.iv,now()).run();
}
async function tokenRequest(env,privateKey,refreshToken){
  for(let attempt=0,nonce;attempt<2;attempt++){
    const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',DPoP:await dpop(privateKey,'POST',TOKEN_URL,nonce)},body:new URLSearchParams({
      grant_type:'refresh_token',refresh_token:refreshToken,client_id:env.JLR_CLIENT_ID,
      client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion:await assertion(privateKey,env.JLR_CLIENT_ID)
    })});
    const j=await r.json().catch(()=>({}));
    if(r.ok&&j.access_token)return j;
    const next=r.headers.get('dpop-nonce');
    if(attempt===0&&next){nonce=next;continue;}
    throw new Error('token_http_'+r.status+'_'+String(j.error||'unknown').slice(0,32));
  }
}
async function getJson(url,token,key){
  for(let attempt=0,nonce;attempt<2;attempt++){
    const r=await fetch(url,{headers:{Authorization:'DPoP '+token,DPoP:await dpop(key,'GET',url,nonce),Accept:'application/json'}});
    if(r.ok)return r.json();
    const next=r.headers.get('dpop-nonce');
    if(attempt===0&&next){nonce=next;continue;}
    throw new Error('api_http_'+r.status);
  }
}
// Conservative signal mapping: missing/unsupported fields stay null, never inferred.
function valNum(v,min,max){
  const n=(typeof v==='number')?v:(typeof v?.value==='number'?v.value:null);
  return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}
function iso(v){
  if(typeof v!=='string')return null;
  const n=Date.parse(v);
  return Number.isFinite(n)?new Date(n).toISOString():null;
}
function normaliseJlr(status,diagnostics,ev){
  const vehicle=status?.Vehicle||status?.vehicle||{};
  const power=vehicle?.Powertrain||vehicle?.powertrain||{};
  const fuel=power?.FuelSystem||power?.fuelSystem||{};
  const traction=ev?.Vehicle?.Powertrain?.TractionBattery || ev?.vehicle?.powertrain?.tractionBattery||{};
  const rangeKm=valNum(vehicle?.Range ?? vehicle?.range ?? status?.range,0,2000);
  const fuelPercent=valNum(fuel?.RelativeLevel ?? fuel?.Level ?? status?.fuelPercent,0,100);
  const electricRangeKm=valNum(traction?.Range ?? ev?.electricRange,0,2000);
  const soc=valNum(traction?.StateOfCharge?.Current ?? ev?.stateOfCharge,0,100);
  const health=['good','attention-required','service-required'].includes(diagnostics?.overallHealth)?diagnostics.overallHealth:'unknown';
  const dtcs=Array.isArray(diagnostics?.troubleCodes)?diagnostics.troubleCodes:null;
  const activeDtc=dtcs?dtcs.filter(x=>x?.active===true).length:null;
  const maintenance=Array.isArray(diagnostics?.maintenanceIndicators)?diagnostics.maintenanceIndicators:null;
  const maintenanceDue=maintenance?maintenance.filter(x=>x?.status==='due-soon'||x?.status==='overdue').length:null;
  return {
    rangeKm,electricRangeKm,fuelPercent,soc,health,faultsCount:activeDtc,maintenanceDue,
    statusUpdatedAt:iso(status?.timestamp||status?.lastUpdated),
    healthUpdatedAt:iso(diagnostics?.lastUpdated)
  };
}
function parseEnd(item){
  for(const field of ['endTime','endedAt','endDateTime','endTimestamp','arrivalTime']){
    const v=item?.[field];
    if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)){
      const n=Date.parse(v);
      if(Number.isFinite(n)&&n<Date.now()+3600000)return n;
    }
  }
  return null;
}
async function collect(env){
  assertConfigured(env);
  if(!env.DB)throw new Error('not_configured:DB');
  const lock=await env.DB.prepare('SELECT enabled FROM vehicles WHERE id=?').bind('range-l460').first();
  if(!lock?.enabled)return {status:'disabled'};
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO ingestion_runs(id,vehicle_id,source,status) VALUES(?,'range-l460','jlr','running')").bind(id).run();
  let n=0,pages=0,latest=null,complete=false;
  try{
    const priv=await importPrivate(env.JLR_PRIVATE_KEY);
    const vault=await vaultKey(env.JLR_VAULT_KEY);
    const current=await getRefresh(env,vault);
    const token=await tokenRequest(env,priv,current);
    // Important: persist rotated refresh token before fetching vehicle data.
    if(token.refresh_token)await putRefresh(env,vault,token.refresh_token);
    const fingerprints=new Set();
    for(let p=0;p<100;p++){
      const url=ORIGIN+'/v1/vehicles/'+encodeURIComponent(env.JLR_VIN)+'/journeys?page='+p+'&size=20';
      const data=await getJson(url,token.access_token,priv);
      const items=data?.items;
      if(!Array.isArray(items))throw new Error('unexpected_journey_schema');
      const fp=items.map(x=>String(x?.journeyId||'')+'|'+String(x?.endTime||'')).join(',');
      if(items.length&&fingerprints.has(fp))throw new Error('repeated_page');
      if(items.length)fingerprints.add(fp);
      pages++;n+=items.length;
      for(const item of items){const t=parseEnd(item);if(t!==null&&(latest===null||t>latest))latest=t;}
      const totalPages=Number.isInteger(data?.page?.totalPages)?data.page.totalPages: null;
      if(!items.length||data?.page?.last===true||(totalPages!==null&&p+1>=totalPages)||(items.length<20&&totalPages===null)){complete=true;break;}
    }
    if(!complete)throw new Error('pagination_incomplete');
    // Optional probes: failure in one category must not suppress the verified journey result.
    const base=ORIGIN+'/v1/vehicles/'+encodeURIComponent(env.JLR_VIN);
    const [status,diagnostics,ev]=await Promise.all([
      getJson(base+'/status',token.access_token,priv).catch(()=>null),
      getJson(base+'/diagnostics',token.access_token,priv).catch(()=>null),
      getJson(base+'/ev',token.access_token,priv).catch(()=>null)
    ]);
    const signals=normaliseJlr(status,diagnostics,ev);
    // Protect against missing data or stale API: never assert 'not driven' if there is no reliable journey end.
    if(latest===null)throw new Error('no_journey_end');
    const end=new Date(latest).toISOString();
    const previous=await env.DB.prepare('SELECT last_drive_at,last_drive_verified FROM snapshots WHERE vehicle_id=?').bind('range-l460').first();
    // A change in source timestamp must be cross-checked in Remote app before enabling automatic alerts.
    const verified=previous?.last_drive_at===end&&previous?.last_drive_verified===1?1:0;
    await env.DB.prepare(`INSERT INTO snapshots(vehicle_id,fetched_at,source,last_drive_at,last_drive_verified,data_status,payload_json,updated_at)
    VALUES(? ,?,'jlr',?,?,'fresh','{}',?)
    ON CONFLICT(vehicle_id) DO UPDATE SET fetched_at=excluded.fetched_at,source=excluded.source,last_drive_at=excluded.last_drive_at,
    last_drive_verified=excluded.last_drive_verified,data_status='fresh',error_code=NULL,updated_at=excluded.updated_at`)
      .bind('range-l460',now(),end,verified,now()).run();
    await env.DB.prepare(`UPDATE snapshots SET range_km=?,electric_range_km=?,fuel_percent=?,soc_percent=?,
      health_status=?,faults_count=?,maintenance_due_count=?,status_updated_at=?,health_updated_at=?,payload_json=?
      WHERE vehicle_id='range-l460'`).bind(
      signals.rangeKm,signals.electricRangeKm,signals.fuelPercent,signals.soc,signals.health,signals.faultsCount,
      signals.maintenanceDue,signals.statusUpdatedAt,signals.healthUpdatedAt,
      JSON.stringify({status_available:!!status,diagnostics_available:!!diagnostics,ev_available:!!ev})
    ).run();
    await env.DB.prepare("UPDATE ingestion_runs SET status='complete',finished_at=?,page_count=?,journey_count=? WHERE id=?").bind(now(),pages,n,id).run();
    // Alerts are recorded only once after initial operator validation of source semantics.
    // Actual push delivery requires an explicit notifier integration; no silent claim of delivery.
    if(verified){
      const age=(Date.now()-latest)/86400000;
      for(const days of [7,14]){
        if(age>=days)await env.DB.prepare("INSERT OR IGNORE INTO alert_events(id,vehicle_id,alert_type,threshold_days,last_drive_at,delivery_status) VALUES(?,'range-l460','inactivity',?,?, 'pending')").bind(crypto.randomUUID(),days,end).run();
      }
    }
    return {status:'complete',journeys:n,pages,verified:!!verified};
  }catch(e){
    const code=String(e.message||'unknown').replace(/[^\w:-]/g,'_').slice(0,80);
    await env.DB.prepare("UPDATE ingestion_runs SET status='error',finished_at=?,page_count=?,journey_count=?,error_code=? WHERE id=?").bind(now(),pages,n,code,id).run();
    await env.DB.prepare("UPDATE snapshots SET data_status='error',error_code=?,updated_at=? WHERE vehicle_id='range-l460'").bind(code,now()).run();
    return {status:'error',error:code};
  }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export default {
  async fetch(request,env){
    // Fail closed; unauthenticated traffic cannot infer even vehicle existence.
    if(!env.GARAGE_API_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.GARAGE_API_TOKEN)
      return new Response('Not Found',{status:404,headers:{'Cache-Control':'no-store'}});
    const u=new URL(request.url);
    if(u.pathname==='/api/vehicles'&&request.method==='GET'){
      const result=await env.DB.prepare(`SELECT v.id,v.make,v.model,v.model_year,v.display_name,v.enabled,
      s.last_drive_at,s.last_drive_verified,s.fetched_at,s.data_status,s.range_km,s.electric_range_km,
      s.fuel_percent,s.soc_percent,s.battery_12v_voltage,s.health_status,s.faults_count,
      s.odometer_km,s.status_updated_at,s.health_updated_at,s.maintenance_due_count FROM vehicles v LEFT JOIN snapshots s ON s.vehicle_id=v.id ORDER BY v.created_at`).all();
      return json({vehicles:result.results,generated_at:now()});
    }
    if(u.pathname==='/api/capabilities'&&request.method==='GET'){
      const result=await env.DB.prepare('SELECT vehicle_id,field,state,updated_at FROM telemetry_capabilities ORDER BY vehicle_id,field').all();
      return json({capabilities:result.results});
    }
    return new Response('Not Found',{status:404,headers:{'Cache-Control':'no-store'}});
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil(collect(env).then(r=>{console.log('garage_collection_status',r.status);}).catch(()=>{console.log('garage_collection_failed');}));
  }
};
