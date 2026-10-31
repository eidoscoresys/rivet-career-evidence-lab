-- RIVET v2.0.0 schema-only bootstrap for a NEW, EMPTY local/development database.
-- Contains no credentials, user inputs, run history, event rows, or sequence state.
-- Do not run against an existing database or Replit managed production.
-- Replit managed production schema changes use the Publish flow, not this file.

BEGIN;

CREATE TABLE public.runs (
    id uuid PRIMARY KEY,
    owner text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    source text NOT NULL,
    input_url text,
    input_text text,
    skills text NOT NULL,
    status text NOT NULL,
    job_title text,
    result text,
    error text,
    ended_at timestamp with time zone,
    experience_text text,
    target_role text,
    CONSTRAINT runs_status_check
        CHECK (status IN ('running', 'awaiting_review', 'completed', 'failed'))
);

CREATE TABLE public.events (
    id bigserial PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
    at timestamp with time zone NOT NULL,
    phase text NOT NULL,
    status text NOT NULL,
    message text NOT NULL,
    detail text,
    duration_ms integer,
    CONSTRAINT events_status_check
        CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    CONSTRAINT events_duration_ms_check
        CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX idx_runs_owner ON public.runs (owner, created_at);
CREATE INDEX idx_events_run ON public.events (run_id, id);

COMMIT;
