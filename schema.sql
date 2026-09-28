


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "audit_type" "text",
    "criticality" "text",
    "last_audit_date" "date",
    "audit_frequency_months" integer DEFAULT 12 NOT NULL,
    "last_risk_analysis_date" "date",
    "risk_analysis_frequency_months" integer DEFAULT 12 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "applications_audit_type_check" CHECK (("audit_type" = ANY (ARRAY['pentest'::"text", 'configuration'::"text", 'architecture'::"text", 'gouvernance'::"text"]))),
    CONSTRAINT "applications_criticality_check" CHECK (("criticality" = ANY (ARRAY['mineure'::"text", 'majeure'::"text", 'critique'::"text"])))
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."elearning_modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "target_audience" "text" DEFAULT 'Tous'::"text",
    "format_type" "text" DEFAULT 'E-Learning'::"text",
    "total_assigned" integer DEFAULT 0,
    "completed_count" integer DEFAULT 0,
    "completed_by" "text"[] DEFAULT '{}'::"text"[],
    "start_date" "date",
    "deadline" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."elearning_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_definitions" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "threshold_warning" numeric,
    "threshold_danger" numeric,
    "target" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kpi_definitions_category_check" CHECK (("category" = ANY (ARRAY['messagerie'::"text", 'gouvernance'::"text", 'sensibilisation'::"text", 'risques'::"text", 'continuite'::"text"]))),
    CONSTRAINT "kpi_definitions_unit_check" CHECK (("unit" = ANY (ARRAY['nombre'::"text", 'pourcentage'::"text", 'taux'::"text"])))
);


ALTER TABLE "public"."kpi_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_entries" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "kpi_id" "text" NOT NULL,
    "value" numeric NOT NULL,
    "period" "text" NOT NULL,
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_label" "text",
    "source_file_name" "text",
    "source_file_path" "text",
    "source_embed_url" "text",
    "source_api_endpoint" "text",
    "aggregation" "text",
    "selected_column" "text",
    "selected_sheet" "text",
    "raw_data" "jsonb",
    "detail_rows" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kpi_entries_aggregation_check" CHECK (("aggregation" = ANY (ARRAY['sum'::"text", 'average'::"text", 'count'::"text", 'max'::"text", 'min'::"text", 'last'::"text"]))),
    CONSTRAINT "kpi_entries_source_type_check" CHECK (("source_type" = ANY (ARRAY['manual'::"text", 'excel'::"text", 'csv'::"text", 'powerbi'::"text", 'api'::"text", 'sharepoint'::"text"])))
);


ALTER TABLE "public"."kpi_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phishing_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "send_date" timestamp with time zone NOT NULL,
    "difficulty" "text",
    "target_count" integer DEFAULT 0,
    "opened_count" integer DEFAULT 0,
    "attachment_opened_count" integer DEFAULT 0,
    "clicked_count" integer DEFAULT 0,
    "compromised_count" integer DEFAULT 0,
    "training_completed_count" integer DEFAULT 0,
    "reported_count" integer DEFAULT 0,
    "recidivists_count" integer DEFAULT 0,
    "notes" "text",
    "failed_emails" "text"[] DEFAULT '{}'::"text"[],
    "detailed_results" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "phishing_campaigns_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['facile'::"text", 'moyen'::"text", 'difficile'::"text"])))
);


ALTER TABLE "public"."phishing_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phishing_profiles" (
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "department" "text",
    "total_campaigns" integer DEFAULT 0,
    "opened_count" integer DEFAULT 0,
    "attachment_opened_count" integer DEFAULT 0,
    "clicked_count" integer DEFAULT 0,
    "compromised_count" integer DEFAULT 0,
    "training_completed_count" integer DEFAULT 0,
    "reported_count" integer DEFAULT 0,
    "risk_score" numeric DEFAULT 0,
    "last_campaign_clicked" boolean DEFAULT false,
    "is_consecutive" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."phishing_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text",
    "owner" "text",
    "last_review_date" timestamp with time zone,
    "review_frequency_months" integer DEFAULT 12 NOT NULL,
    "compliance_score" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."policy_gaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."policy_gaps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "manager" "text" NOT NULL,
    "risk_level" "text",
    "go_live_date" "date" NOT NULL,
    "pas_status" "text",
    "request_date" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "projects_pas_status_check" CHECK (("pas_status" = ANY (ARRAY['draft'::"text", 'review'::"text", 'validated'::"text"]))),
    CONSTRAINT "projects_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['faible'::"text", 'moyen'::"text", 'fort'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risk_dashboards" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "datasets" "jsonb" DEFAULT '[]'::"jsonb",
    "measures" "jsonb" DEFAULT '[]'::"jsonb",
    "widgets" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "tabs" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."risk_dashboards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "role" "text" DEFAULT 'saisisseur'::"text",
    "first_name" "text",
    "last_name" "text",
    "initials" character varying(3),
    "title" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vulnerabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "cve" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "severity" "text",
    "status" "text" DEFAULT 'ouvert'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vulnerabilities_severity_check" CHECK (("severity" = ANY (ARRAY['faible'::"text", 'moyen'::"text", 'eleve'::"text", 'critique'::"text"]))),
    CONSTRAINT "vulnerabilities_status_check" CHECK (("status" = ANY (ARRAY['ouvert'::"text", 'resolu'::"text"])))
);


ALTER TABLE "public"."vulnerabilities" OWNER TO "postgres";


ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."elearning_modules"
    ADD CONSTRAINT "elearning_modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_definitions"
    ADD CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_entries"
    ADD CONSTRAINT "kpi_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phishing_campaigns"
    ADD CONSTRAINT "phishing_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phishing_profiles"
    ADD CONSTRAINT "phishing_profiles_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."policies"
    ADD CONSTRAINT "policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."policy_gaps"
    ADD CONSTRAINT "policy_gaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risk_dashboards"
    ADD CONSTRAINT "risk_dashboards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vulnerabilities"
    ADD CONSTRAINT "vulnerabilities_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_kpi_entries_kpi_id" ON "public"."kpi_entries" USING "btree" ("kpi_id");



CREATE INDEX "idx_kpi_entries_period" ON "public"."kpi_entries" USING "btree" ("period");



CREATE OR REPLACE TRIGGER "update_applications_updated_at" BEFORE UPDATE ON "public"."applications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_elearning_modules_updated_at" BEFORE UPDATE ON "public"."elearning_modules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_kpi_definitions_updated_at" BEFORE UPDATE ON "public"."kpi_definitions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_kpi_entries_updated_at" BEFORE UPDATE ON "public"."kpi_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_phishing_campaigns_updated_at" BEFORE UPDATE ON "public"."phishing_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_phishing_profiles_updated_at" BEFORE UPDATE ON "public"."phishing_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_policies_updated_at" BEFORE UPDATE ON "public"."policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_policy_gaps_updated_at" BEFORE UPDATE ON "public"."policy_gaps" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vulnerabilities_updated_at" BEFORE UPDATE ON "public"."vulnerabilities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."kpi_entries"
    ADD CONSTRAINT "kpi_entries_kpi_id_fkey" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."policy_gaps"
    ADD CONSTRAINT "policy_gaps_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vulnerabilities"
    ADD CONSTRAINT "vulnerabilities_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



CREATE POLICY "Activer l'insertion pour tous" ON "public"."risk_dashboards" FOR INSERT WITH CHECK (true);



CREATE POLICY "Activer la lecture pour tous" ON "public"."risk_dashboards" FOR SELECT USING (true);



CREATE POLICY "Activer la mise à jour pour tous" ON "public"."risk_dashboards" FOR UPDATE USING (true);



CREATE POLICY "Activer la suppression pour tous" ON "public"."risk_dashboards" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete KPI entries" ON "public"."kpi_entries" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete applications" ON "public"."applications" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete policies" ON "public"."policies" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete policy_gaps" ON "public"."policy_gaps" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete projects" ON "public"."projects" FOR DELETE USING (true);



CREATE POLICY "Anyone can delete vulnerabilities" ON "public"."vulnerabilities" FOR DELETE USING (true);



CREATE POLICY "Anyone can insert KPI definitions" ON "public"."kpi_definitions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert KPI entries" ON "public"."kpi_entries" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert applications" ON "public"."applications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert policies" ON "public"."policies" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert policy gaps" ON "public"."policy_gaps" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert projects" ON "public"."projects" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can insert vulnerabilities" ON "public"."vulnerabilities" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can update KPI definitions" ON "public"."kpi_definitions" FOR UPDATE USING (true);



CREATE POLICY "Anyone can update KPI entries" ON "public"."kpi_entries" FOR UPDATE USING (true);



CREATE POLICY "Anyone can update applications" ON "public"."applications" FOR UPDATE USING (true);



CREATE POLICY "Anyone can update projects" ON "public"."projects" FOR UPDATE USING (true);



CREATE POLICY "Anyone can update vulnerabilities" ON "public"."vulnerabilities" FOR UPDATE USING (true);



CREATE POLICY "Anyone can view applications" ON "public"."applications" FOR SELECT USING (true);



CREATE POLICY "Anyone can view projects" ON "public"."projects" FOR SELECT USING (true);



CREATE POLICY "Anyone can view vulnerabilities" ON "public"."vulnerabilities" FOR SELECT USING (true);



CREATE POLICY "Enable delete for all users" ON "public"."elearning_modules" FOR DELETE USING (true);



CREATE POLICY "Enable insert for all users" ON "public"."elearning_modules" FOR INSERT WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."elearning_modules" FOR SELECT USING (true);



CREATE POLICY "Enable update for all users" ON "public"."elearning_modules" FOR UPDATE USING (true);



CREATE POLICY "KPI definitions are viewable by everyone" ON "public"."kpi_definitions" FOR SELECT USING (true);



CREATE POLICY "KPI entries are viewable by everyone" ON "public"."kpi_entries" FOR SELECT USING (true);



CREATE POLICY "Les utilisateurs peuvent modifier leur profil" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Les utilisateurs peuvent voir leur profil" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Permettre l'insertion du profil" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Policies are viewable by everyone" ON "public"."policies" FOR SELECT USING (true);



CREATE POLICY "Policy gaps are viewable by everyone" ON "public"."policy_gaps" FOR SELECT USING (true);



CREATE POLICY "Public applications access" ON "public"."applications" USING (true);



CREATE POLICY "Public campaigns access" ON "public"."phishing_campaigns" USING (true) WITH CHECK (true);



CREATE POLICY "Public delete on elearning_modules" ON "public"."elearning_modules" FOR DELETE USING (true);



CREATE POLICY "Public delete on phishing_campaigns" ON "public"."phishing_campaigns" FOR DELETE USING (true);



CREATE POLICY "Public insert on elearning_modules" ON "public"."elearning_modules" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public insert on phishing_campaigns" ON "public"."phishing_campaigns" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public phishing access" ON "public"."phishing_campaigns" USING (true);



CREATE POLICY "Public policies access" ON "public"."policies" USING (true);



CREATE POLICY "Public policy gaps access" ON "public"."policy_gaps" USING (true);



CREATE POLICY "Public profiles access" ON "public"."phishing_profiles" USING (true) WITH CHECK (true);



CREATE POLICY "Public projects access" ON "public"."projects" USING (true);



CREATE POLICY "Public select on elearning_modules" ON "public"."elearning_modules" FOR SELECT USING (true);



CREATE POLICY "Public select on phishing_campaigns" ON "public"."phishing_campaigns" FOR SELECT USING (true);



CREATE POLICY "Public select on phishing_profiles" ON "public"."phishing_profiles" FOR SELECT USING (true);



CREATE POLICY "Public update on elearning_modules" ON "public"."elearning_modules" FOR UPDATE USING (true);



CREATE POLICY "Public update on phishing_campaigns" ON "public"."phishing_campaigns" FOR UPDATE USING (true);



CREATE POLICY "Public update on phishing_profiles" ON "public"."phishing_profiles" FOR UPDATE USING (true);



CREATE POLICY "Public upsert on phishing_profiles" ON "public"."phishing_profiles" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public vulns access" ON "public"."vulnerabilities" USING (true);



ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."elearning_modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phishing_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phishing_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policy_gaps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risk_dashboards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vulnerabilities" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."elearning_modules" TO "anon";
GRANT ALL ON TABLE "public"."elearning_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."elearning_modules" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_definitions" TO "anon";
GRANT ALL ON TABLE "public"."kpi_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_entries" TO "anon";
GRANT ALL ON TABLE "public"."kpi_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_entries" TO "service_role";



GRANT ALL ON TABLE "public"."phishing_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."phishing_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."phishing_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."phishing_profiles" TO "anon";
GRANT ALL ON TABLE "public"."phishing_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."phishing_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."policies" TO "anon";
GRANT ALL ON TABLE "public"."policies" TO "authenticated";
GRANT ALL ON TABLE "public"."policies" TO "service_role";



GRANT ALL ON TABLE "public"."policy_gaps" TO "anon";
GRANT ALL ON TABLE "public"."policy_gaps" TO "authenticated";
GRANT ALL ON TABLE "public"."policy_gaps" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."risk_dashboards" TO "anon";
GRANT ALL ON TABLE "public"."risk_dashboards" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_dashboards" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vulnerabilities" TO "anon";
GRANT ALL ON TABLE "public"."vulnerabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."vulnerabilities" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































