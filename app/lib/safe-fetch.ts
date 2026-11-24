import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

function publicV4(ip: string) {
  const n=ip.split(".").map(Number);if(n.length!==4||n.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b,c]=n;
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0&&c===0)||(a===192&&b===0&&c===2)||(a===198&&(b===18||b===19))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}

async function readUrl(url: URL): Promise<{status:number;location:string|null;body:string;contentType:string}> {
  if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443")throw new Error("Only public HTTPS job pages are allowed");
  const host=url.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Local and private hosts are not allowed");
  let address: string;
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(host)){address=host;if(!publicV4(address))throw new Error("Private network addresses are not allowed");}
  else {const records=await lookup(host,{all:true,verbatim:true});const ipv4=records.filter(record=>record.family===4).map(record=>record.address);if(!ipv4.length||ipv4.some(ip=>!publicV4(ip)))throw new Error("The host did not resolve to a public IPv4 address");address=ipv4[0];}
  return await new Promise((resolve,reject)=>{
    const pinnedLookup:LookupFunction=(_hostname,options,callback)=>{if(typeof options==="object"&&options.all)callback(null,[{address,family:4}]);else callback(null,address,4);};
    const req=httpsRequest(url,{method:"GET",servername:host,lookup:pinnedLookup,headers:{"User-Agent":"JobFinder/1.0 (+self-hosted personal job discovery)",Accept:"text/html,application/xhtml+xml,application/ld+json;q=0.9"},timeout:8000},res=>{
      const status=res.statusCode||0;const location=typeof res.headers.location==="string"?res.headers.location:null;const contentType=String(res.headers["content-type"]||"");
      if([301,302,303,307,308].includes(status)){res.resume();resolve({status,location,body:"",contentType});return;}
      if(!/text\/html|application\/xhtml\+xml|application\/ld\+json/i.test(contentType)){res.resume();reject(new Error("The link did not return a supported HTML job page"));return;}
      const chunks:Buffer[]=[];let size=0;res.on("data",chunk=>{const data=Buffer.from(chunk);size+=data.length;if(size>2*1024*1024){req.destroy(new Error("The job page is larger than 2 MB"));return;}chunks.push(data);});
      res.on("end",()=>resolve({status,location,body:Buffer.concat(chunks).toString("utf8"),contentType}));res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("The job page request timed out")));req.on("error",reject);req.end();
  });
}

export async function fetchPublicHtml(startUrl:string) {
  let current=new URL(startUrl);
  for(let hop=0;hop<=3;hop++){
    const result=await readUrl(current);
    if([301,302,303,307,308].includes(result.status)){
      if(!result.location||hop===3)throw new Error("The job link has too many redirects");
      current=new URL(result.location,current);continue;
    }
    if(result.status<200||result.status>=300)throw new Error(`The job page returned HTTP ${result.status}`);
    return {url:current.toString(),html:result.body};
  }
  throw new Error("Could not resolve the job link");
}
