import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const STORE_NAME = "sourcebuddy";
const DATA_KEY = "app-data";
const SESSION_SECONDS = 8 * 60 * 60;

function response(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function error(message, status = 400) { return response({ error: message }, status); }
function publicUser(user) { return { id: user.id, username: user.username, name: user.name, role: user.role, companyIds: user.companyIds || [] }; }
function validUsername(value) { return typeof value === "string" && /^[a-zA-Z0-9._-]{3,50}$/.test(value); }
function validPassword(value) { return typeof value === "string" && value.length >= 8 && value.length <= 200; }
function normalizeAssignedUserId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function companyMatchesAssignmentView(company, view, userId) {
  const assignedUserId = normalizeAssignedUserId(company?.assigned_user_id);
  if (view === "available") return !assignedUserId;
  if (view === "assigned") return assignedUserId === userId;
  return true;
}
export function syncUserCompanyIds(db) {
  for (const user of db.users || []) {
    if (user.role !== "user") continue;
    user.companyIds = (db.companies || [])
      .filter(company => normalizeAssignedUserId(company?.assigned_user_id) === user.id)
      .map(company => String(company["#"]));
  }
}
export function assignCompanies(db, companyIds, assignedUserId) {
  const normalizedUserId = normalizeAssignedUserId(assignedUserId);
  const known = new Set((db.companies || []).map(company => String(company["#"]))); 
  for (const companyId of companyIds) {
    if (!known.has(String(companyId))) continue;
    const company = (db.companies || []).find(item => String(item["#"]) === String(companyId));
    if (company) company.assigned_user_id = normalizedUserId;
  }
  syncUserCompanyIds(db);
}

async function initialCompanies() {
  const source = await readFile(path.join(process.cwd(), "companies.js"), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source.replace("const COMPANIES", "globalThis.COMPANIES"), sandbox);
  return sandbox.COMPANIES || [];
}

function normalizeBlobWriteResult(result) {
  if (result == null) return { modified: true, etag: undefined };
  if (typeof result !== "object") return { modified: true, etag: undefined };
  if (typeof result.modified === "boolean") return { modified: result.modified, etag: result.etag };
  return { modified: true, etag: result.etag };
}

export async function loadDatabase(store = getStore(STORE_NAME)) {
  if (!store || typeof store.getWithMetadata !== "function" || typeof store.setJSON !== "function") {
    throw Error("Data store is unavailable");
  }

  try {
    const entry = await store.getWithMetadata(DATA_KEY, { type: "json", consistency: "strong" });
    if (entry) return { store, db: entry.data, etag: entry.etag };

    const db = { users: [], companies: await initialCompanies() };
    const created = await store.setJSON(DATA_KEY, db, { onlyIfNew: true });
    const result = normalizeBlobWriteResult(created);
    if (result.modified) return { store, db, etag: result.etag };
    return loadDatabase();
  } catch (cause) {
    throw Error(`Unable to load data store: ${cause.message || cause}`);
  }
}

export async function saveDatabase(store, db, etag) {
  if (!store || typeof store.setJSON !== "function") throw Error("Data store is unavailable");
  try {
    const saved = await store.setJSON(DATA_KEY, db, { onlyIfMatch: etag });
    const result = normalizeBlobWriteResult(saved);
    if (!result.modified) throw Error("The data changed. Please retry your request.");
  } catch (cause) {
    if (cause.message === "The data changed. Please retry your request.") throw cause;
    throw Error(`Unable to save data store: ${cause.message || cause}`);
  }
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const key = await scrypt(password, salt, 64);
  return { salt, passwordHash: Buffer.from(key).toString("hex") };
}

async function passwordMatches(password, user) {
  const hashed = await hashPassword(password, user.salt);
  return timingSafeEqual(Buffer.from(hashed.passwordHash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function secret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  return process.env.SESSION_SECRET;
}

function sign(value) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function cookieValue(request, name) {
  return (request.headers.get("cookie") || ";").split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sessionId(request) {
  const token = cookieValue(request, "sb_session");
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature.length !== sign(payload).length || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    return session.exp > Math.floor(Date.now() / 1000) ? session.id : null;
  } catch { return null; }
}

function cookie(token, maxAge = SESSION_SECONDS) {
  return `sb_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function currentUser(request, db) {
  const id = sessionId(request);
  return id ? db.users.find(user => user.id === id) || null : null;
}

function authorize(request, db, admin = false) {
  const user = currentUser(request, db);
  if (!user) return [null, error("Sign in required", 401)];
  if (admin && user.role !== "admin") return [null, error("Admin permission required", 403)];
  return [user, null];
}

async function requestData(request) {
  try { return await request.json(); } catch { throw Error("Invalid JSON"); }
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const route = url.pathname;
    const method = request.method;
    const { store, db, etag } = await loadDatabase();

    if (method === "GET" && route === "/api/setup-status") {
      const admins = db.users.filter(user => user.role === "admin");
      return response({ needsSetup: admins.length === 0, adminCount: admins.length });
    }

    if (method === "POST" && route === "/api/setup") {
      if (db.users.some(user => user.role === "admin")) return error("Setup has already been completed", 409);
      const { admins = [] } = await requestData(request);
      if (!Array.isArray(admins) || !admins.length || admins.length > 2) return error("Create one or two admins");
      if (admins.some(admin => !validUsername(admin.username) || !validPassword(admin.password))) return error("Usernames need 3+ valid characters; passwords need 8+ characters");
      if (new Set(admins.map(admin => admin.username.toLowerCase())).size !== admins.length) return error("Admin usernames must be unique");
      for (const admin of admins) {
        const password = await hashPassword(admin.password);
        db.users.push({ id: randomUUID(), username: admin.username.trim(), name: (admin.name || admin.username).trim(), role: "admin", ...password, companyIds: [] });
      }
      await saveDatabase(store, db, etag);
      return response({ ok: true }, 201);
    }

    if (method === "POST" && route === "/api/login") {
      const credentials = await requestData(request);
      const user = db.users.find(item => item.username.toLowerCase() === String(credentials.username || "").trim().toLowerCase());
      if (!user || !(await passwordMatches(String(credentials.password || ""), user))) return error("Invalid username or password", 401);
      return response({ user: publicUser(user) }, 200, { "Set-Cookie": cookie(makeSession(user)) });
    }

    if (method === "POST" && route === "/api/logout") return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("", 0), "Cache-Control": "no-store" } });

    if (method === "GET" && route === "/api/me") {
      const [user, denied] = authorize(request, db);
      return denied || response({ user: publicUser(user) });
    }

    if (method === "GET" && route === "/api/companies") {
      const [user, denied] = authorize(request, db);
      if (denied) return denied;
      const view = url.searchParams.get("view") || (user.role === "admin" ? "available" : "assigned");
      const assignedUserId = url.searchParams.get("assignedUserId") || (user.role === "admin" ? null : user.id);
      const companies = (db.companies || []).filter(company => companyMatchesAssignmentView(company, view, user.role === "admin" ? assignedUserId : user.id));
      return response({ companies, view, assignedUserId: user.role === "admin" ? assignedUserId : user.id });
    }

    if (method === "POST" && route === "/api/companies/assign") {
      const [, denied] = authorize(request, db, true);
      if (denied) return denied;
      const data = await requestData(request);
      if (!Array.isArray(data.companyIds)) return error("Company IDs array required");
      const assignedUserId = normalizeAssignedUserId(data.assignedUserId);
      if (assignedUserId) {
        const targetUser = db.users.find(user => user.id === assignedUserId);
        if (!targetUser) return error("User not found", 404);
      }
      assignCompanies(db, data.companyIds, assignedUserId);
      await saveDatabase(store, db, etag);
      return response({ ok: true, companies: db.companies });
    }

    if (method === "PUT" && route === "/api/companies") {
      const [user, denied] = authorize(request, db);
      if (denied) return denied;
      const { companies } = await requestData(request);
      if (!Array.isArray(companies)) return error("Companies array required");
      if (user.role === "admin") { db.companies = companies.map(company => ({ ...company, assigned_user_id: normalizeAssignedUserId(company?.assigned_user_id) })); syncUserCompanyIds(db); await saveDatabase(store, db, etag); return response({ ok: true, companies: db.companies }); }
      const allowed = new Set((user.companyIds || []).map(String));
      const known = new Map(db.companies.map(company => [String(company["#"]), company]));
      let next = Math.max(0, ...db.companies.map(company => Number(company["#"]) || 0)) + 1;
      for (const incoming of companies) {
        const id = String(incoming?.["#"] ?? "");
        if (known.has(id)) { if (!allowed.has(id)) return error("Company access denied", 403); Object.assign(known.get(id), incoming, { "#": known.get(id)["#"], assigned_user_id: user.id }); }
        else { const created = { ...incoming, "#": next++, assigned_user_id: user.id }; db.companies.push(created); allowed.add(String(created["#"])); }
      }
      db.users.find(item => item.id === user.id).companyIds = [...allowed];
      syncUserCompanyIds(db);
      await saveDatabase(store, db, etag);
      return response({ ok: true, companies: db.companies.filter(company => allowed.has(String(company["#"]))) });
    }

    if (method === "GET" && route === "/api/users") {
      const [, denied] = authorize(request, db, true);
      return denied || response({ users: db.users.map(publicUser) });
    }

    if (method === "POST" && route === "/api/users") {
      const [, denied] = authorize(request, db, true);
      if (denied) return denied;
      const data = await requestData(request);
      if (!validUsername(data.username) || !validPassword(data.password)) return error("Username or password is invalid");
      if (db.users.some(user => user.username.toLowerCase() === data.username.trim().toLowerCase())) return error("Username already exists", 409);
      const password = await hashPassword(data.password);
      const user = { id: randomUUID(), username: data.username.trim(), name: (data.name || data.username).trim(), role: "user", ...password, companyIds: [] };
      db.users.push(user); await saveDatabase(store, db, etag); return response({ user: publicUser(user) }, 201);
    }

    if (method === "POST" && route === "/api/admins") {
      const [, denied] = authorize(request, db, true);
      if (denied) return denied;
      const data = await requestData(request);
      if (db.users.filter(user => user.role === "admin").length >= 2) return error("Maximum of two admins");
      if (!validUsername(data.username) || !validPassword(data.password)) return error("Username or password is invalid");
      if (db.users.some(user => user.username.toLowerCase() === data.username.trim().toLowerCase())) return error("Username already exists", 409);
      const password = await hashPassword(data.password);
      const user = { id: randomUUID(), username: data.username.trim(), name: (data.name || data.username).trim(), role: "admin", ...password, companyIds: [] };
      db.users.push(user); await saveDatabase(store, db, etag); return response({ user: publicUser(user) }, 201);
    }

    const match = route.match(/^\/api\/users\/([^/]+)(?:\/(password|companies))?$/);
    if (match) {
      const [, denied] = authorize(request, db, true);
      if (denied) return denied;
      const user = db.users.find(item => item.id === match[1]);
      if (!user) return error("User not found", 404);
      if (method === "DELETE" && !match[2]) { if (user.role === "admin") return error("Admins cannot be deleted here"); db.users = db.users.filter(item => item.id !== user.id); await saveDatabase(store, db, etag); return new Response(null, { status: 204 }); }
      const data = await requestData(request);
      if (method === "PUT" && match[2] === "password") { if (!validPassword(data.password)) return error("Password must contain at least 8 characters"); Object.assign(user, await hashPassword(data.password)); await saveDatabase(store, db, etag); return response({ ok: true }); }
      if (method === "PUT" && match[2] === "companies") {
        if (user.role !== "user" || !Array.isArray(data.companyIds)) return error("Company assignment is only valid for users");
        const known = new Set(db.companies.map(company => String(company["#"])));
        user.companyIds = [...new Set(data.companyIds.map(String))].filter(id => known.has(id));
        for (const company of db.companies) {
          if (user.companyIds.includes(String(company["#"]))) company.assigned_user_id = user.id;
          else if (company.assigned_user_id === user.id) company.assigned_user_id = null;
        }
        syncUserCompanyIds(db);
        await saveDatabase(store, db, etag);
        return response({ user: publicUser(user) });
      }
    }
    return error("Not found", 404);
  } catch (cause) {
    console.error(cause);
    return error(cause.message || "Request failed");
  }
};

export const config = { path: "/api/*" };
