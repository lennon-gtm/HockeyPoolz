-- Backfill existing league members with their user's favorite NHL team
UPDATE league_members lm
SET favorite_nhl_team_id = u.favorite_nhl_team_id
FROM users u
WHERE lm.user_id = u.id AND u.favorite_nhl_team_id IS NOT NULL;
