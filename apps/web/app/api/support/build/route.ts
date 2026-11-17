import { NextResponse } from "next/server";
import { release } from "node:os";
import { compiledSupportBuildInfo, sanitizeSupportBuildInfo } from "@/lib/support-diagnostics";
import { isLocalWebHostname, resolveVdtAppModeForRequest } from "@/lib/app-mode";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public build identifiers only; never inspect user storage or environment wholesale. */
export async function GET(request: Request) {
  if (!isLocalWebHostname(new URL(request.url).hostname) || resolveVdtAppModeForRequest(request) === "hosted_web" ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.get("origin") && !hasSameLocalOrigin(request))) {
    return NextResponse.json({ error: "Build diagnostics are available in the local application." }, { status: 403 });
  }
  return NextResponse.json(sanitizeSupportBuildInfo({
    ...compiledSupportBuildInfo(), platform: process.platform, architecture: process.arch, osRelease: release(), nodeVersion: process.version
  }), { headers: { "Cache-Control": "no-store" } });
}
