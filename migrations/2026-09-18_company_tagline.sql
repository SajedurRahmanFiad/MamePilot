-- Add a first-class tagline column for the global company branding record.
CALL sp_add_col('company_settings', 'tagline', 'TEXT NULL');
