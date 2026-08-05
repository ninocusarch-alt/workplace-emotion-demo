import {
  createUser,
  findUserByTokenHash,
  getDatabase,
  touchUser,
  type UserRecord,
} from "./database";

const COOKIE_NAME = "huan_user";

export type Identity = {
  user: UserRecord;
  setCookie?: string;
};

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function serializeCookie(token: string, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

export function clearIdentityCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function getIdentity(request: Request): Promise<Identity> {
  const database = await getDatabase();
  const existingToken = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (existingToken && /^[A-Za-z0-9_-]{40,64}$/.test(existingToken)) {
    const existingUser = await findUserByTokenHash(
      database,
      await sha256(existingToken),
    );
    if (existingUser) {
      await touchUser(database, existingUser.id);
      return { user: existingUser };
    }
  }

  const token = makeToken();
  const user = await createUser(database, await sha256(token));
  return { user, setCookie: serializeCookie(token, request.url) };
}

export function jsonWithIdentity(
  identity: Identity,
  data: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (identity.setCookie) headers.append("set-cookie", identity.setCookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}
