insert into public.profiles (user_id, username, tag, elo)
select
  users.id,
  coalesce(
    nullif(trim(users.raw_user_meta_data->>'username'), ''),
    nullif(trim(users.raw_user_meta_data->>'pseudo'), ''),
    split_part(users.email, '@', 1)
  ) as username,
  coalesce(users.raw_user_meta_data->>'level', 'debutant') as tag,
  case coalesce(users.raw_user_meta_data->>'level', 'debutant')
    when 'debutant' then 400
    when 'intermediaire' then 600
    when 'avance' then 800
    else case
      when coalesce(users.raw_user_meta_data->>'elo', '') ~ '^[0-9]+$'
        then (users.raw_user_meta_data->>'elo')::integer
      else 400
    end
  end as elo
from auth.users
left join public.profiles profiles on profiles.user_id = users.id
where profiles.user_id is null
on conflict (user_id) do nothing;
