-- Activate after exact tested worker deployment. No device is enrolled by this schedule.
update ehr.push_alert_config set enabled=true,endpoint='https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/push-alert-worker' where singleton;
select cron.schedule('synthetic-push-alerts-v17','* * * * *','select ehr.dispatch_push_alerts()');
