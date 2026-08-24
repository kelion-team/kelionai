BEGIN;

-- The historical table mixed images, videos and Google Photos bytes without
-- an owner.  Keep those legacy rows quarantined (and immediately expired)
-- rather than guessing ownership; every new row is account-bound.
ALTER TABLE generated_images RENAME TO generated_media;

ALTER TABLE generated_media
  ADD COLUMN owner_email TEXT,
  ADD COLUMN kind TEXT,
  ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE generated_media
   SET owner_email = 'legacy-quarantine@invalid.local',
       kind = CASE WHEN mime LIKE 'video/%' THEN 'video' ELSE 'image' END,
       expires_at = now()
 WHERE owner_email IS NULL OR kind IS NULL OR expires_at IS NULL;

ALTER TABLE generated_media
  ALTER COLUMN owner_email SET NOT NULL,
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE generated_media
  ADD CONSTRAINT generated_media_kind_check
    CHECK (kind IN ('image', 'video')),
  ADD CONSTRAINT generated_media_mime_check
    CHECK (
      (kind = 'image' AND mime IN ('image/png', 'image/jpeg', 'image/webp'))
      OR (kind = 'video' AND mime = 'video/mp4')
    );

CREATE INDEX generated_media_owner_created_idx
  ON generated_media (lower(owner_email), created_at DESC);
CREATE INDEX generated_media_expiry_idx
  ON generated_media (expires_at);

COMMIT;
