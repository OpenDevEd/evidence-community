# Clerk Authentication Implementation

Source: `codex/0.8.0` branch. This document captures the exact implementation so it
can be reproduced on any branch.

---

## 1. Dependencies

```
"@clerk/nextjs": "^7.0.1"
"swr": "^2.4.1"
```

Removed (from NextAuth era):

```
"next-auth"
"@auth/drizzle-adapter"
"bcrypt"
```

## 2. Environment Variables

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

---

## 3. New Files

### `src/auth/server.ts`

Server-side bridge between Clerk and the local Postgres user table.
Uses `auth()` and `currentUser()` from `@clerk/nextjs/server`.

```ts
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { accounts, users } from "@/db/schema/tables/user";

type LocalUser = typeof users.$inferSelect;

function buildName(
  firstName: string | null,
  lastName: string | null,
  username: string | null,
) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName.length > 0) {
    return fullName;
  }
  return username ?? null;
}

function getPrimaryEmailAddress(
  clerkUser: Awaited<ReturnType<typeof currentUser>>,
) {
  if (!clerkUser) {
    return null;
  }

  const primaryEmailId = clerkUser.primaryEmailAddressId;
  if (primaryEmailId) {
    const primary = clerkUser.emailAddresses.find(
      (email) => email.id === primaryEmailId,
    );
    if (primary?.emailAddress) {
      return primary.emailAddress;
    }
  }

  return clerkUser.emailAddresses[0]?.emailAddress ?? null;
}

async function findUserByClerkAccount(clerkUserId: string) {
  const db = await getDatabase();
  const account = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.provider, "clerk"),
      eq(accounts.providerAccountId, clerkUserId),
    ),
  });

  if (!account) {
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, account.userId),
  });
  return user ?? null;
}

async function findUserByEmail(email: string) {
  const db = await getDatabase();
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  return user ?? null;
}

async function createLocalUserFromClerk(email: string) {
  const db = await getDatabase();
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return null;
  }

  const name = buildName(
    clerkUser.firstName,
    clerkUser.lastName,
    clerkUser.username,
  );
  try {
    const [createdUser] = await db
      .insert(users)
      .values({
        email,
        name,
        image: clerkUser.imageUrl,
      })
      .returning();

    return createdUser ?? null;
  } catch {
    // Handle concurrent sign-ins racing on unique email.
    return findUserByEmail(email);
  }
}

async function ensureClerkAccountLink(userId: string, clerkUserId: string) {
  const db = await getDatabase();
  await db
    .insert(accounts)
    .values({
      userId,
      type: "oauth",
      provider: "clerk",
      providerAccountId: clerkUserId,
    })
    .onConflictDoNothing();
}

export async function getAuthenticatedDbUser(): Promise<LocalUser | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return null;
  }

  const linkedUser = await findUserByClerkAccount(clerkUserId);
  if (linkedUser) {
    return linkedUser;
  }

  const clerkUser = await currentUser();
  const email = getPrimaryEmailAddress(clerkUser);
  if (!email) {
    return null;
  }

  let localUser = await findUserByEmail(email);
  if (!localUser) {
    localUser = await createLocalUserFromClerk(email);
  }

  if (!localUser) {
    return null;
  }

  await ensureClerkAccountLink(localUser.id, clerkUserId);
  return localUser;
}
```

### `src/auth/client.ts`

Client-side session hook. Fetches `/api/auth/session` via SWR only when Clerk
reports a signed-in user.

```ts
"use client";

import { useUser } from "@clerk/nextjs";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import type { AppSession, SessionStatus } from "@/auth/types";

export function useSession() {
  const { isLoaded, isSignedIn } = useUser();
  const shouldFetchSession = isLoaded && isSignedIn;

  const { data, isLoading, error, mutate } = useSWR<AppSession | null>(
    shouldFetchSession ? "/auth/session" : null,
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  let status: SessionStatus = "unauthenticated";
  if (!isLoaded || (shouldFetchSession && isLoading && data === undefined)) {
    status = "loading";
  } else if (shouldFetchSession && data) {
    status = "authenticated";
  } else if (shouldFetchSession && error) {
    status = "unauthenticated";
    console.error("Session fetch failed:", error);
  }

  const update = async () => {
    if (!shouldFetchSession) {
      return null;
    }
    const next = await mutate();
    return next ?? null;
  };

  return {
    data: shouldFetchSession ? (data ?? null) : null,
    status,
    update,
  };
}
```

### `src/auth/types.ts`

```ts
export type SessionDateValue = string | Date;

export type AppCollection = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  private: boolean | null;
  numItems: number | null;
  deleted: boolean | null;
  createdAt: SessionDateValue;
  updatedAt: SessionDateValue;
};

export type AppSessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  createdAt?: SessionDateValue;
  likes: Record<string, SessionDateValue>;
  following: Record<string, SessionDateValue>;
  followers: Record<string, SessionDateValue>;
  collections: AppCollection[];
  itemsCollections: Record<string, Record<string, SessionDateValue>>;
};

export type AppSession = {
  user: AppSessionUser;
};

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";
```

### `src/app/api/auth/session/route.ts`

Replaces NextAuth's session callback. Returns the full user profile or `null`
(always 200).

```ts
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { getAuthenticatedDbUser } from "@/auth/server";
import { getProfile } from "@/lib/actions";
import type { AppSession } from "@/auth/types";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  noStore();

  const dbUser = await getAuthenticatedDbUser();
  if (!dbUser) {
    return NextResponse.json(null, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  }

  const userProfile = await getProfile(dbUser.id, null);
  if (!userProfile) {
    return NextResponse.json(null, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  }

  const session: AppSession = {
    user: userProfile,
  };

  return NextResponse.json(session, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
```

### `src/app/api/user/collections/schema.ts`

Extracted from the collections route (was inline with NextAuth).

```ts
import { z } from "zod";

export const collectionFieldsSchema = z.object({
  name: z.string().min(1).max(24),
  description: z.string().min(0).max(200).optional(),
});

export const createCollectionSchema = collectionFieldsSchema.extend({
  private: z.boolean(),
});
```

---

## 4. SWR Fetcher Dependency

`useSession` relies on the `fetcher` export from `src/lib/utils.ts`.
It prepends `/api` to the path:

```ts
export const fetcher = (url: string) =>
  fetch(`/api${url}`).then((res) => res.json());
```

The SWR key `/auth/session` becomes a fetch to `/api/auth/session`.

---

## 5. Deleted Files

```
src/app/api/auth/[...nextauth]/config.ts   (NextAuth config, providers, DrizzleAdapter)
src/app/api/auth/[...nextauth]/route.ts     (NextAuth route handler)
src/lib/auth.ts                             (had authenticate() wrapper)
```

---

## 6. Layout Changes

### `src/components/layout/Base.tsx`

Wrap the app in `<ClerkProvider>` inside a `<Suspense>`.
`SessionProvider` from next-auth is removed.

```tsx
import { ClerkProvider } from "@clerk/nextjs";
import { Suspense } from "react";

// In the render:
<body>
  <Suspense fallback={null}>
    <ClerkProvider>
      <BaseContent locale={locale}>{children}</BaseContent>
    </ClerkProvider>
  </Suspense>
</body>
```

### `src/context/Providers.tsx`

No auth-related providers. `SessionProvider` was removed entirely.
The tree is: `ThemeProvider > NuqsAdapter > ToastAdapter > AnalyticsConsentProvider > FeatureFlagsContext > CacheProvider > HeroUIProvider`.

---

## 7. Middleware (`src/proxy.ts`)

Wrap the existing `handleProxy` in `clerkMiddleware`. Auth is only resolved for
routes that need it.

```ts
import { clerkMiddleware } from "@clerk/nextjs/server";

function shouldResolveAuth(pathname: string) {
  return isAiRateLimitedPath(pathname) || isProtectedApiPath(pathname);
}

function isProtectedApiPath(pathname: string) {
  return (
    pathname === "/api/like" ||
    pathname === "/api/auth/session" ||
    pathname.startsWith("/api/user")
  );
}

// Export:
export default clerkMiddleware(async (auth, request) => {
  const userId = shouldResolveAuth(request.nextUrl.pathname)
    ? (await auth()).userId
    : null;
  return handleProxy(request, userId);
});
```

Public library pages strip Clerk headers for cacheability:

```ts
if (isPublicItemPagePath(pathname)) {
  response.headers.delete("x-clerk-auth-reason");
  response.headers.delete("x-clerk-auth-status");
}
```

---

## 8. Navbar Components

### `src/components/layout/navbar/useNavbarAuthState.ts`

Combines Clerk hooks (`useAuth`, `useUser`) with the custom SWR `useSession`.
Creates a temporary stub from Clerk data while the full session loads.

```ts
"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useSession } from "@/auth/client";
import type { AppSession } from "@/auth/types";

const PENDING_NAVBAR_SESSION = {
  user: {} as AppSession["user"],
} as AppSession;

function createSessionStub(
  user: ReturnType<typeof useUser>["user"],
): AppSession {
  return {
    user: {
      id: user?.id ?? "",
      name: user?.fullName ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      image: user?.imageUrl ?? null,
      likes: {},
      following: {},
      followers: {},
      collections: [],
      itemsCollections: {},
    },
  };
}

export function useNavbarAuthState() {
  const { data: session, status } = useSession();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const hasResolvedIdentity = Boolean(user || session?.user);
  const isAuthPending = !isLoaded || (isSignedIn && status === "loading");
  const signedInSession =
    status === "authenticated"
      ? session
      : isSignedIn && user
        ? createSessionStub(user)
        : null;

  const navbarSession =
    isLoaded && isSignedIn && status === "loading"
      ? PENDING_NAVBAR_SESSION
      : signedInSession;

  return {
    hasResolvedIdentity,
    isAuthPending,
    isLoaded,
    isSignedIn,
    navbarSession,
    profileHref: session?.user?.id
      ? `/profile/${session.user.id}`
      : "/profile",
    session,
    user,
  };
}
```

### `src/components/layout/navbar/LoginButton.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { IoIosLogIn } from "react-icons/io";
import { DropdownItem } from "@heroui/react";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/heroui/Button";
import { useFeatureFlagEnabled } from "@/context/Providers";
import type { NavbarElementProps } from "@/types/navbar";
import { useNavbarAuthState } from "./useNavbarAuthState";

export default function LoginButton({
  variant,
  styleVariant,
}: NavbarElementProps) {
  const t = useTranslations("ui");
  const isEnabled = useFeatureFlagEnabled("login");
  const { openSignIn } = useClerk();
  const { isLoaded, isSignedIn } = useNavbarAuthState();
  const openSignInSafely = () => {
    if (!isLoaded || isSignedIn) {
      return;
    }

    try {
      openSignIn();
    } catch (error: any) {
      const code = error?.errors?.[0]?.code;
      if (code !== "cannot_render_single_session_enabled") {
        throw error;
      }
    }
  };

  if (!isEnabled || !isLoaded || isSignedIn) return null;

  if (variant === "menuItem") {
    return (
      <DropdownItem
        key="login"
        onPress={() => {
          openSignInSafely();
        }}
        startContent={<IoIosLogIn className="size-5" />}
      >
        {t("login")}
      </DropdownItem>
    );
  }

  const isSmall = styleVariant === "small";

  return (
    <Button
      startContent={<IoIosLogIn className="size-5 shrink-0" />}
      onPress={() => {
        openSignInSafely();
      }}
      isIconOnly={isSmall}
      className={twMerge(
        "text-accent dark:text-accent py-1",
        isSmall ? "!p-0 rounded-full !size-10" : "uppercase",
      )}
      aria-label={t("loginButtonAriaLabel")}
    >
      {!isSmall && t("login")}
    </Button>
  );
}
```

### `src/components/layout/navbar/UserMenu.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { User, LogOut } from "lucide-react";
import {
  Avatar,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/react";
import { Dropdown } from "@/components/heroui/Dropdown";
import { useRouter } from "@/i18n/routing";
import type { NavbarElementProps } from "@/types/navbar";
import { useNavbarAuthState } from "./useNavbarAuthState";

export default function UserMenu({
  variant,
  styleVariant: _styleVariant,
}: NavbarElementProps) {
  const { signOut } = useClerk();
  const router = useRouter();
  const t = useTranslations("ui");
  const {
    hasResolvedIdentity,
    isAuthPending,
    isLoaded,
    isSignedIn,
    profileHref,
    session,
    user,
  } = useNavbarAuthState();

  if (isAuthPending) {
    return (
      <div
        aria-hidden="true"
        className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
      />
    );
  }

  if (!isLoaded || !isSignedIn) return null;

  const userName =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    session?.user?.name ||
    session?.user?.email ||
    t("genericUser");
  const userImage =
    user?.imageUrl ?? session?.user?.image ?? "/icons/profile.png";
  const handleAction = (key: React.Key) => {
    if (key === "logout") {
      void signOut();
    } else if (key === "profile") {
      router.push(profileHref);
    }
  };

  if (variant === "menuItem") {
    return (
      <>
        <DropdownItem
          key="profile"
          onPress={() => router.push(profileHref)}
          startContent={<User className="size-4" />}
        >
          {t("profileMenuItem")}
        </DropdownItem>
        <DropdownItem
          key="logout"
          color="danger"
          onPress={() => {
            void signOut();
          }}
          startContent={<LogOut className="size-4" />}
          className="text-danger"
        >
          {t("logout")}
        </DropdownItem>
      </>
    );
  }

  if (!hasResolvedIdentity) {
    return (
      <div
        aria-hidden="true"
        className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
      />
    );
  }

  return (
    <Dropdown>
      <DropdownTrigger>
        <Avatar
          as="button"
          className="size-10 cursor-pointer transition-transform"
          aria-label={t("actionsMenuAriaLabel")}
          src={userImage}
          alt={t("userAvatarAlt", { name: userName })}
        />
      </DropdownTrigger>
      <DropdownMenu
        onAction={handleAction}
        aria-label={t("actionsMenuAriaLabel")}
      >
        <DropdownItem
          key="profile"
          startContent={<User className="size-4" />}
        >
          {t("profileMenuItem")}
        </DropdownItem>
        <DropdownItem
          key="logout"
          color="danger"
          startContent={<LogOut className="size-4" />}
          className="text-danger"
        >
          {t("logout")}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}
```

### `src/components/layout/navbar/ActionsDropdown.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useClerk } from "@clerk/nextjs";
import { GiHamburgerMenu } from "react-icons/gi";
import {
  Avatar,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from "@heroui/react";
import { Dropdown } from "@/components/heroui/Dropdown";
import { Button } from "@/components/heroui/Button";
import { useSortedLocales } from "@/hooks/useSortedLocales";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useRouter, usePathname } from "@/i18n/routing";
import { IoIosLogIn } from "react-icons/io";
import { User, LogOut } from "lucide-react";
import ThemeSwitcher from "./ThemeSwitcher";
import LoginButton from "./LoginButton";
import LanguageSwitcher from "./LanguageSwitcher";
import type { NavbarContext } from "@/types/navbar";
import { HiOutlineMoon } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { useNavbarAuthState } from "./useNavbarAuthState";

interface ActionsDropdownProps {
  context: NavbarContext;
}

export default function ActionsDropdown({ context }: ActionsDropdownProps) {
  const t = useTranslations("ui");
  const { openSignIn, signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const { sortedLocales, localesNames } = useSortedLocales();
  const {
    hasResolvedIdentity,
    isLoaded,
    isSignedIn,
    navbarSession,
    profileHref,
    session,
    user,
  } = useNavbarAuthState();

  const isThemeEnabled = useFeatureFlagEnabled("theme-switcher");
  const isLanguageEnabled = useFeatureFlagEnabled("language-switcher");
  const isLoginEnabled = useFeatureFlagEnabled("login");
  const isDarkTheme = context.theme === "dark";
  const hasUser = Boolean(navbarSession);
  const hasUserActions = isLoaded && isSignedIn;
  const userName =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    session?.user?.name ||
    session?.user?.email ||
    t("genericUser");
  const userImage =
    user?.imageUrl ?? session?.user?.image ?? "/icons/profile.png";
  const themeTarget = isDarkTheme ? "light" : "dark";
  const themeLabel = t("switchThemeAriaLabel", {
    theme: t(themeTarget === "light" ? "lightTheme" : "darkTheme"),
  });

  const hasLanguages = isLanguageEnabled && sortedLocales.length > 0;
  const hasTheme = isThemeEnabled;
  const hasLogin = isLoginEnabled && !hasUser;

  const singleActionItems = (hasTheme ? 1 : 0) + (hasLogin ? 1 : 0);
  const totalItems =
    singleActionItems + (hasLanguages ? 1 : 0) + (hasUser ? 1 : 0);

  if (totalItems === 0) return null;

  if (totalItems === 1 && !hasUser) {
    if (hasTheme) {
      return (
        <ThemeSwitcher
          variant="inline"
          styleVariant={context.styleVariant}
        />
      );
    }
    if (hasLogin) {
      return (
        <LoginButton variant="inline" styleVariant={context.styleVariant} />
      );
    }
    if (hasLanguages) {
      return (
        <LanguageSwitcher
          variant="inline"
          styleVariant={context.styleVariant}
        />
      );
    }
  }

  const handleAction = (key: React.Key) => {
    const keyStr = String(key);

    if (sortedLocales.includes(keyStr)) {
      router.push(pathname, { locale: keyStr });
      return;
    }

    switch (keyStr) {
      case "login":
        if (!hasUser) {
          try {
            openSignIn();
          } catch (error: any) {
            const code = error?.errors?.[0]?.code;
            if (code !== "cannot_render_single_session_enabled") {
              throw error;
            }
          }
        }
        break;
      case "profile":
        router.push(profileHref);
        break;
      case "logout":
        void signOut();
        break;
    }
  };

  const trigger = hasUser ? (
    hasResolvedIdentity ? (
      <Avatar
        as="button"
        className="size-10 cursor-pointer"
        aria-label={t("actionsMenuAriaLabel")}
        src={userImage}
        alt={t("userAvatarAlt", { name: userName })}
      />
    ) : (
      <Button
        variant="invisible"
        disableRipple
        isIconOnly
        className="flex items-center justify-center !p-0 !size-10 rounded-full"
        aria-label={t("actionsMenuAriaLabel")}
      >
        <div
          aria-hidden="true"
          className="size-10 rounded-full animate-pulse bg-zinc-300/90 ring-1 ring-zinc-400/60 dark:bg-zinc-200/30 dark:ring-zinc-100/60"
        />
      </Button>
    )
  ) : (
    <Button
      variant="invisible"
      disableRipple
      isIconOnly
      className="flex items-center justify-center"
      aria-label={t("actionsMenuAriaLabel")}
    >
      <GiHamburgerMenu className="size-5 fill-accent" />
    </Button>
  );

  const menuSections = [];

  if (hasLanguages) {
    menuSections.push(
      <DropdownSection
        key="languages"
        showDivider={hasTheme || hasLogin || hasUser}
        classNames={{ base: "mb-0 mt-0" }}
      >
        {sortedLocales.map((locale) => (
          <DropdownItem key={locale}>
            {localesNames[locale as keyof typeof localesNames]}
          </DropdownItem>
        ))}
      </DropdownSection>,
    );
  }

  if (hasTheme || hasLogin) {
    const preferenceItems = [];

    if (hasTheme) {
      preferenceItems.push(
        <DropdownItem
          key="theme"
          onPress={() =>
            context.setTheme(isDarkTheme ? "light" : "dark")
          }
          startContent={
            isDarkTheme ? (
              <IoMdSunny className="size-5 fill-accent" />
            ) : (
              <HiOutlineMoon className="size-5 stroke-accent" />
            )
          }
        >
          {themeLabel}
        </DropdownItem>,
      );
    }

    if (hasLogin) {
      preferenceItems.push(
        <DropdownItem
          key="login"
          startContent={<IoIosLogIn className="size-5" />}
        >
          {t("login")}
        </DropdownItem>,
      );
    }

    menuSections.push(
      <DropdownSection
        key="preferences"
        showDivider={hasUser}
        className="my-1 mt-1.5"
      >
        {preferenceItems}
      </DropdownSection>,
    );
  }

  if (hasUserActions) {
    menuSections.push(
      <DropdownSection key="user" className="mb-0">
        <DropdownItem
          key="profile"
          startContent={<User className="size-4" />}
        >
          {t("profileMenuItem")}
        </DropdownItem>
        <DropdownItem
          key="logout"
          color="danger"
          startContent={<LogOut className="size-4" />}
          className="text-danger"
        >
          {t("logout")}
        </DropdownItem>
      </DropdownSection>,
    );
  }

  if (menuSections.length === 0) {
    return trigger;
  }

  return (
    <Dropdown>
      <DropdownTrigger>{trigger}</DropdownTrigger>
      <DropdownMenu
        aria-label={t("actionsMenuAriaLabel")}
        onAction={handleAction}
        className="p-1 gap-0"
        itemClasses={{
          title: "font-medium",
        }}
      >
        {menuSections}
      </DropdownMenu>
    </Dropdown>
  );
}
```

---

## 9. Protected API Route Pattern

Every protected route replaces `auth()` from NextAuth with `getAuthenticatedDbUser()`:

```ts
import { getAuthenticatedDbUser } from "@/auth/server";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedDbUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // use user.id instead of session.user.id
}
```

### Affected routes

| Route | Change |
|---|---|
| `src/app/api/like/route.ts` | `session` -> `user`, removed `and` import for `eq`-only usage |
| `src/app/api/user/collections/route.ts` | Extracted schema to `schema.ts`, `session.user` -> `user` |
| `src/app/api/user/collections/[id]/route.ts` | Added `PATCH` handler, `getAuthorizedCollection` helper, `session` -> `user` |
| `src/app/api/user/follows/route.ts` | `session.user` -> `user`, improved Zod error message |
| `src/app/api/user/item/[key]/route.ts` | `session.user` -> `user` |

---

## 10. Database Schema (Unchanged)

The schema in `src/db/schema/tables/user.ts` was **not modified**. Clerk reuses
the NextAuth `accounts` table with `provider = "clerk"`.

### Columns used by Clerk in `accounts`

| Column | Value |
|---|---|
| `userId` | Local user UUID |
| `type` | `"oauth"` |
| `provider` | `"clerk"` |
| `providerAccountId` | Clerk user ID |

### Legacy columns (always NULL for Clerk rows)

`refresh_token`, `access_token`, `expires_at`, `token_type`, `scope`,
`id_token`, `session_state`

### Legacy columns in `users`

| Column | Status |
|---|---|
| `password` | Unused. Was for NextAuth CredentialsProvider. |
| `emailVerified` | Unused. Clerk handles verification externally. |

### Dead tables

| Table | Status |
|---|---|
| `session` | Unused. Clerk manages its own sessions. |
| `verificationToken` | Unused. Clerk handles email verification. |
| `authenticator` | Unused. WebAuthn not implemented. |
