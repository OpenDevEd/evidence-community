'use client';

import { useEffect, useMemo } from 'react';
import { useQueryStates, parseAsString } from 'nuqs';
import { useLocalStorage } from 'usehooks-ts';
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { registerAnalyticsAttribution } from "@/lib/analytics";

type UTM = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

export type StoredUtm = {
  utm: UTM;
  startedAt: number; // epoch ms when stored
  expiresAt: number; // epoch ms when it should expire
  // Optional:
  // landingPage?: string;
  // referrer?: string | null;
};

export const UTM_KEYS: (keyof UTM)[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

export const STORAGE_KEY = 'utm:active';

/**
 * Parse NEXT_PUBLIC_UTM_DURATION into milliseconds.
 * Supports:
 * - "30d", "12h", "45m", "300s", "1500ms"
 * - Plain number -> treated as seconds (e.g., "3600" = 1 hour)
 * Default: 30 days.
 */
function getDurationMs(): number {
  const raw = (process.env.NEXT_PUBLIC_UTM_DURATION || '').trim();
  const DEFAULT_MS = 30 * 24 * 60 * 60 * 1000; // 30d

  if (!raw) return DEFAULT_MS;

  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(raw);
  if (!m) return DEFAULT_MS;

  const amount = parseFloat(m[1]);
  const unit = (m[2] || 's').toLowerCase(); // default to seconds if unit omitted

  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_MS;

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return DEFAULT_MS;
  }
}

function normalize(v?: string | null): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t ? t.toLowerCase().slice(0, 100) : undefined;
}

function collectValidUtms(obj: Record<string, unknown>): UTM {
  const out: UTM = {};
  for (const k of UTM_KEYS) {
    const val = normalize(obj[k] as string | undefined);
    if (val) out[k] = val;
  }
  // Require at least source + medium to treat as a valid set
  if (!out.utm_source || !out.utm_medium) return {};
  return out;
}

function isEmptyUTM(u: UTM | null | undefined): boolean {
  if (!u) return true;
  return UTM_KEYS.every((k) => !u[k]);
}

function utmEquals(a: UTM, b: UTM): boolean {
  for (const k of UTM_KEYS) {
    if ((a[k] || undefined) !== (b[k] || undefined)) return false;
  }
  return true;
}



export function UtmAttributionProvider() {
  const { analyticsReady, consentState } = useAnalyticsConsent();
  // Live UTMs from the URL (reactive)
  const [utmFromUrl] = useQueryStates({
    utm_source: parseAsString,
    utm_medium: parseAsString,
    utm_campaign: parseAsString,
    utm_term: parseAsString,
    utm_content: parseAsString,
  });

  // LocalStorage for the active UTMs with expiry
  const [stored, setStored] = useLocalStorage<StoredUtm | null>(
    STORAGE_KEY,
    null
  );

  const durationMs = useMemo(() => getDurationMs(), []);

  useEffect(() => {
    if (consentState !== "granted") {
      if (stored) {
        setStored(null);
      }
      return;
    }

    const now = Date.now();

    // Build candidate from URL
    const candidate = collectValidUtms(utmFromUrl);
    if (isEmptyUTM(candidate)) {
      // No UTMs in the URL; do nothing
      return;
    }

    const isExpired = !stored || stored.expiresAt <= now;

    if (isExpired) {
      // New session or expired -> set fresh
      setStored({
        utm: candidate,
        startedAt: now,
        expiresAt: now + durationMs,
      });
      return;
    }

    if (utmEquals(stored.utm, candidate)) {
      // Same UTMs appeared again -> renew TTL (keep original startedAt)
      setStored({
        ...stored,
        expiresAt: now + durationMs,
      });
      return;
    }

    // Different UTMs -> overwrite and start a new window
    setStored({
      utm: candidate,
      startedAt: now,
      expiresAt: now + durationMs,
    });
  }, [consentState, durationMs, setStored, stored, utmFromUrl]);

  useEffect(() => {
    if (consentState !== "granted" || !analyticsReady || !stored) return;
    registerAnalyticsAttribution(stored.utm);
  }, [analyticsReady, consentState, stored]);

  return null;
}
