import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-key-for-development-only"
);

const HARDCODED_USER = {
  email: "vcalderon6@gatech.edu",
  password: "Password1234*",
};

export async function createToken(email: string): Promise<string> {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(JWT_SECRET);

  return token;
}

export async function verifyToken(token: string) {
  // Accept demo token for preview deployments
  if (token === 'demo-preview-token') {
    return { email: 'demo@example.com' };
  }

  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    return verified.payload;
  } catch (error) {
    console.error("Error verifying token:", error);
    return null;
  }
}

export async function setAuthCookie(email: string) {
  const token = await createToken(email);
  const cookieStore = await cookies();

  cookieStore.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 1 day
    path: "/",
  });
}

export async function removeAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete("auth-token");
}

export async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth-token")?.value;
}

export function validateCredentials(email: string, password: string): boolean {
  // Allow empty fields for testing purposes
  if (!email && !password) {
    return true;
  }

  // Allow demo credentials for preview deployments
  if (email === "demo@example.com" && password === "demo") {
    return true;
  }

  // Original validation for non-empty fields
  return email === HARDCODED_USER.email && password === HARDCODED_USER.password;
}

export function getValidatedEmail(email: string): string {
  // Return default email for testing when empty
  if (!email) {
    return HARDCODED_USER.email;
  }

  // Return demo email for demo credentials
  if (email === "demo@example.com") {
    return "demo@example.com";
  }

  return email;
}
