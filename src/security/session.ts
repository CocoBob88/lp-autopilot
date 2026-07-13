import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

const SESSION_COOKIE = "lp_autopilot_session";
const CSRF_COOKIE = "lp_autopilot_csrf";

type Session = { userId: string; address: string; chainId: number };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function createSession(session: Session) {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .setJti(randomBytes(16).toString("hex"))
    .sign(secret());
  const csrf = randomBytes(24).toString("base64url");
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 43_200,
  });
  store.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 43_200,
  });
  return csrf;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId !== "string" ||
      typeof payload.address !== "string" ||
      typeof payload.chainId !== "number"
    )
      return null;
    return {
      userId: payload.userId,
      address: payload.address,
      chainId: payload.chainId,
    };
  } catch {
    return null;
  }
}

export async function requireSession(request?: Request) {
  const session = await getSession();
  if (!session) throw new Response("Authentication required", { status: 401 });
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const cookie = (await cookies()).get(CSRF_COOKIE)?.value;
    const header = request.headers.get("x-csrf-token");
    if (!cookie || !header || cookie !== header)
      throw new Response("CSRF validation failed", { status: 403 });
  }
  return session;
}
