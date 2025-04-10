import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';
import { NextRequest, NextResponse } from 'next/server';
import { unescapeXML } from './lib/utils';
import { getCachedItemSmall } from './app/api/cache';
import { ItemsGetResponse } from './app/api/items/types';
import { ItemGetResponse } from './app/api/item/types';
import redirections from './constants/redirections.json';

export type RateLimit = {
  count: number;
  firstRequest: number;
}

export const rateLimits = new Map<string, RateLimit>();

const AMOUNT_OF_REQUESTS = 10;
const RESET_TIME = 60000;

function generateRateLimitObject(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || request.headers.get("x-envoy-external-address");
  const ipRateLimit = ip ? (rateLimits.get(ip) || { count: 0, firstRequest: 0 }) : null;

  const cookie = request.cookies.get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`);
  let cookieRateLimit = null;
  if (cookie) {
    try {
      const distinctId = JSON.parse(cookie.value).distinct_id;
      cookieRateLimit = rateLimits.get(distinctId) || { count: 0, firstRequest: 0 };
      rateLimits.set(distinctId, cookieRateLimit);
    } catch (e) {
    }
  }

  let rateLimit = null;
  if (ipRateLimit && cookieRateLimit) {
    rateLimit = ipRateLimit.count > cookieRateLimit.count ? ipRateLimit : cookieRateLimit;
  } else {
    rateLimit = ipRateLimit || cookieRateLimit || { count: 0, firstRequest: 0 };
  }

  if (ip) {
    rateLimits.set(ip, rateLimit);
  }

  return rateLimit;
}

function setRateLimitHeaders(response: NextResponse, rateLimit: RateLimit | null) {
  if (rateLimit) {
    response.headers.set('X-RateLimit-Limit', AMOUNT_OF_REQUESTS.toString());
    response.headers.set('X-RateLimit-Remaining', (AMOUNT_OF_REQUESTS - rateLimit.count).toString());
    response.headers.set('X-RateLimit-Reset', (rateLimit.firstRequest + RESET_TIME).toString());
    
    if (rateLimit.count >= AMOUNT_OF_REQUESTS) {
      const retryAfter = Math.ceil((rateLimit.firstRequest + RESET_TIME - Date.now()) / 1000);
      response.headers.set('Retry-After', retryAfter.toString());
    }
  }
  
  return response;
}

function fixRequestUrl(request: NextRequest) {
  const url = request.url.toString();
  return process.env.REPLACE_HTTPS === "true" ? url.replace("https://", "http://") : url;
}


export default async function middleware(request: NextRequest) {
  const rateLimit = generateRateLimitObject(request);

  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/lib', fixRequestUrl(request)));
  }

  // Check for redirections for item keys in URLs like /lib/{key}
  const libItemMatch = request.nextUrl.pathname.match(/\/lib\/([^\/]+)(.*)/);
  if (libItemMatch) {
    const key = libItemMatch[1] as keyof typeof redirections;
    const rest = libItemMatch[2] || ''; // Everything after the key
    
    if (redirections[key]) {
      // Create new URL with redirected key, keeping everything else the same
      const newUrl = new URL(`/lib/${redirections[key]}${rest}`, fixRequestUrl(request));
      request.nextUrl.searchParams.forEach((value, paramKey) => {
        newUrl.searchParams.set(paramKey, value);
      });
      return NextResponse.redirect(newUrl, 301);
    }
  }

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
    const finalURL = new URL(`/api/item/${key}/export/${format}`, fixRequestUrl(request));
    return setRateLimitHeaders(NextResponse.rewrite(finalURL), rateLimit);
  } 
  
  const downloadMatch = request.nextUrl.pathname.match(/\/lib\/(.+?)\/download\/([^\/]+)(.*)$/);
  if (downloadMatch) {
    const itemKey = downloadMatch[1];
    const attachmentKey = downloadMatch[2];
    const itemUrl = new URL(`/api/item/${itemKey}`, fixRequestUrl(request)).toString().replace("https://", "http://");

    try {
      const response = await fetch(itemUrl);
      
      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch item: ${response.statusText}` }, 
          { status: response.status }
        );
      }
      
      let item: ItemGetResponse;
      try {
        item = await response.json();
      } catch (jsonError) {
        console.error("Error parsing JSON response:", jsonError);
        return NextResponse.json(
          { error: "Failed to parse item data" }, 
          { status: 500 }
        );
      }
      
      if (!item.item) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      if (!item.item.attachmentsData) {
        return NextResponse.json({ error: "Item or attachments not found" }, { status: 404 });
      }
      const attachment = item.item.attachmentsData.find((attachment) => attachment.key === attachmentKey);
      if (!attachment || !attachment.url) {
        return NextResponse.json({ error: "Attachment URL not found" }, { status: 404 });
      }
      const finalURL = new URL(attachment.url, fixRequestUrl(request));
      return setRateLimitHeaders(NextResponse.rewrite(finalURL), rateLimit);
    } catch (fetchError) {
      console.error("Fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to retrieve item data" }, 
        { status: 500 }
      );
    }
  } else if (request.nextUrl.pathname === "/lib/atom.xml" || (request.nextUrl.pathname.startsWith("/profile/") && request.nextUrl.pathname.endsWith("/atom.xml"))) {
    const id = request.nextUrl.pathname.startsWith("/profile/") ? request.nextUrl.pathname.split("/")[2] : "main";
    const finalURL = new URL(`/api/feed/${id}`, fixRequestUrl(request));
    request.nextUrl.searchParams.forEach((value, key) => {
      finalURL.searchParams.set(key, value);
    });
    return setRateLimitHeaders(NextResponse.rewrite(finalURL), rateLimit);
  } else if (request.nextUrl.pathname.startsWith("/api/")) {
    if (request.nextUrl.pathname.startsWith("/api/ai") && !request.nextUrl.pathname.includes("embeddings")) {
      if (rateLimit) {
        const timeSinceFirstRequest = Date.now() - rateLimit.firstRequest;

        if (timeSinceFirstRequest < RESET_TIME) {
          rateLimit.count++;
        } else {
          rateLimit.count = 1;
          rateLimit.firstRequest = Date.now();
        }

        if (rateLimit.count >= AMOUNT_OF_REQUESTS) {
          return NextResponse.json({ error: "Rate limit exceeded" }, { status: 403 });
        }
 
        return setRateLimitHeaders(NextResponse.next(), rateLimit);
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    return setRateLimitHeaders(NextResponse.next(), rateLimit);
  }
  
  const response = createMiddleware(routing)(request);

  return setRateLimitHeaders(response, rateLimit);
}
 
export const config = {
  // Matcher entries are linked with a logical "or", therefore
  // if one of them matches, the middleware will be invoked.
  matcher: [
    // Match all pathnames except for
    // - … if they start with `/api`, `/_next`, `/_vercel`, or `/ingest`
    // - … the ones containing a dot (e.g. `favicon.ico`)
    '/((?!_next|_vercel|ingest|sentry-example-page|monitoring|.*\\..*).*)',
    // Updated matchers for new export URL format
    '/([\\w-]+)?/lib/:path*/export/ris',
    '/([\\w-]+)?/lib/:path*/export/bibtex',
    '/([\\w-]+)?/lib/:path*/download/:path*',
    '/([\\w-]+)?/lib/atom.xml',
    '/([\\w-]+)?/profile/:id/atom.xml'
  ]
};
