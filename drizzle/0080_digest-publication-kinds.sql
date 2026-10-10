CREATE TABLE "notificationItemKind" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"readAt" timestamp with time zone DEFAULT now() NOT NULL
);
