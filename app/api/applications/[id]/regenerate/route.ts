import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
import { ParsedCv } from "@/app/lib/contracts";
import { getProfileId, guard, jsonError } from "@/app/lib/http";
import { ensureCoverLetterSignature, factCheckTailoredCv, originalCvView, writeCvPdf } from "@/app/lib/materials";

export const runtime="nodejs";
export async function POST(_request:NextRequest,context:RouteContext<"/api/applications/[id]/regenerate">){
  const denied=await guard();if(denied)return denied;
  const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const {id}=await context.params;
  const row=sqlite.prepare("SELECT a.id AS application_id,a.status AS application_status,a.answers_json AS application_answers_json,a.events_json AS application_events_json,j.id AS job_id,j.title AS job_title,j.company_name AS company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.profile_id=?").get(id, profileId) as Record<string,unknown>|undefined;
  if(!row)return jsonError("Application not found",404);
  if(row.application_status==="sent")return jsonError("A sent application cannot be changed",409);
  const materials=JSON.parse(String(row.application_answers_json||"{}")) as {cvProfileSnapshot?:unknown};
  const profile=ParsedCv.safeParse(materials.cvProfileSnapshot);
  if(!profile.success)return jsonError("The saved original CV snapshot is unavailable",409);
  const tailored=originalCvView(profile.data);const factCheck=factCheckTailoredCv(profile.data,tailored);const pdfPath=await writeCvPdf(profile.data,tailored);
  const letter=ensureCoverLetterSignature(`Dear Hiring Team,\n\nI am applying for the ${String(row.job_title)} role at ${String(row.company)}. ${profile.data.summary||`My experience includes ${profile.data.skills.slice(0,5).join(", ")||"the experience in my attached CV"}.`} I would welcome the opportunity to discuss how my background may fit your team.\n\nThank you for your consideration.`,profile.data.name);
  const timestamp=new Date().toISOString();const events=JSON.parse(String(row.application_events_json||"[]")) as {at:string;event:string;message:string}[];events.push({at:timestamp,event:"replaced_with_original_cv",message:"AI-tailored version replaced with the original CV profile at the user's request."});
  sqlite.prepare("UPDATE applications SET tailored_cv_path=?,cover_letter=?,answers_json=?,events_json=?,status=CASE WHEN method='email' THEN 'queued' ELSE 'manual_required' END,error=NULL WHERE id=?").run(pdfPath,letter,JSON.stringify({...materials,tailoredCv:tailored,factCheck}),JSON.stringify(events),row.application_id);
  return NextResponse.json({tailoredCv:tailored,factCheck,coverLetter:letter,message:"Prepared a PDF using only the saved original CV profile."});
}
