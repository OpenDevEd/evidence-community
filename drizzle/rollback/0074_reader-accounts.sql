-- Rollback for 0074_reader-accounts: recreate the old reader tables, empty,
-- beside the reader_* tables. Run it before starting a runtime older than this
-- migration. The reader_* tables and the readers saved on them stay, so rolling
-- forward again finds them intact.
CREATE TABLE IF NOT EXISTS public.account (
    "userId" text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);
CREATE TABLE IF NOT EXISTS public.authenticator (
    "credentialID" text NOT NULL,
    "userId" text NOT NULL,
    "providerAccountId" text NOT NULL,
    "credentialPublicKey" text NOT NULL,
    counter integer NOT NULL,
    "credentialDeviceType" text NOT NULL,
    "credentialBackedUp" boolean NOT NULL,
    transports text
);
CREATE TABLE IF NOT EXISTS public."itemToUserCollection" (
    id uuid DEFAULT gen_random_uuid(),
    "itemKey" character varying(8) NOT NULL,
    "userCollectionId" uuid NOT NULL,
    "userId" text NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.session (
    "sessionToken" text NOT NULL,
    "userId" text NOT NULL,
    expires timestamp without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public."user" (
    id text NOT NULL,
    name text,
    email text,
    "emailVerified" timestamp without time zone,
    image text,
    password text,
    description text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."userCollection" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" text NOT NULL,
    name character varying(255) NOT NULL,
    description character varying(255),
    private boolean DEFAULT false,
    "numItems" integer DEFAULT 0,
    deleted boolean DEFAULT false,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."userToFollow" (
    id uuid DEFAULT gen_random_uuid(),
    "userId" text NOT NULL,
    "followingId" text NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."userToLikes" (
    "userId" text NOT NULL,
    "itemKey" character varying(8) NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public."verificationToken" (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp without time zone NOT NULL
);
ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY (provider, "providerAccountId");
ALTER TABLE ONLY public.authenticator
    ADD CONSTRAINT "authenticator_credentialID_unique" UNIQUE ("credentialID");
ALTER TABLE ONLY public.authenticator
    ADD CONSTRAINT "authenticator_userId_credentialID_pk" PRIMARY KEY ("userId", "credentialID");
ALTER TABLE ONLY public."itemToUserCollection"
    ADD CONSTRAINT "itemToUserCollection_id_unique" UNIQUE (id);
ALTER TABLE ONLY public."itemToUserCollection"
    ADD CONSTRAINT "itemToUserCollection_itemKey_userCollectionId_userId_pk" PRIMARY KEY ("itemKey", "userCollectionId", "userId");
ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY ("sessionToken");
ALTER TABLE ONLY public."userCollection"
    ADD CONSTRAINT "userCollection_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."userToFollow"
    ADD CONSTRAINT "userToFollow_id_unique" UNIQUE (id);
ALTER TABLE ONLY public."userToFollow"
    ADD CONSTRAINT "userToFollow_userId_followingId_pk" PRIMARY KEY ("userId", "followingId");
ALTER TABLE ONLY public."userToLikes"
    ADD CONSTRAINT "userToLikes_userId_itemKey_pk" PRIMARY KEY ("userId", "itemKey");
ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);
ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public."verificationToken"
    ADD CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY (identifier, token);
CREATE INDEX "itemToUserCollection_collection_idx" ON public."itemToUserCollection" USING btree ("userCollectionId");
CREATE INDEX "itemToUserCollection_user_idx" ON public."itemToUserCollection" USING btree ("userId");
ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.authenticator
    ADD CONSTRAINT "authenticator_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."itemToUserCollection"
    ADD CONSTRAINT "itemToUserCollection_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES public.item(key) ON DELETE CASCADE;
ALTER TABLE ONLY public."itemToUserCollection"
    ADD CONSTRAINT "itemToUserCollection_userCollectionId_userCollection_id_fk" FOREIGN KEY ("userCollectionId") REFERENCES public."userCollection"(id);
ALTER TABLE ONLY public."itemToUserCollection"
    ADD CONSTRAINT "itemToUserCollection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id);
ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY public."userCollection"
    ADD CONSTRAINT "userCollection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id);
ALTER TABLE ONLY public."userToFollow"
    ADD CONSTRAINT "userToFollow_followingId_user_id_fk" FOREIGN KEY ("followingId") REFERENCES public."user"(id);
ALTER TABLE ONLY public."userToFollow"
    ADD CONSTRAINT "userToFollow_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id);
ALTER TABLE ONLY public."userToLikes"
    ADD CONSTRAINT "userToLikes_itemKey_item_key_fk" FOREIGN KEY ("itemKey") REFERENCES public.item(key) ON DELETE CASCADE;
ALTER TABLE ONLY public."userToLikes"
    ADD CONSTRAINT "userToLikes_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
