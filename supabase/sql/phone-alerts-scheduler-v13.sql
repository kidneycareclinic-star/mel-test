-- Activate only after the tested phone-alert-worker has been deployed.
-- Default clinician transport remains preview; this schedule cannot enable SMS consent.
update ehr.phone_alert_config set enabled=true,endpoint='https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/phone-alert-worker' where singleton;
select cron.schedule('synthetic-phone-alerts-v13','* * * * *','select ehr.dispatch_phone_alerts()');
