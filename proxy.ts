import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Bypass authentication for preview and development environments
  const isPreview = process.env.VERCEL_ENV === 'preview';
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isPreview || isDevelopment) {
    // For preview/dev, just redirect /login to / and allow everything else
    if (path === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Original authentication logic for production
  const isPublicPath = path === "/login";

  // Get the auth token from cookies
  const token = request.cookies.get("auth-token")?.value;

  // Verify the token
  const isValidToken = token ? await verifyToken(token) : null;

  // Redirect to login if trying to access protected route without valid token
  if (!isPublicPath && !isValidToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect to home if trying to access login with valid token
  if (isPublicPath && isValidToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
