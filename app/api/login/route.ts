import { NextResponse } from "next/server";
import { validateCredentials, setAuthCookie, getValidatedEmail } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    // Allow empty fields for testing purposes
    const isValid = validateCredentials(email, password);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Use validated email for token creation (handles empty case)
    const validatedEmail = getValidatedEmail(email);
    await setAuthCookie(validatedEmail);

    return NextResponse.json({ success: true, email: validatedEmail });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
