-- An edition written by hand for a past period emails nobody. Until now that held because each subscriber got a
-- skipped delivery when it was prepared; an edition that waits for an editor can be published after new readers join,
-- so the edition itself says so. Editions already there are published or were prepared the old way, and stay unmarked.
ALTER TABLE "notificationEdition" ADD COLUMN "silent" boolean DEFAULT false NOT NULL;