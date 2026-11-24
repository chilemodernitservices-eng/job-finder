import "server-only";
import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedCv, TailoredCv } from "./contracts";

const norm=(value:string|null|undefined)=>String(value||"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const same=(a:string|null|undefined,b:string|null|undefined)=>norm(a)===norm(b);

export function factCheckTailoredCv(original:ParsedCv, tailored:TailoredCv){
  const issues:string[]=[];
  const originalSkillSet=new Set(original.skills.map(norm));
  for(const skill of tailored.skills)if(!originalSkillSet.has(norm(skill)))issues.push(`Added skill: ${skill}`);
  for(const item of tailored.experience){
    const source=original.experience.find(x=>same(x.company,item.company)&&same(x.title,item.title)&&same(x.start,item.start)&&same(x.end,item.end));
    if(!source){issues.push(`Experience not found in original CV: ${item.title} at ${item.company}`);continue;}
    const sourceText=source.bullets.join(" ");
    for(const bullet of item.bullets){
      const numbers=bullet.match(/\b\d+(?:[.,]\d+)*%?\b/g)||[];
      for(const number of numbers)if(!sourceText.includes(number))issues.push(`New numeric claim in ${item.company} bullet: ${number}`);
    }
  }
  for(const item of tailored.education)if(!original.education.some(x=>same(x.institution,item.institution)&&same(x.degree,item.degree)&&same(x.year,item.year)))issues.push(`Education not found in original CV: ${item.institution}`);
  for(const certification of tailored.certifications)if(!original.certifications.some(x=>same(x,certification)))issues.push(`Added certification: ${certification}`);
  const originalNumbers=[original.summary||"",...original.experience.flatMap(x=>x.bullets)].join(" ").match(/\b\d+(?:[.,]\d+)*%?\b/g)||[];
  for(const number of tailored.summary.match(/\b\d+(?:[.,]\d+)*%?\b/g)||[])if(!originalNumbers.includes(number))issues.push(`New numeric claim in summary: ${number}`);
  return {passed:issues.length===0,issues:[...new Set(issues)]};
}

export function originalCvView(profile:ParsedCv):TailoredCv{return {summary:profile.summary||"",skills:[...profile.skills],experience:profile.experience.map(x=>({...x,bullets:[...x.bullets]})),education:profile.education.map(x=>({...x})),certifications:[...profile.certifications]};}

export function ensureCoverLetterSignature(body:string,name:string){
  const signature=name.trim()||"Applicant";
  const normalized=body.trim()
    .replace(/\[(?:your\s+name|applicant(?:'s)?\s+name|name)\]/gi,signature)
    .replace(/(^|\n)\s*(?:your\s+name|applicant\s+name)\s*$/i,`\n${signature}`)
    .trim();
  const lastLine=normalized.split(/\r?\n/).at(-1)?.trim()||"";
  return lastLine.toLocaleLowerCase()===signature.toLocaleLowerCase()
    ? normalized
    : `${normalized}\n${signature}`;
}

export async function writeCvPdf(profile:ParsedCv,cv:TailoredCv){
  const directory=path.resolve(process.env.CV_DIR||"./data/cvs","applications");
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const filePath=path.join(directory,`${randomUUID()}.pdf`);
  const document=new PDFDocument({size:"A4",margins:{top:50,bottom:50,left:58,right:58},info:{Title:`${profile.name||"Candidate"} - CV`,Author:profile.name||"Job Finder user"}});
  const chunks:Buffer[]=[];
  const completed=new Promise<Buffer>((resolve,reject)=>{document.on("data",chunk=>chunks.push(Buffer.from(chunk)));document.on("end",()=>resolve(Buffer.concat(chunks)));document.on("error",reject);});
  const width=document.page.width-document.page.margins.left-document.page.margins.right;
  const bottom=document.page.height-document.page.margins.bottom;
  const ensureSpace=(height:number)=>{if(document.y+height>bottom)document.addPage();};
  const body=(value:string,options:Record<string,unknown>={})=>{
    document.font("Helvetica").fontSize(10).fillColor("#000000").text(value,{width,lineGap:2,...options});
  };
  const section=(title:string)=>{
    ensureSpace(34);
    document.moveDown(.65).font("Helvetica-Bold").fontSize(11).fillColor("#000000").text(title,{width});
    document.moveDown(.2);
  };
  document.font("Helvetica-Bold").fontSize(18).fillColor("#000000").text(profile.name||"Candidate",{width});
  const contact=[profile.email,profile.phone,profile.location].filter(Boolean).join(" | ");
  if(contact){document.moveDown(.2);body(contact);}
  if(cv.summary){section("Professional Summary");body(cv.summary);}
  if(cv.skills.length){section("Skills");body(cv.skills.join(", "));}
  if(cv.experience.length){
    section("Work Experience");
    for(const role of cv.experience){
      ensureSpace(48);
      document.font("Helvetica-Bold").fontSize(10.5).fillColor("#000000").text(`${role.title} - ${role.company}`,{width});
      const dates=[role.start,role.end||"Present"].filter(Boolean).join(" - ");
      if(dates){document.moveDown(.1);body(dates);}
      for(const bullet of role.bullets){
        const text=`- ${bullet}`;
        const height=document.heightOfString(text,{width:width-10,font:"Helvetica",fontSize:10,lineGap:2});
        ensureSpace(height+5);
        document.moveDown(.12);body(text,{indent:10});
      }
      document.moveDown(.35);
    }
  }
  if(cv.education.length){
    section("Education");
    for(const item of cv.education){
      ensureSpace(38);
      document.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text(item.institution,{width});
      const detail=[item.degree,item.year].filter(Boolean).join(" - ");
      if(detail){document.moveDown(.1);body(detail);}
      document.moveDown(.25);
    }
  }
  if(cv.certifications.length){section("Certifications");body(cv.certifications.join(", "));}
  document.end();
  const bytes=await completed;
  await fs.writeFile(filePath,bytes,{mode:0o600,flag:"wx"});
  return filePath;
}
