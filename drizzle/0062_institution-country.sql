CREATE TABLE "institutionCountry" (
	"nameKey" text PRIMARY KEY NOT NULL,
	"countryCode" varchar(2) NOT NULL,
	"openalexId" text,
	"city" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
