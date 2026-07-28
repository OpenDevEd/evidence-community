"use client";

import { useEffect } from "react";
import { useQueryStates, parseAsString } from "nuqs";
import { useLocalStorage } from "usehooks-ts";
import { useAnalyticsConsent } from "@/components/features/analytics/AnalyticsConsentProvider";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

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
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
];

export const STORAGE_KEY = "utm:active";

function normalize(v?: string | null): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t ? t.toLowerCase() : undefined;
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
  const { consentState } = useAnalyticsConsent();
  const { analytics } = useLibraryConfig();
  // Live UTMs from the URL (reactive)
  const [utmFromUrl] = useQueryStates({
    utm_source: parseAsString,
    utm_medium: parseAsString,
    utm_campaign: parseAsString,
    utm_term: parseAsString,
    utm_content: parseAsString,
  });

  // LocalStorage for the active UTMs with expiry
  const [, setStored, removeStored] = useLocalStorage<StoredUtm | null>(
    STORAGE_KEY,
    null
  );

  const durationMs = analytics.utmDurationSeconds * 1000;

  useEffect(() => {
    if (consentState !== "granted") {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) !== null) {
          removeStored();
        }
      } catch (error) {
        console.warn("Unable to clear stored UTM attribution", error);
      }
      return;
    }

    // Build candidate from URL
    const candidate = collectValidUtms(utmFromUrl);
    if (isEmptyUTM(candidate)) {
      // No UTMs in the URL; do nothing
      return;
    }

    const now = Date.now();
    setStored((current) => {
      const isExpired = !current || current.expiresAt <= now;
      if (isExpired) {
        // New session or expired -> set fresh
        return {
          utm: candidate,
          startedAt: now,
          expiresAt: now + durationMs,
        };
      }

      if (utmEquals(current.utm, candidate)) {
        // Same UTMs appeared again -> renew TTL (keep original startedAt)
        return {
          ...current,
          expiresAt: now + durationMs,
        };
      }

      // Different UTMs -> overwrite and start a new window
      return {
        utm: candidate,
        startedAt: now,
        expiresAt: now + durationMs,
      };
    });
  }, [consentState, durationMs, removeStored, setStored, utmFromUrl]);

  return null;
}
