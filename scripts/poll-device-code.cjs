// Poll after manually authorizing the JLR user code. Never log tokens.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {signClientAssertion,tokenUrl}=require('./jlr-auth.cjs');
async function main(){
 const file=path.join(os.homedir(),'.jlr-secrets','device-flow.json');
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 if(Date.now()>=s.expiresAt)throw new Error('Code expired; re-run request-device-code.cjs');
 const body=new URLSearchParams({
  client_id:s.clientId,
  client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion:signClientAssertion(s.clientId),
  device_code:s.deviceCode,
  grant_type:'urn:ietf:params:oauth:grant-type:device_code',
  code_verifier:s.verifier
 });
 const r=await fetch(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const j=await r.json();
 console.log('Token HTTP status:',r.status);
 if(!r.ok){console.log('JLR state:',j.error||'unknown');if(j.error_description)console.log('Description:',j.error_description);return;}
 if(!j.access_token)throw new Error('Token response missing access token');
 const target=path.join(os.homedir(),'.jlr-secrets','tokens.json');
 fs.writeFileSync(target,JSON.stringify({access_token:j.access_token,refresh_token:j.refresh_token,expiresAt:Date.now()+(j.expires_in||3600)*1000}),{mode:0o600,flag:'w'});
 fs.chmodSync(target,0o600);
 console.log('SUCCESS: JLR customer token saved privately in Codespaces; no token printed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
