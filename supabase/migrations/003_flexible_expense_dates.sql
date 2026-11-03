-- Allow today's date and expenses outside the planned trip dates.
-- Native PostgreSQL date validation, NOT NULL, RLS and column grants remain.
begin;
alter table public.expenses drop constraint if exists expenses_expense_date_check;
commit;
