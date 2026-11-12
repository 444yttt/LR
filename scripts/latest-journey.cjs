// Safely find the latest JLR journey end across pages. Never print VIN, tokens, locations or trip records.
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const readline=require('node:readline/promises');
const {refresh}=require('./refresh-token.cjs');
const {stdin,stdout}=require('node:process');
const API='https://data.jlr-vcdp.com';
const PAGE_SIZE=20;
const MAX_PAGES=100;
const JLR_TIMEZONE='Asia/Tokyo';

function proof(privateKey,method,url){
  const pub=crypto.createPublicKey(privateKey).export({format:'jwk'});
  const {kty,n,e}=pub;
  const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const u=new URL(url);
  const input=b({typ:'dpop+jwt',alg:'PS256',jwk:{kty,n,e}})+'.'+b({
    htm:method,htu:u.origin+u.pathname,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID()
  });
  const sig=crypto.sign('sha256',Buffer.from(input),{
    key:privateKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32
  });
  return input+'.'+sig.toString('base64url');
}
function timestamp(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(s))return null;
  const n=Date.parse(s);
  return Number.isFinite(n)?n:null;
}
function latestEnd(item){
  for(const key of ['endTime','endedAt','endDateTime','endTimestamp','arrivalTime']){
    const val=timestamp(item?.[key]);
    if(val!==null)return val;
  }
  return null;
}
async function main(){
  const rl=readline.createInterface({input:stdin,output:stdout});
  let vin=process.env.JLR_VIN;
  if(!vin)vin=await rl.question('VIN (17 characters; do not share transcript): ');
  rl.close();
  vin=vin.trim().toUpperCase();
  if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN must be 17 alphanumeric characters');
  const dir=path.join(os.homedir(),'.jlr-secrets');
  const key=fs.readFileSync(path.join(dir,'private.pem'),'utf8');
  const {tokens,refreshed}=await refresh();
  console.log('Token:',refreshed?'refreshed':'valid');
  let max=null, count=0, scannedPages=0, complete=false, error=null;
  const observedPages=new Set();
  for(let page=0;page<MAX_PAGES;page++){
    const url=API+'/v1/vehicles/'+encodeURIComponent(vin)+'/journeys?page='+page+'&size='+PAGE_SIZE;
    const response=await fetch(url,{headers:{Authorization:'DPoP '+tokens.access_token,DPoP:proof(key,'GET',url),Accept:'application/json'}});
    if(!response.ok){
      error='HTTP '+response.status+(response.status===403?' access forbidden':'');
      break;
    }
    const data=await response.json();
    const items=Array.isArray(data)?data:data?.items;
    if(!Array.isArray(items)){error='Unexpected response (items array missing)';break;}
    const fingerprint=items.map(x=>String(x?.startTime||'')+'|'+String(x?.endTime||'')).join(',');
    if(items.length>0 && observedPages.has(fingerprint)){error='API repeated a page, pagination not reliable';break;}
    if(items.length>0)observedPages.add(fingerprint);
    scannedPages++;
    for(const item of items){
      count++;
      const end=latestEnd(item);
      if(end!==null && (max===null||end>max))max=end;
    }
    const p=data?.page;
    const totalPages=Number.isInteger(p?.totalPages)?p.totalPages:
      Number.isInteger(data?.totalPages)?data.totalPages:null;
    if(items.length===0 || (totalPages!==null && page+1>=totalPages) || p?.last===true || data?.last===true){
      complete=true;break;
    }
    if(items.length<PAGE_SIZE && totalPages===null){
      complete=true;break;
    }
  }
  if(!complete&&!error)error='Safety pagination cap reached; cannot establish overall latest journey';
  console.log('Pages checked:',scannedPages);
  console.log('Journeys checked:',count);
  if(max!==null){
    console.log('Latest observed journey end (UTC):',new Date(max).toISOString());
    console.log('Latest observed journey end (JST):',new Intl.DateTimeFormat('ja-JP',{
      timeZone:JLR_TIMEZONE,dateStyle:'medium',timeStyle:'medium'
    }).format(new Date(max)));
    console.log('Days since observed journey:',Math.max(0,(Date.now()-max)/86400000).toFixed(2));
    if(complete){
      console.log('PAGINATION COMPLETE: latest journey from all returned pages, verify against Remote app.');
      const days=(Date.now()-max)/86400000;
      console.log('Alert classification:',days>=14?'14+ days':days>=7?'7+ days':'below 7 days');
    }else console.log('INCOMPLETE: DO NOT USE as definitive last drive or trigger inactivity alert');
  } else console.log('No journey end detected.');
  if(error)console.log('Probe limitation:',error);
}
main().catch(e=>{console.error('Probe failed:',e.message);process.exitCode=1;});
