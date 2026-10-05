-- Deploy encounter-worker and the authenticated v11 coordinator first.
-- The durable table is authoritative; pg_net's transient queue is recoverable.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
update ehr.encounter_dispatch_config set enabled=true,endpoint='https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/encounter-worker' where singleton;
select cron.schedule('synthetic-encounter-orchestrator-v11','10 seconds','select ehr.dispatch_encounter_jobs()');
