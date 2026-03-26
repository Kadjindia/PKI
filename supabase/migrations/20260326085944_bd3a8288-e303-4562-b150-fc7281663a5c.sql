
-- Create timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- KPI Definitions table
CREATE TABLE public.kpi_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('messagerie', 'gouvernance', 'sensibilisation', 'risques', 'continuite')),
  unit TEXT NOT NULL CHECK (unit IN ('nombre', 'pourcentage', 'taux')),
  description TEXT,
  icon TEXT,
  threshold_warning NUMERIC,
  threshold_danger NUMERIC,
  target NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "KPI definitions are viewable by everyone" ON public.kpi_definitions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert KPI definitions" ON public.kpi_definitions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update KPI definitions" ON public.kpi_definitions FOR UPDATE USING (true);

CREATE TRIGGER update_kpi_definitions_updated_at
  BEFORE UPDATE ON public.kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- KPI Entries table (values per period)
CREATE TABLE public.kpi_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kpi_id UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  period TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'excel', 'csv', 'powerbi', 'api', 'sharepoint')),
  source_label TEXT,
  source_file_name TEXT,
  source_file_path TEXT,
  source_embed_url TEXT,
  source_api_endpoint TEXT,
  aggregation TEXT CHECK (aggregation IN ('sum', 'average', 'count', 'max', 'min', 'last')),
  selected_column TEXT,
  selected_sheet TEXT,
  raw_data JSONB,
  detail_rows JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(kpi_id, period, source_type, source_file_name)
);

ALTER TABLE public.kpi_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "KPI entries are viewable by everyone" ON public.kpi_entries FOR SELECT USING (true);
CREATE POLICY "Anyone can insert KPI entries" ON public.kpi_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update KPI entries" ON public.kpi_entries FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete KPI entries" ON public.kpi_entries FOR DELETE USING (true);

CREATE TRIGGER update_kpi_entries_updated_at
  BEFORE UPDATE ON public.kpi_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_kpi_entries_kpi_id ON public.kpi_entries(kpi_id);
CREATE INDEX idx_kpi_entries_period ON public.kpi_entries(period);

-- Storage bucket for uploaded files
INSERT INTO storage.buckets (id, name, public) VALUES ('kpi-files', 'kpi-files', true);

CREATE POLICY "KPI files are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'kpi-files');
CREATE POLICY "Anyone can upload KPI files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'kpi-files');
CREATE POLICY "Anyone can delete KPI files" ON storage.objects FOR DELETE USING (bucket_id = 'kpi-files');
