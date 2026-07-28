-- 0040_seed_acer_gpsr.sql
-- GPSR compliance block for the Acer supplier (provided by Acer, 2026-07-28).
-- Supplier-level constants, inherited by every Acer product (docs/tiktok-readiness-spec.md §2.2).
-- Ragequit is the distributor; the EU Responsible Person is Acer's EU importer, Acer Italy S.R.L.
-- manufacturer_email + default_country_of_origin left NULL (not supplied by Acer yet).
UPDATE suppliers SET
  manufacturer_name    = 'Acer Inc.',
  manufacturer_address = '1F, 88, Sec. 1, Xintai 5th Rd., Xizhi, New Taipei City 22, Taiwan',
  eu_rp_name           = 'Acer Italy S.R.L.',
  eu_rp_address        = 'Via delle Industrie, 1/A - 20044 Arese (MI) - Italy',
  eu_rp_email          = 'acer-italy-srl@legalmail.it'
WHERE id = 'acer';
