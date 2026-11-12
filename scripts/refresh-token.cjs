// Refresh JLR owner access token in Codespaces without exposing credentials.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {signClientAssertion,tokenUrl}=require('./jlr-auth.cjs');
const stateDir=path.join(os.homedir(),'.jlr-secrets');
const tokenFile=path.join(stateDir,'tokens.json');
function dpop(method,url,key,nonce){
  const jwk=crypto.createPublicKey(key).export({format:'jwk'});
  const {kty,n,e}=jwk;
  const head={typ:'dpop+jwt',alg:'PS256',jwk:{kty,n,e}};
  const body={htm:method,htu:new URL(url).origin+new URL(url).pathname,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID()};
  if(nonce)body.nonce=nonce;
  const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const raw=b(head)+'.'+b(body);
  const sig=crypto.sign('sha256',Buffer.from(raw),{key,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
  return raw+'.'+sig;
}
async function refresh(){
  const old=JSON.parse(fs.readFileSync(tokenFile,'utf8'));
  if(Date.now()<old.expiresAt-60000)return {refreshed:false,tokens:old};
  if(!old.refresh_token)throw new Error('No refresh token stored. Reauthorize via Device Code flow.');
  const state=JSON.parse(fs.readFileSync(path.join(stateDir,'device-flow.json'),'utf8'));
  const key=fs.readFileSync(path.join(stateDir,'private.pem'),'utf8');
  let nonce;
  for(let i=0;i<2;i++){
    const result=await fetch(tokenUrl,{method:'POST',headers:{
      'Content-Type':'application/x-www-form-urlencoded',DPoP:dpop('POST',tokenUrl,key,nonce)
    },body:new URLSearchParams({
      grant_type:'refresh_token',refresh_token:old.refresh_token,client_id:state.clientId,
      client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion:signClientAssertion(state.clientId)
    })});
    const body=await result.json().catch(()=>({}));
    if(!result.ok){
      const nextNonce=result.headers.get('dpop-nonce');
      if(i===0 && nextNonce && (body.error==='use_dpop_nonce'||result.status===400||result.status===401)){nonce=nextNonce;continue;}
      throw new Error('JLR refresh failed: HTTP '+result.status+' '+(body.error||'unknown')+'. Run device authorization again if credentials were revoked.');
    }
    if(!body.access_token)throw new Error('Refresh response missing access_token');
    const updated={access_token:body.access_token,refresh_token:body.refresh_token||old.refresh_token,expiresAt:Date.now()+(body.expires_in||3600)*1000};
    const tmp=tokenFile+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(updated),{mode:0o600});
    fs.renameSync(tmp,tokenFile);
    fs.chmodSync(tokenFile,0o600);
    return {refreshed:true,tokens:updated};
  }
}
if(require.main===module){refresh().then(v=>console.log(v.refreshed?'JLR token refreshed successfully.':'Current JLR token remains valid.')).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={refresh};
