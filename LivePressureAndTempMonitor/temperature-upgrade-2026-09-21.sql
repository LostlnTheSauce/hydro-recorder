-- Run once on an existing Hydrotest website database before deploying the
-- matching temperature.php and host-page update.
ALTER TABLE temperature_sources
    ADD COLUMN sample_interval_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 2 AFTER active,
    ADD COLUMN whole_degrees TINYINT(1) NOT NULL DEFAULT 0 AFTER sample_interval_seconds;
