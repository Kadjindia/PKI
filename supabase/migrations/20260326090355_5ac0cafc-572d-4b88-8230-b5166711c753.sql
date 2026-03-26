
ALTER TABLE public.kpi_entries DROP CONSTRAINT kpi_entries_kpi_id_fkey;
ALTER TABLE public.kpi_definitions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.kpi_definitions ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE public.kpi_definitions ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.kpi_entries ALTER COLUMN kpi_id TYPE TEXT USING kpi_id::text;
ALTER TABLE public.kpi_entries ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.kpi_entries ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE public.kpi_entries ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.kpi_entries ADD CONSTRAINT kpi_entries_kpi_id_fkey FOREIGN KEY (kpi_id) REFERENCES public.kpi_definitions(id) ON DELETE CASCADE;
ALTER TABLE public.kpi_entries DROP CONSTRAINT IF EXISTS kpi_entries_kpi_id_period_source_type_source_file_name_key;
