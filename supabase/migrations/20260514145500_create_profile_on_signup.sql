create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_level text := coalesce(new.raw_user_meta_data->>'level', 'debutant');
  starting_elo integer;
begin
  starting_elo := case requested_level
    when 'debutant' then 400
    when 'intermediaire' then 600
    when 'avance' then 800
    else 400
  end;

  insert into public.profiles (user_id, username, tag, elo)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      nullif(trim(new.raw_user_meta_data->>'pseudo'), ''),
      split_part(new.email, '@', 1)
    ),
    requested_level,
    starting_elo
  )
  on conflict (user_id) do update
    set username = excluded.username,
        tag = excluded.tag,
        elo = excluded.elo;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
