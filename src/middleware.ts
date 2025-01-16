import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';
import { NextRequest, NextResponse } from 'next/server';

export default function middleware(request: NextRequest) {
  const supportedFormats = ['ris', 'bibtex'];
  
  const exportMatch = request.nextUrl.pathname.match(/\/lib\/(.+?)\/export\/(ris|bibtex)$/);
  if (exportMatch) {
    if (!supportedFormats.includes(exportMatch[2])) {
      return NextResponse.json(
        { error: `Unsupported export format. Supported formats are: ${supportedFormats.join(', ')}` },
        { status: 400 }
      );
    }
    const key = exportMatch[1];
    const format = exportMatch[2];
    const finalURL = new URL(`/api/item/${key}/export/${format}`, request.url);
    return NextResponse.rewrite(finalURL);
  }
  
  return createMiddleware(routing)(request);
}
 
export const config = {
  // Matcher entries are linked with a logical "or", therefore
  // if one of them matches, the middleware will be invoked.
  matcher: [
    // Match all pathnames except for
    // - … if they start with `/api`, `/_next`, `/_vercel`, or `/ingest`
    // - … the ones containing a dot (e.g. `favicon.ico`)
    '/((?!api|_next|_vercel|ingest|.*\\..*).*)',
    // Updated matchers for new export URL format
    '/([\\w-]+)?/lib/:path*/export/ris',
    '/([\\w-]+)?/lib/:path*/export/bibtex'
  ]
};