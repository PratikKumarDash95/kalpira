// ============================================
// Shim for `next/server` (NextResponse / NextRequest).
// Resolved via tsconfig "paths" so copied route files import it unchanged.
// Built on the Node global Response/Request (Node >= 18).
// ============================================

export class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new Response(JSON.stringify(data), { ...init, headers });
  }

  static redirect(url: string | URL, init?: number | ResponseInit): Response {
    const status = typeof init === 'number' ? init : (init?.status ?? 307);
    const headers = new Headers(typeof init === 'object' ? init?.headers : undefined);
    headers.set('location', String(url));
    return new Response(null, { status, headers });
  }

  static next(): Response {
    return new Response(null, { status: 200 });
  }
}

// Route files only use NextRequest as a type; a thin alias is enough.
export class NextRequest extends Request {}
