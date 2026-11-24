import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { sqlite } from "./db";

const COOKIE = "jobfinder_session";
const secret = () => process.env.AUTH_SECRET || process.env.APP_PASSWORD || "development-only-secret";
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
export function jsonError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
export async function getSessionUser() {
  const jar = await cookies(); const value = jar.get(COOKIE)?.value;
  if (!value) return null;
  const parts = value.split(".");
  const payload = parts.length === 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  const signature = parts.length === 3 ? parts[2] : parts[1];
  if (!payload || !signature) return null;
  const [userId, expires] = parts.length === 3 ? payload.split(".") : ["legacy", payload];
  if (!expires || Number(expires) < Date.now()) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (!(a.length === b.length && timingSafeEqual(a, b))) return null;
  if (userId === "legacy") return { id: "legacy", name: "Workspace owner", email: null };
  return sqlite.prepare("SELECT id,name,email FROM users WHERE id=?").get(userId) as { id: string; name: string; email: string } | null;
}
export async function requireAuth() {
  return !!(await getSessionUser());
}
export async function getProfileId() {
  const user = await getSessionUser();
  if (!user) return null;
  const profileId = user.id === "legacy" ? "default" : user.id;
  sqlite.prepare("INSERT OR IGNORE INTO profile(id,updated_at) VALUES(?,?)").run(profileId, new Date().toISOString());
  return profileId;
}
export function getWorkerProfileId(request: Request) {
  const id = request.headers.get("x-worker-profile-id")?.trim();
  if (!id || !sqlite.prepare("SELECT id FROM users WHERE id=?").get(id)) return null;
  sqlite.prepare("INSERT OR IGNORE INTO profile(id,updated_at) VALUES(?,?)").run(id, new Date().toISOString());
  return id;
}
function setSession(userId: string) {
  const expires = String(Date.now() + 1000 * 60 * 60 * 24 * 14);
  const payload = `${userId}.${expires}`;
  return cookies().then((jar) => jar.set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 }));
}
export async function logout() {
  (await cookies()).delete(COOKIE);
}
function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export async function login(password: string, email?: string) {
  if (email) {
    const user = sqlite.prepare("SELECT id,password_hash FROM users WHERE email=?").get(email.toLowerCase()) as { id: string; password_hash: string } | undefined;
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    await setSession(user.id);
    return sqlite.prepare("SELECT id,name,email FROM users WHERE id=?").get(user.id) as { id: string; name: string; email: string };
  }
  const configured = process.env.APP_PASSWORD;
  if (!configured || Buffer.byteLength(password) !== Buffer.byteLength(configured) || !timingSafeEqual(Buffer.from(password), Buffer.from(configured))) return null;
  await setSession("legacy");
  return { id: "legacy", name: "Workspace owner", email: null };
}
export async function register(name: string, email: string, password: string) {
  const id = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  try {
    sqlite.prepare("INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)").run(id, name.trim(), email.toLowerCase(), `${salt}:${hash}`, new Date().toISOString());
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new Error("An account with that email already exists");
    throw error;
  }
  await setSession(id);
  return { id, name: name.trim(), email: email.toLowerCase() };
}
export async function guard() { return await requireAuth() ? null : jsonError("Sign in to use the job finder API", 401); }
