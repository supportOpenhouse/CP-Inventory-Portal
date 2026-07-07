-- submitted_by_name: staff/sales actor for on-behalf submissions (admin UI badge).
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;
