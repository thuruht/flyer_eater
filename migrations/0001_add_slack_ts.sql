ALTER TABLE events ADD COLUMN slack_ts TEXT;
CREATE INDEX idx_events_slack_ts ON events(slack_ts);
