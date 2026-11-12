const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const tokenUrl='https://auth.jlr-vcdp.com/realms/public/protocol/openid-connect/token';
function signClientAssertion(clientId){
 const key=fs.readFileSync(path.join(os.homedir(),'.jlr-secrets','private.pem'),'utf8');
 const now=Math.floor(Date.now()/1000);
 const header={alg:'PS256',typ:'JWT'};
 const claims={iss:clientId,sub:clientId,aud:tokenUrl,jti:crypto.randomUUID(),iat:now,exp:now+300};
 const input=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 const sig=crypto.sign('sha256',Buffer.from(input),{key,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
 return input+'.'+sig;
}
module.exports={signClientAssertion,tokenUrl};
