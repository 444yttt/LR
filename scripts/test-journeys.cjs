// Read-only JLR journey probe. Sensitive response data is not printed or committed.
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');

function jwt(key, header, claims) {
  const b = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const input = b(header)+'.'+b(claims);
  const signature=crypto.sign('sha256',Buffer.from(input),{
    key,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32
  }).toString('base64url');
  return input+'.'+signature;
}
function proof(key, method, url) {
  const publicJwk=crypto.createPublicKey(key).export({format:'jwk'});
  const {kty,n,e}=publicJwk;
  return jwt(key,{typ:'dpop+jwt',alg:'PS256',jwk:{kty,n,e}},{
    jti:crypto.randomUUID(),htm:method,htu:new URL(url).origin+new URL(url).pathname,
    iat:Math.floor(Date.now()/1000)
  });
}
async function main(){
  const rl=readline.createInterface({input:stdin,output:stdout});
  let vin=process.env.JLR_VIN;
  if(!vin) vin=await rl.question('Enter 17-character VIN (not stored or printed): ');
  rl.close();
  vin=vin.trim().toUpperCase();
  if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('Invalid VIN format');
  const secretDir=path.join(os.homedir(),'.jlr-secrets');
  const key=fs.readFileSync(path.join(secretDir,'private.pem'),'utf8');
  const tokens=JSON.parse(fs.readFileSync(path.join(secretDir,'tokens.json'),'utf8'));
  if(!tokens.access_token)throw new Error('Missing access token: complete Device Code flow first');
  if(Date.now()>=tokens.expiresAt)throw new Error('Access token expired; refresh authorization before retrying');
  const base='https://data.jlr-vcdp.com/v1/vehicles/'+encodeURIComponent(vin);
  const checks=[
    {name:'Vehicle metadata',url:base},
    {name:'Vehicle status',url:base+'/status'},
    {name:'Journey history (latest 20)',url:base+'/journeys?page=0&size=20&sort=createdAt%2Cdesc'}
  ];
  for(const check of checks){
    const response=await fetch(check.url,{method:'GET',headers:{
      Authorization:'DPoP '+tokens.access_token,
      DPoP:proof(key,'GET',check.url),
      Accept:'application/json'
    }});
    console.log(check.name+': HTTP '+response.status);
    console.log('Correlation ID:',response.headers.get('x-correlation-id')||'not supplied');
    const json=await response.json().catch(()=>null);
    if(!response.ok) {
      console.log('Error code:',json?.title||json?.error||response.statusText);
      console.log('Error type:',json?.type||'not supplied');
      console.log('Response content type:',response.headers.get('content-type')||'not supplied');
      if(json?.detail||json?.error_description)console.log('Description:',json.detail||json.error_description);
      continue;
    }
    if(check.name.startsWith('Journey')){
      const list=Array.isArray(json)?json:(json?.content||json?.journeys||json?.data);
      console.log('Journeys in response:',Array.isArray(list)?list.length:'unknown format');
      if(Array.isArray(list)&&list.length){
        const latest=list[0];
        const allowed=/^(startTime|endTime|startedAt|endedAt|startDateTime|endDateTime|startTimestamp|endTimestamp|createdAt|timestamp|departureTime|arrivalTime)$/i;
        const timestamps=Object.entries(latest).filter(([k,v])=>allowed.test(k)&&typeof v==='string');
        console.log('Journey timestamp candidates:',JSON.stringify(Object.fromEntries(timestamps)));
        console.log('Available field names:',Object.keys(latest).join(', '));
      }else console.log('Top-level response fields:',Object.keys(json||{}).join(', '));
    }else{
      console.log('Vehicle API returned data; full metadata intentionally not displayed.');
    }
  }
}
main().catch(e=>{console.error('Probe stopped:',e.message);process.exitCode=1;});
