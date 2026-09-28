-- Persist Auto Calling dictionary outcomes and their order snapshots.
ALTER TABLE voice_survey_settings
  ADD COLUMN IF NOT EXISTS response_dictionary TEXT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS survey_response_translation VARCHAR(255) NULL;
